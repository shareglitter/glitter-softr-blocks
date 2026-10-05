// ============================================================
// Airtable Automation Script Block — Morning Catchup V3.2 (rotating secondary line)
// Sends the cleaning notification emails that were held overnight
// (Cleaning Log rows with "Email Delayed" checked).
//
// WHAT CHANGED FROM V2:
// - Carries the same secondary-line module as email_automation_v3_secondary.js,
//   so an email held overnight renders exactly like a daytime one, and stamps
//   the same attribution (Secondary Line on the log, Emails Sent on the line).
// - MODE switch, same meaning as in the immediate script.
// - Postmark token comes from an automation Secret, not the source.
// - A log keeps its "Email Delayed" flag when Postmark rejects the whole
//   request (wrong token, missing template), so the next morning retries it
//   instead of the emails being lost.
//
// SETUP:
// 1. Trigger: "At a scheduled time", every day, 6:15 AM Eastern
// 2. Action: "Run a script", paste this whole file
// 3. Secrets panel: add POSTMARK_SERVER_TOKEN. No input variables.
// 4. Rehearsal: fill in TEST.recipients, keep MODE = "test", click Test.
//
// Spec and rollout notes: docs/cleaning_email_roadmap.md
// ============================================================

// ── Mode ────────────────────────────────────────────────────
// "test": deliver only to TEST.recipients, write nothing to Airtable
//         (flags stay as they are, so the live run is unaffected).
// "live": deliver to subscribers, write attribution back, clear the flags.
const MODE = "test";

const TEST = {
    // Hard allowlist. In test mode nothing is ever sent to any other address.
    recipients: ["YOUR_EMAIL_HERE", "PRESIDENT_EMAIL_HERE"],
    // A copy of the live Postmark template, so copy edits never touch live sends.
    templateAlias: "cleaning-notification-test",
    // How many real subscribers of each block to render the email "as".
    maxPreviewsPerLog: 1,
    // How many logs one test run previews. Flagged logs come first; when none are
    // flagged (the live run clears them at 6:15am) the most recent logs stand in.
    // Logs whose block has nobody eligible are passed over, so a test always sends.
    maxLogs: 2,
};

// ── Config (same as the immediate script, keep in sync) ─────
const POSTMARK_TEMPLATE_ID = 45583435;   // live template
const PREFERENCE_PAGE_URL = "https://app.shareglitter.com/";
const FROM_ADDRESS = "support@shareglitter.com";
const MESSAGE_STREAM = "cleaning-notifications";

// Churn statuses — subscribers with ONLY these statuses won't get emails
const CHURN_STATUSES = ["Payment Churn", "Positive Churn", "Negative Churn"];

// ════════════════════════════════════════════════════════════
// SECONDARY LINE MODULE (keep identical in every send script)
// ════════════════════════════════════════════════════════════
const SECONDARY_CONFIG = {
    table: "Email Secondary Lines",
    f: {
        key: "Key",
        text: "Line Text",
        ctaLabel: "CTA Label",
        ctaUrl: "CTA URL",
        mode: "Mode",                // "Rotation" | "Milestone"
        active: "Active",
        milestoneMonths: "Milestone Months",
        startDate: "Start Date",
        endDate: "End Date",
        emailsSent: "Emails Sent",
        firstSent: "First Sent",
        lastSent: "Last Sent",
    },
    // This key renders as the {{#share}} section: Line Text is the sentence, CTA Label is the
    // forward button's label, CTA URL is ignored (the link is always the subscriber's own).
    shareKey: "referral",
    cleaningLogLinkField: "Secondary Line",            // on Cleaning Log
    subscriberMilestonesField: "Milestones Sent",      // on Subscribers, options "6 months" / "12 months"
    milestoneTag: (months) => `${months} months`,
    subscriberStartField: "Member Since",              // created time; unreliable for bulk-imported rows
    cleanerConsentField: "OK to Name in Emails",       // checkbox on Cleaners; unchecked = {cleaner_first_name} lines drop. Set to null if the field is ever removed (a missing field name makes the script fail).
    cleaningLogBagsField: null,                        // set to "Bags" once a numeric field exists
    cleaningLogLitterField: "Trash",                   // single select; options start with Rare/Light/Medium/Heavy/Severe
    litterToBags: { "Rare": 0, "Light": 0.5, "Medium": 1, "Heavy": 2, "Severe": 3 },
    utm: { source: "cleaning_email", medium: "email", campaign: "post_clean_secondary" },
};

// Load every line once. `problem` explains why there is no rotation line, if so.
async function loadSecondaryLines() {
    const c = SECONDARY_CONFIG;
    const table = base.getTable(c.table);
    const q = await table.selectRecordsAsync({ fields: Object.values(c.f) });

    const today = new Date();
    const inWindow = (r) => {
        const s = r.getCellValue(c.f.startDate);
        const e = r.getCellValue(c.f.endDate);
        if (s && new Date(s) > today) return false;
        if (e && new Date(e) < today) return false;
        return true;
    };
    const usable = q.records.filter(r => r.getCellValue(c.f.key) && r.getCellValue(c.f.text));
    const active = usable.filter(r => r.getCellValue(c.f.active) === true && inWindow(r));
    const modeOf = (r) => (r.getCellValue(c.f.mode) || {}).name || "Rotation";

    const rotation = active.filter(r => modeOf(r) === "Rotation");
    const milestones = active.filter(r => modeOf(r) === "Milestone");

    if (rotation.length > 1) {
        const keys = rotation.map(r => r.getCellValue(c.f.key)).join(", ");
        console.log(`⚠ ${rotation.length} rotation lines are Active (${keys}). Only one is allowed. Sending WITHOUT a rotation line.`);
        return { table, usable, rotation: null, milestones, problem: `${rotation.length} rotation lines active: ${keys}` };
    }
    return { table, usable, rotation: rotation[0] || null, milestones, problem: rotation[0] ? "" : "no active rotation line" };
}

// Replace {placeholder} tokens. A placeholder with no data drops the whole line
// (better no line than "your th cleaning"). `encode` is applied to each value
// when filling a mailto: URL, so a block name survives as a subject line.
function fillPlaceholders(text, ctx, encode) {
    const missing = [];
    const out = String(text || "").replace(/\{([a-z_]+)\}/g, (m, key) => {
        const v = ctx[key];
        if (v === undefined || v === null || v === "") { missing.push(key); return m; }
        return encode ? encode(String(v)) : String(v);
    });
    return { missing, out };
}

// "Facebook | Instagram | Nextdoor" → ["Facebook", "Instagram", "Nextdoor"]
function splitPipes(v) {
    return String(v || "").split("|").map(x => x.trim()).filter(Boolean);
}

function appendUtm(url, key) {
    if (!url) return "";
    const u = SECONDARY_CONFIG.utm;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}utm_source=${u.source}&utm_medium=${u.medium}&utm_campaign=${u.campaign}&utm_content=${encodeURIComponent(key)}`;
}

function ordinal(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function monthsBetween(a, b) {
    let m = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
    if (b.getDate() < a.getDate()) m--;   // only whole months count
    return m;
}

// One line for one recipient → { key, record, model } or { key, dropped: "why" }
function renderLine(rec, ctx) {
    const c = SECONDARY_CONFIG;
    const key = rec.getCellValue(c.f.key);
    const t = fillPlaceholders(rec.getCellValue(c.f.text), ctx);
    if (t.missing.length) return { key, dropped: `no data for {${t.missing.join("}, {")}}` };

    // Buttons. Labels and URLs are pipe-separated lists in the same order; a row
    // with a label but no URL (or the reverse) renders as text only.
    const labels = splitPipes(rec.getCellValue(c.f.ctaLabel));
    const urls = splitPipes(rec.getCellValue(c.f.ctaUrl));
    const ctas = [];
    if (labels.length && urls.length) {
        if (labels.length !== urls.length) return { key, dropped: `${labels.length} CTA label(s) but ${urls.length} CTA URL(s); they must pair up` };
        for (let i = 0; i < labels.length; i++) {
            const isMailto = /^mailto:/i.test(urls[i]);
            const u = fillPlaceholders(urls[i], ctx, isMailto ? encodeURIComponent : null);
            if (u.missing.length) return { key, dropped: `no data for {${u.missing.join("}, {")}} in CTA URL` };
            let url = u.out;
            if (!/^(https?:|mailto:)/i.test(url)) url = "https://" + url;
            ctas.push({ label: labels[i], url: isMailto ? url : appendUtm(url, key) });
        }
    }
    return { key, record: rec, label: labels[0] || "", model: { text: t.out, ctas: ctas } };
}

// Milestone lines override the rotation line for that one recipient, once each.
function buildSecondary(lines, ctx) {
    const c = SECONDARY_CONFIG;
    for (const m of lines.milestones) {
        const months = m.getCellValue(c.f.milestoneMonths);
        if (!months || ctx.tenure_months == null || ctx.tenure_months < months) continue;
        const tag = c.milestoneTag(months);
        if ((ctx.milestonesSent || []).includes(tag)) continue;
        const built = renderLine(m, ctx);
        if (built.model) return { ...built, milestoneTag: tag };
    }
    if (!lines.rotation) return { key: "", dropped: lines.problem };
    return renderLine(lines.rotation, ctx);
}

// After a successful LIVE send: bump counters, stamp the log, mark milestones.
// The catch-up calls this once per log in the same run, and the line records were
// read once at the start, so the running Emails Sent total is kept here.
const emailsSentThisRun = new Map();   // line record id → Emails Sent after this run's writes
async function recordSecondarySends(lines, cleaningLogTable, cleaningLogRecordId, sent, subscribersTable) {
    const c = SECONDARY_CONFIG;
    if (sent.length === 0) return;

    const byKey = new Map();
    for (const s of sent) {
        if (!byKey.has(s.key)) byKey.set(s.key, { record: s.record, count: 0 });
        byKey.get(s.key).count++;
    }
    const today = new Date().toISOString().slice(0, 10);
    for (const { record, count } of byKey.values()) {
        const before = emailsSentThisRun.has(record.id) ? emailsSentThisRun.get(record.id) : (record.getCellValue(c.f.emailsSent) || 0);
        emailsSentThisRun.set(record.id, before + count);
        const fields = { [c.f.emailsSent]: before + count, [c.f.lastSent]: today };
        if (!record.getCellValue(c.f.firstSent)) fields[c.f.firstSent] = today;
        await lines.table.updateRecordAsync(record.id, fields);
    }

    // The log is stamped with the rotation line; milestones are per subscriber.
    const rotationSend = sent.find(s => !s.milestoneTag);
    if (rotationSend) {
        await cleaningLogTable.updateRecordAsync(cleaningLogRecordId, {
            [c.cleaningLogLinkField]: [{ id: rotationSend.record.id }],
        });
    }
    for (const s of sent.filter(x => x.milestoneTag)) {
        const existing = (s.milestonesSent || []).map(n => ({ name: n }));
        await subscribersTable.updateRecordAsync(s.subscriberId, {
            [c.subscriberMilestonesField]: [...existing, { name: s.milestoneTag }],
        });
    }
}

// ── Share links ─────────────────────────────────────────────
// No UTM here on purpose: this is the subscriber's personal link, it is printed
// in the email for copy/paste, and ?code= already carries the attribution.
function buildShare(blockPageUrl, blockName, referralCode) {
    if (!blockPageUrl) return null;
    const url = referralCode
        ? blockPageUrl + (blockPageUrl.includes("?") ? "&" : "?") + "code=" + encodeURIComponent(referralCode)
        : blockPageUrl;
    const subject = `${blockName} just got cleaned`;
    const body = `Hi neighbor,\n\nOur block, ${blockName}, was just cleaned by Glitter. Neighbors chip in and a local cleaner keeps it clean every week.\n\nSee the photos and join in here:\n${url}\n`;
    return {
        url: url,
        forward_mailto: `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    };
}

// Does this line print a block stat? Callers load the block's cleaning logs only then.
function lineNeedsCounts(rec) {
    return /\{(cleaning_count|cleaning_count_ordinal|cleaning_count_this_year|cleaning_count_this_year_ordinal|block_cleaning_count|block_cleaning_count_ordinal|block_bags_total)\}/
        .test(rec.getCellValue(SECONDARY_CONFIG.f.text) || "");
}

function bagsOf(logRecord) {
    const c = SECONDARY_CONFIG;
    if (c.cleaningLogBagsField) return logRecord.getCellValue(c.cleaningLogBagsField) || 0;
    // Options look like "Light. Sporadic litter, less than 1/2 bag" or just "Light"
    const lvl = ((logRecord.getCellValue(c.cleaningLogLitterField) || {}).name || "").split(".")[0].trim();
    return c.litterToBags[lvl] || 0;
}

// One subscriber's TemplateModel for one cleaning. Every send script calls this, so an
// email held overnight renders exactly like a daytime one.
//   r: { subscriberName, referralCode, startDate, milestonesSent }
//   d: { blockName, blockPageUrl, cleaningDate, cleanerFirstName, cleanerNameable,
//        blockFrequency, nextFrequency, blockLogs, now }
// blockLogs is every Cleaning Log row of the block, or [] when no candidate line
// needs counts (see lineNeedsCounts); with [] the count placeholders have no data.
function buildSubscriberModel(r, lines, d) {
    const yearOf = (x) => Number(new Date(x).toLocaleDateString("en-US", { year: "numeric", timeZone: "America/New_York" }));
    const thisYear = yearOf(d.now);
    const startD = r.startDate ? new Date(r.startDate) : null;
    const myLogs = startD ? d.blockLogs.filter(l => new Date(l.getCellValue("Date and Time")) >= startD) : [];
    const myLogsThisYear = myLogs.filter(l => yearOf(l.getCellValue("Date and Time")) === thisYear);
    const blockBagsTotal = Math.round(d.blockLogs.reduce((s, l) => s + bagsOf(l), 0));
    const share = buildShare(d.blockPageUrl, d.blockName, r.referralCode);
    const ctx = {
        display_name: r.subscriberName,
        block_name: d.blockName,
        block_page_url: d.blockPageUrl,
        cleaning_date: d.cleaningDate,                     // "Friday, September 18"
        cleaner_name_in_greeting: d.cleanerFirstName,      // same name the greeting uses; no consent gate
        referral_code: r.referralCode || null,             // e.g. SUNNY-9IH
        share_url: share ? share.url : null,               // personal ?code= link
        year: thisYear,
        block_frequency: d.blockFrequency,
        next_frequency: d.nextFrequency,
        cleaner_first_name: d.cleanerNameable ? d.cleanerFirstName : null,
        cleaning_count: myLogs.length > 0 ? myLogs.length : null,                    // since this subscriber joined
        cleaning_count_ordinal: myLogs.length > 0 ? ordinal(myLogs.length) : null,
        cleaning_count_this_year: myLogsThisYear.length > 0 ? myLogsThisYear.length : null,
        cleaning_count_this_year_ordinal: myLogsThisYear.length > 0 ? ordinal(myLogsThisYear.length) : null,
        block_cleaning_count: d.blockLogs.length > 0 ? d.blockLogs.length : null,    // every logged cleaning of the block
        block_cleaning_count_ordinal: d.blockLogs.length > 0 ? ordinal(d.blockLogs.length) : null,
        block_bags_total: blockBagsTotal >= 1 ? blockBagsTotal : null,
        tenure_months: startD ? monthsBetween(startD, d.now) : null,
        milestonesSent: r.milestonesSent,
    };
    const sec = buildSecondary(lines, ctx);

    const model = {
        block_name: d.blockName,
        cleaning_date: d.cleaningDate,
        cleaner_first_name: d.cleanerFirstName,
        preference_url: PREFERENCE_PAGE_URL,
        display_name: r.subscriberName,
        block_page_url: d.blockPageUrl,
    };
    let outcome;
    if (sec.dropped !== undefined) {
        outcome = `NO LINE${sec.key ? ` ("${sec.key}" dropped)` : ""}: ${sec.dropped}`;
    } else if (sec.key === SECONDARY_CONFIG.shareKey) {
        if (share) {
            model.share = { ...share, text: sec.model.text, forward_label: sec.label || "Forward this email" };
            outcome = `"${sec.key}" → shown as the forward section`;
        } else {
            sec.dropped = "block has no Block Page URL";
            outcome = `NO LINE ("${sec.key}" dropped): ${sec.dropped}`;
        }
    } else {
        model.secondary = sec.model;
        outcome = `"${sec.key}"${sec.milestoneTag ? ` (milestone, ${sec.milestoneTag})` : ""}${sec.model.ctas.length ? ` (${sec.model.ctas.length} button${sec.model.ctas.length > 1 ? "s" : ""})` : " (text only, no CTA)"}`;
    }
    return { model, sec, outcome };
}
// ════════════════════ end secondary line module ═════════════

// ── Test-mode guardrails ────────────────────────────────────
if (MODE !== "test" && MODE !== "live") throw new Error(`MODE must be "test" or "live", got "${MODE}"`);
const IS_TEST = MODE === "test";

if (IS_TEST) {
    const ok = Array.isArray(TEST.recipients) && TEST.recipients.length >= 1 && TEST.recipients.length <= 3
        && TEST.recipients.every(e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
    if (!ok) throw new Error("TEST.recipients must be 1 to 3 real email addresses. Replace the placeholders before running.");
    if (!TEST.templateAlias) throw new Error("TEST.templateAlias is empty. Test mode must use the test copy of the template.");
}

// Last line of defence, called immediately before the Postmark request.
function assertOnlyTestRecipients(messages) {
    const allow = new Set(TEST.recipients.map(e => e.toLowerCase()));
    for (const m of messages) {
        if (!allow.has(String(m.To).toLowerCase()) || m.Cc || m.Bcc) {
            throw new Error(`TEST MODE BLOCKED A SEND: "${m.To}" is not in TEST.recipients. Nothing was sent.`);
        }
    }
}

// ── Inputs ──────────────────────────────────────────────────
const POSTMARK_SERVER_TOKEN = String(input.secret("POSTMARK_SERVER_TOKEN") || "").trim();
// Shape check only; the value itself is never logged. A Postmark 401 almost always
// means the secret holds something other than the bare server token.
if (!/^[0-9a-f]{8}-([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(POSTMARK_SERVER_TOKEN)) {
    console.log(`⚠ POSTMARK_SERVER_TOKEN secret is ${POSTMARK_SERVER_TOKEN.length} characters and is not shaped like a Postmark server token (36 characters, 8-4-4-4-12 hex). Check for quotes or extra text, and that it is the SERVER token (Postmark → Servers → your server → API Tokens), not the Account token.`);
}
const now = new Date();
console.log(`MODE = ${MODE}${IS_TEST ? ` → delivering only to ${TEST.recipients.join(", ")}; no Airtable writes` : ""}`);

// ── Find the logs to process ────────────────────────────────
const cleaningLogTable = base.getTable("Cleaning Log");
const allCleaningLogs = await cleaningLogTable.selectRecordsAsync({
    fields: ["Email Delayed", "Block", "Date and Time", "Cleaner", SECONDARY_CONFIG.cleaningLogBagsField, SECONDARY_CONFIG.cleaningLogLitterField].filter(Boolean)
});

let delayedRecords = allCleaningLogs.records.filter(r => r.getCellValue("Email Delayed") === true);
let pickedBy = `"Email Delayed" flag`;
if (IS_TEST) {
    if (delayedRecords.length === 0) {
        delayedRecords = allCleaningLogs.records
            .filter(r => (r.getCellValue("Block") || []).length > 0 && r.getCellValue("Date and Time"))
            .sort((a, b) => new Date(b.getCellValue("Date and Time")) - new Date(a.getCellValue("Date and Time")));
        pickedBy = "most recent logs (none flagged)";
    }
    delayedRecords = delayedRecords.slice(0, 40);   // candidates; the loop stops after TEST.maxLogs previews
}

if (delayedRecords.length === 0) {
    console.log("No delayed emails to send. All clear!");
    return;
}
console.log(IS_TEST
    ? `Test mode: previewing up to ${TEST.maxLogs} of ${delayedRecords.length} candidate log(s), picked by ${pickedBy}.\n`
    : `Found ${delayedRecords.length} cleaning notification(s) to send, picked by ${pickedBy}.\n`);

// ── Load the other tables once (5 queries total) ────────────
const byId = (q) => new Map(q.records.map(r => [r.id, r]));

const blocksById = byId(await base.getTable("Blocks").selectRecordsAsync({
    fields: ["Block Name (Friendly)", "Subscribers", "Block Page URL", "Frequency Label (Lookup)", "Next Frequency Label"]
}));

const subscribersTable = base.getTable("Subscribers");
const subscribersById = byId(await subscribersTable.selectRecordsAsync({
    fields: ["Email", "Cleaning Notifications Opt-In", "Contribution Status (from Active Subscriptions)",
        "Display Name", "Referral Code", SECONDARY_CONFIG.subscriberStartField, SECONDARY_CONFIG.subscriberMilestonesField]
}));

const cleanersById = byId(await base.getTable("Cleaners").selectRecordsAsync({
    fields: ["Display Name", SECONDARY_CONFIG.cleanerConsentField].filter(Boolean)
}));

const lines = await loadSecondaryLines();
const needsCounts = [lines.rotation, ...lines.milestones].filter(Boolean).some(lineNeedsCounts);
console.log("Tables loaded.");

// ── Process each delayed record ─────────────────────────────
let totalSent = 0;
let totalSkipped = 0;
let previewed = 0;   // test mode: logs that produced a preview
const milestonesThisRun = new Map();   // subscriber id → tags sent earlier in this run

async function clearFlag(recordId) {
    if (IS_TEST) return;
    await cleaningLogTable.updateRecordAsync(recordId, { "Email Delayed": false });
}

for (const cleaningLogRecord of delayedRecords) {
    if (IS_TEST && previewed >= TEST.maxLogs) break;
    console.log(`\n── Processing record ${cleaningLogRecord.id} ──`);

    // ── Get the Block ───────────────────────────────────────
    const blockLinks = cleaningLogRecord.getCellValue("Block");
    const blockRecord = blockLinks && blockLinks.length > 0 ? blocksById.get(blockLinks[0].id) : null;
    if (!blockRecord) {
        console.log("  No block linked, or block not found. Clearing flag and skipping.");
        await clearFlag(cleaningLogRecord.id);
        continue;
    }
    const blockId = blockRecord.id;

    const blockName = blockRecord.getCellValue("Block Name (Friendly)");
    // Block Page URL is stored without a scheme (gltr.ly/...)
    let blockPageUrl = blockRecord.getCellValue("Block Page URL") || "";
    if (blockPageUrl && !blockPageUrl.startsWith("http")) {
        blockPageUrl = "https://" + blockPageUrl;
    }
    // "Every Week" blocks have no Next Frequency Label, so {next_frequency} lines drop for them.
    const blockFrequency = blockRecord.getCellValueAsString("Frequency Label (Lookup)").trim().toLowerCase();
    const nextFrequency = blockRecord.getCellValueAsString("Next Frequency Label").trim().toLowerCase();
    const subscriberLinks = blockRecord.getCellValue("Subscribers");

    if (!subscriberLinks || subscriberLinks.length === 0) {
        console.log(`  No subscribers on block "${blockName}". Clearing flag.`);
        await clearFlag(cleaningLogRecord.id);
        continue;
    }

    // ── Get the Cleaner's display name and consent ──────────
    const cleanerLinks = cleaningLogRecord.getCellValue("Cleaner");
    let cleanerFirstName = "Your cleaner"; // fallback
    let cleanerNameable = false;
    const cleanerRecord = cleanerLinks && cleanerLinks.length > 0 ? cleanersById.get(cleanerLinks[0].id) : null;
    const cleanerDisplayName = cleanerRecord ? cleanerRecord.getCellValue("Display Name") : null;
    if (cleanerDisplayName) {
        const consentField = SECONDARY_CONFIG.cleanerConsentField;
        cleanerFirstName = cleanerDisplayName.split(" ")[0];
        cleanerNameable = consentField ? cleanerRecord.getCellValue(consentField) === true : false;
    }

    // ── Format cleaning date ────────────────────────────────
    const rawDate = cleaningLogRecord.getCellValue("Date and Time");
    let cleaningDate = "recently";
    if (rawDate) {
        cleaningDate = new Date(rawDate).toLocaleDateString("en-US", {
            weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York"
        });
    }

    // ── Filter subscribers (all from memory, zero queries) ──
    const emailRecipients = [];
    for (const link of subscriberLinks) {
        const subscriber = subscribersById.get(link.id);
        if (!subscriber) continue;

        // Check opt-in
        if (!subscriber.getCellValue("Cleaning Notifications Opt-In")) {
            totalSkipped++;
            continue;
        }

        // Check contribution status
        const statuses = subscriber.getCellValue("Contribution Status (from Active Subscriptions)");
        if (!statuses || statuses.length === 0) {
            totalSkipped++;
            continue;
        }
        const statusValues = Array.isArray(statuses)
            ? statuses.map(s => typeof s === "object" ? s.name || s : s)
            : [statuses];
        if (!statusValues.some(s => !CHURN_STATUSES.includes(s))) {
            totalSkipped++;
            continue;
        }

        const email = subscriber.getCellValue("Email");
        if (!email) {
            totalSkipped++;
            continue;
        }

        emailRecipients.push({
            email: typeof email === "object" ? email.email || email : email,
            subscriberName: subscriber.getCellValue("Display Name") || "Unknown",
            subscriberId: subscriber.id,
            referralCode: subscriber.getCellValueAsString("Referral Code"),
            startDate: subscriber.getCellValue(SECONDARY_CONFIG.subscriberStartField),
            milestonesSent: [
                ...(subscriber.getCellValue(SECONDARY_CONFIG.subscriberMilestonesField) || []).map(x => x.name),
                ...(milestonesThisRun.get(subscriber.id) || []),
            ],
        });
    }

    console.log(`  Block "${blockName}": ${emailRecipients.length} eligible recipient(s)`);

    if (emailRecipients.length === 0) {
        await clearFlag(cleaningLogRecord.id);
        continue;
    }

    // ── Build one TemplateModel per subscriber ──────────────
    const blockLogs = needsCounts
        ? allCleaningLogs.records.filter(r => (r.getCellValue("Block") || []).some(b => b.id === blockId))
        : [];
    const cleaning = { blockName, blockPageUrl, cleaningDate, cleanerFirstName, cleanerNameable, blockFrequency, nextFrequency, blockLogs, now };
    const targets = IS_TEST ? emailRecipients.slice(0, TEST.maxPreviewsPerLog) : emailRecipients;
    const messages = [];
    const sentSecondaries = [];
    previewed++;

    for (const r of targets) {
        const { model, sec, outcome } = buildSubscriberModel(r, lines, cleaning);
        console.log(`  ${r.subscriberName}: ${outcome}`);
        const secondaryKey = sec.dropped === undefined ? sec.key : "none";

        if (IS_TEST) {
            model.test_banner = {
                line_key: secondaryKey,
                outcome: outcome,
                selection: `morning catch-up, real rules (Active checkbox); log picked by ${pickedBy}`,
                audience: `${emailRecipients.length} of ${subscriberLinks.length} linked subscriber(s) would get this email`,
                as_name: r.subscriberName,
                log_id: cleaningLogRecord.id,
            };
        } else if (sec.dropped === undefined) {
            sentSecondaries.push({ ...sec, subscriberId: r.subscriberId, milestonesSent: r.milestonesSent, email: r.email });
        }

        for (const to of (IS_TEST ? TEST.recipients : [r.email])) {
            const msg = {
                From: FROM_ADDRESS,
                To: to,
                TemplateModel: model,
                MessageStream: MESSAGE_STREAM,
                Tag: IS_TEST ? "secondary-test" : `secondary:${secondaryKey}`,
                Metadata: { cleaning_log: cleaningLogRecord.id, secondary_key: secondaryKey },
            };
            if (IS_TEST) msg.TemplateAlias = TEST.templateAlias; else msg.TemplateId = POSTMARK_TEMPLATE_ID;
            messages.push(msg);
        }
    }

    // ── Send via Postmark ───────────────────────────────────
    if (IS_TEST) assertOnlyTestRecipients(messages);
    let rejected = false;   // Postmark refused the whole request, so nothing went out

    try {
        const response = await fetch("https://api.postmarkapp.com/email/batchWithTemplates", {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Postmark-Server-Token": POSTMARK_SERVER_TOKEN
            },
            body: JSON.stringify({ Messages: messages })
        });
        const result = await response.json();

        if (response.ok) {
            for (const msg of result) {
                if (msg.ErrorCode === 0) {
                    console.log(`  ✓ Sent to ${msg.To}`);
                    totalSent++;
                } else {
                    console.log(`  ✗ Failed for ${msg.To}: ${msg.Message}`);
                }
            }
            if (!IS_TEST) {
                const okEmails = new Set(result.filter(m => m.ErrorCode === 0).map(m => String(m.To).toLowerCase()));
                const succeeded = sentSecondaries.filter(s => okEmails.has(String(s.email).toLowerCase()));
                await recordSecondarySends(lines, cleaningLogTable, cleaningLogRecord.id, succeeded, subscribersTable);
                for (const s of succeeded.filter(x => x.milestoneTag)) {
                    milestonesThisRun.set(s.subscriberId, [...(milestonesThisRun.get(s.subscriberId) || []), s.milestoneTag]);
                }
            }
        } else {
            rejected = true;
            console.log(`  Postmark API error: ${response.status} — ${JSON.stringify(result)}`);
        }
    } catch (error) {
        console.log(`  Network error: ${error.message}`);
    }

    // ── Clear the delayed flag ──────────────────────────────
    if (IS_TEST) {
        console.log("  Test mode: no write-back, flag left as it is.");
    } else if (rejected) {
        console.log(`  ⚠ Left "Email Delayed" checked so tomorrow's run retries this log.`);
    } else {
        await clearFlag(cleaningLogRecord.id);
        console.log(`  ✓ Cleared "Email Delayed" flag.`);
    }
}

// ── Final summary ───────────────────────────────────────────
console.log(`\n══ Morning Catchup Complete ══`);
console.log(IS_TEST ? `Logs previewed: ${previewed} (test mode, nothing written)` : `Delayed records processed: ${delayedRecords.length}`);
if (IS_TEST && previewed === 0) console.log("⚠ None of the candidate logs had an eligible subscriber, so nothing was sent.");
console.log(`Emails sent: ${totalSent}`);
console.log(`Recipients skipped (opt-out/churn/no email): ${totalSkipped}`);
