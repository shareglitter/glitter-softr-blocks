// ============================================================
// Airtable Automation Script Block — V3 (rotating secondary line)
// Sends cleaning notification emails via Postmark
//
// WHAT CHANGED FROM V2:
// - Reads the one active row from "Email Secondary Lines" and sends it
//   as `secondary` (or, for the `referral` key, as the richer `share`
//   section). An email never carries both.
// - MODE switch. In "test" mode every email goes ONLY to TEST.recipients,
//   nothing is written back to Airtable, and a TEST banner is added.
// - Postmark token comes from an automation Secret, not the source.
// - Subscribers are loaded in one query instead of one query each.
//
// SETUP (test automation):
// 1. New automation, trigger "When record matches conditions" on
//    Cleaning Log: "Block Code [string]" is not empty (same as live).
// 2. Action "Run a script", paste this whole file.
// 3. Input variable:  recordId = the trigger record's Airtable record ID
// 4. Secrets panel:   add POSTMARK_SERVER_TOKEN
// 5. Fill in TEST.recipients below. The script refuses to run until you do.
//
// Spec and rollout notes: docs/cleaning_email_roadmap.md
// ============================================================

// ── Mode ────────────────────────────────────────────────────
// "test": deliver only to TEST.recipients, write nothing to Airtable.
// "live": deliver to subscribers and write attribution back.
// Going live means pasting this into the EXISTING live automation with
// MODE = "live" and switching the test automation off. Never run a second
// automation in "live" next to the old one: subscribers would get two emails.
const MODE = "test";

const TEST = {
    // Hard allowlist. In test mode nothing is ever sent to any other address.
    recipients: ["YOUR_EMAIL_HERE", "PRESIDENT_EMAIL_HERE"],
    // A copy of the live Postmark template, so copy edits never touch live sends.
    templateAlias: "cleaning-notification-test",
    // How many real subscribers of the cleaned block to render the email "as".
    // Each preview goes to every test recipient, so 1 preview = 2 emails per cleaning.
    maxPreviewsPerLog: 1,
    // Which line to show:
    //   ["*"]                 a random row that has a Key and Line Text (tour every line in a few days)
    //   ["review", "referral"] random among these keys
    //   []                    the real rules: Active checkbox, date window, milestones, one-active guardrail
    forceKeys: ["*"],
    // true = skip test sends during quiet hours, the way live sends are held back
    respectQuietHours: true,
};

// ── Config ──────────────────────────────────────────────────
const POSTMARK_TEMPLATE_ID = 45583435;   // live template
const PREFERENCE_PAGE_URL = "https://app.shareglitter.com/";
const FROM_ADDRESS = "support@shareglitter.com";
const MESSAGE_STREAM = "cleaning-notifications";

// Hours when emails should NOT send (24hr format, Eastern Time)
const QUIET_HOURS_START = 21;  // 9pm ET
const QUIET_HOURS_END = 6;     // 6am ET

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
    cleanerConsentField: null,                         // set to "OK to Name in Emails" once it exists on Cleaners
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
// (better no line than "your th cleaning").
function fillPlaceholders(text, ctx) {
    const missing = [];
    const out = String(text || "").replace(/\{([a-z_]+)\}/g, (m, key) => {
        const v = ctx[key];
        if (v === undefined || v === null || v === "") { missing.push(key); return m; }
        return String(v);
    });
    return { missing, out };
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

    let cta = null;
    const rawUrl = rec.getCellValue(c.f.ctaUrl);
    const label = (rec.getCellValue(c.f.ctaLabel) || "").trim();
    if (rawUrl && label) {
        const u = fillPlaceholders(rawUrl, ctx);
        if (u.missing.length) return { key, dropped: `no data for {${u.missing.join("}, {")}} in CTA URL` };
        let url = u.out;
        if (!/^(https?:|mailto:)/i.test(url)) url = "https://" + url;
        cta = { label: label, url: url.startsWith("mailto:") ? url : appendUtm(url, key) };
    }
    return { key, record: rec, label: label, model: { text: t.out, cta: cta } };
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
        const fields = { [c.f.emailsSent]: (record.getCellValue(c.f.emailsSent) || 0) + count, [c.f.lastSent]: today };
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
// ════════════════════ end secondary line module ═════════════

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
const cleaningLogRecordId = input.config().recordId;
console.log(`MODE = ${MODE}${IS_TEST ? ` → delivering only to ${TEST.recipients.join(", ")}; no Airtable writes` : ""}`);

// ── Check quiet hours FIRST ─────────────────────────────────
const now = new Date();
const eastern = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
const currentHour = eastern.getHours();
const isDuringQuietHours = (currentHour >= QUIET_HOURS_START || currentHour < QUIET_HOURS_END);
const cleaningLogTable = base.getTable("Cleaning Log");

if (isDuringQuietHours && (!IS_TEST || TEST.respectQuietHours)) {
    console.log(`Current hour is ${currentHour}:00 ET — inside quiet hours (${QUIET_HOURS_START}:00–${QUIET_HOURS_END}:00).`);
    if (IS_TEST) {
        console.log("Test mode: live would flag this record for the morning catch-up. Not writing the flag, not sending. Exiting.");
        return;
    }
    await cleaningLogTable.updateRecordAsync(cleaningLogRecordId, { "Email Delayed": true });
    console.log("Email Delayed checkbox set. Morning automation will handle this. Exiting.");
    return;
}

// ── Fetch the Cleaning Log record ───────────────────────────
const cleaningLogRecord = await cleaningLogTable.selectRecordAsync(cleaningLogRecordId, {
    fields: ["Block", "Date and Time", "Cleaner"]
});
if (!cleaningLogRecord) {
    console.log("No cleaning log record found. Exiting.");
    return;
}

// ── Get the Block ───────────────────────────────────────────
const blockLinks = cleaningLogRecord.getCellValue("Block");
if (!blockLinks || blockLinks.length === 0) {
    console.log("No block linked to this cleaning log. Exiting.");
    return;
}
const blockId = blockLinks[0].id;

const blocksTable = base.getTable("Blocks");
const blockRecord = await blocksTable.selectRecordAsync(blockId, {
    fields: ["Block Name (Friendly)", "Subscribers", "Block Page URL"]
});
if (!blockRecord) {
    console.log("Block record not found. Exiting.");
    return;
}

const blockName = blockRecord.getCellValue("Block Name (Friendly)");
let blockPageUrl = blockRecord.getCellValue("Block Page URL") || "";
if (blockPageUrl && !blockPageUrl.startsWith("http")) {
    blockPageUrl = "https://" + blockPageUrl;
}
const subscriberLinks = blockRecord.getCellValue("Subscribers");
if (!subscriberLinks || subscriberLinks.length === 0) {
    console.log(`No subscribers linked to block "${blockName}". Exiting.`);
    return;
}

// ── Get the Cleaner's display name (and consent, once that field exists) ──
const cleanerLinks = cleaningLogRecord.getCellValue("Cleaner");
let cleanerFirstName = "Your cleaner"; // fallback
let cleanerNameable = false;
if (cleanerLinks && cleanerLinks.length > 0) {
    const consentField = SECONDARY_CONFIG.cleanerConsentField;
    const cleanerRecord = await base.getTable("Cleaners").selectRecordAsync(cleanerLinks[0].id, {
        fields: ["Display Name", consentField].filter(Boolean)
    });
    const displayName = cleanerRecord ? cleanerRecord.getCellValue("Display Name") : null;
    if (displayName) {
        cleanerFirstName = displayName.split(" ")[0];
        cleanerNameable = consentField ? cleanerRecord.getCellValue(consentField) === true : false;
    }
}

// ── Format the cleaning date ────────────────────────────────
const rawDate = cleaningLogRecord.getCellValue("Date and Time");
let cleaningDate = "today";
if (rawDate) {
    cleaningDate = new Date(rawDate).toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York"
    });
}

// ── Fetch and filter subscribers (one query per 100 links) ──
const subscribersTable = base.getTable("Subscribers");
const subscriberFields = ["Email", "Cleaning Notifications Opt-In", "Contribution Status (from Active Subscriptions)",
    "Display Name", "Referral Code", SECONDARY_CONFIG.subscriberStartField, SECONDARY_CONFIG.subscriberMilestonesField];
const subscribers = [];
for (let i = 0; i < subscriberLinks.length; i += 100) {
    const q = await subscribersTable.selectRecordsAsync({
        fields: subscriberFields,
        recordIds: subscriberLinks.slice(i, i + 100).map(l => l.id)
    });
    subscribers.push(...q.records);
}

const emailRecipients = [];
const skipped = { noOptIn: [], churned: [], noEmail: [] };
console.log(`Block "${blockName}" has ${subscriberLinks.length} linked subscriber(s). Checking eligibility...`);

for (const subscriber of subscribers) {
    const displayName = subscriber.getCellValue("Display Name") || "Unknown";

    if (!subscriber.getCellValue("Cleaning Notifications Opt-In")) {
        skipped.noOptIn.push(displayName);
        continue;
    }

    const statuses = subscriber.getCellValue("Contribution Status (from Active Subscriptions)");
    if (!statuses || statuses.length === 0) {
        skipped.churned.push(`${displayName} (no status)`);
        continue;
    }
    const statusValues = Array.isArray(statuses)
        ? statuses.map(s => typeof s === "object" ? s.name || s : s)
        : [statuses];
    if (!statusValues.some(s => !CHURN_STATUSES.includes(s))) {
        skipped.churned.push(`${displayName} (${statusValues.join(", ")})`);
        continue;
    }

    const email = subscriber.getCellValue("Email");
    if (!email) {
        skipped.noEmail.push(displayName);
        continue;
    }

    emailRecipients.push({
        email: typeof email === "object" ? email.email || email : email,
        subscriberName: displayName,
        subscriberId: subscriber.id,
        referralCode: subscriber.getCellValueAsString("Referral Code"),
        startDate: subscriber.getCellValue(SECONDARY_CONFIG.subscriberStartField),
        milestonesSent: (subscriber.getCellValue(SECONDARY_CONFIG.subscriberMilestonesField) || []).map(x => x.name),
    });
    console.log(`  ✓ ${displayName} — opted in, status: ${statusValues.join(", ")}`);
}

console.log(`\n── Summary for "${blockName}" ──`);
console.log(`Eligible: ${emailRecipients.length}`);
if (skipped.noOptIn.length > 0) console.log(`Not opted in (${skipped.noOptIn.length}): ${skipped.noOptIn.join(", ")}`);
if (skipped.churned.length > 0) console.log(`Churned/no status (${skipped.churned.length}): ${skipped.churned.join(", ")}`);
if (skipped.noEmail.length > 0) console.log(`No email on file (${skipped.noEmail.length}): ${skipped.noEmail.join(", ")}`);

if (emailRecipients.length === 0) {
    console.log("No eligible recipients. Exiting.");
    return;
}

// ── Pick the secondary line ─────────────────────────────────
let lines = await loadSecondaryLines();
let selectionNote = "real rules (Active checkbox)";
if (IS_TEST && TEST.forceKeys.length > 0) {
    const pool = TEST.forceKeys.includes("*")
        ? lines.usable
        : lines.usable.filter(r => TEST.forceKeys.includes(r.getCellValue(SECONDARY_CONFIG.f.key)));
    const forced = pool[Math.floor(Math.random() * pool.length)] || null;
    lines = { ...lines, rotation: forced, milestones: [], problem: forced ? "" : `no usable row matches forceKeys ${JSON.stringify(TEST.forceKeys)}` };
    selectionNote = `forced, random pick from ${TEST.forceKeys.includes("*") ? "all rows" : TEST.forceKeys.join("/")} (Active ignored)`;
}

// ── Block stats, only when a candidate line needs them ──────
const candidateLines = [lines.rotation, ...lines.milestones].filter(Boolean);
const needsCounts = candidateLines.some(r =>
    /\{(cleaning_count|cleaning_count_ordinal|block_bags_total)\}/.test(r.getCellValue(SECONDARY_CONFIG.f.text) || ""));

let blockLogs = [];
if (needsCounts) {
    const logQ = await cleaningLogTable.selectRecordsAsync({
        fields: ["Block", "Date and Time", SECONDARY_CONFIG.cleaningLogBagsField, SECONDARY_CONFIG.cleaningLogLitterField].filter(Boolean)
    });
    blockLogs = logQ.records.filter(r => (r.getCellValue("Block") || []).some(b => b.id === blockId));
}
const bagsOf = (r) => {
    if (SECONDARY_CONFIG.cleaningLogBagsField) return r.getCellValue(SECONDARY_CONFIG.cleaningLogBagsField) || 0;
    // Options look like "Light. Sporadic litter, less than 1/2 bag" or just "Light"
    const lvl = ((r.getCellValue(SECONDARY_CONFIG.cleaningLogLitterField) || {}).name || "").split(".")[0].trim();
    return SECONDARY_CONFIG.litterToBags[lvl] || 0;
};
const blockBagsTotal = Math.round(blockLogs.reduce((s, r) => s + bagsOf(r), 0));

// ── Build one TemplateModel per subscriber ──────────────────
function buildForSubscriber(r) {
    const startD = r.startDate ? new Date(r.startDate) : null;
    const myLogs = startD ? blockLogs.filter(l => new Date(l.getCellValue("Date and Time")) >= startD) : [];
    const ctx = {
        display_name: r.subscriberName,
        block_name: blockName,
        block_page_url: blockPageUrl,
        cleaner_first_name: cleanerNameable ? cleanerFirstName : null,
        cleaning_count: needsCounts && startD && myLogs.length > 0 ? myLogs.length : null,
        cleaning_count_ordinal: needsCounts && startD && myLogs.length > 0 ? ordinal(myLogs.length) : null,
        block_bags_total: needsCounts && blockBagsTotal >= 1 ? blockBagsTotal : null,
        tenure_months: startD ? monthsBetween(startD, now) : null,
        milestonesSent: r.milestonesSent,
    };
    const sec = buildSecondary(lines, ctx);

    const model = {
        block_name: blockName,
        cleaning_date: cleaningDate,
        cleaner_first_name: cleanerFirstName,
        preference_url: PREFERENCE_PAGE_URL,
        display_name: r.subscriberName,
        block_page_url: blockPageUrl,
    };
    let outcome;
    if (sec.dropped !== undefined) {
        outcome = `NO LINE${sec.key ? ` ("${sec.key}" dropped)` : ""}: ${sec.dropped}`;
    } else if (sec.key === SECONDARY_CONFIG.shareKey) {
        const share = buildShare(blockPageUrl, blockName, r.referralCode);
        if (share) {
            model.share = { ...share, text: sec.model.text, forward_label: sec.label || "Forward this email" };
            outcome = `"${sec.key}" → shown as the forward section`;
        } else {
            sec.dropped = "block has no Block Page URL";
            outcome = `NO LINE ("${sec.key}" dropped): ${sec.dropped}`;
        }
    } else {
        model.secondary = sec.model;
        outcome = `"${sec.key}"${sec.milestoneTag ? ` (milestone, ${sec.milestoneTag})` : ""}${sec.model.cta ? "" : " (text only, no CTA)"}`;
    }
    console.log(`  ${r.subscriberName}: ${outcome}`);
    return { model, sec, outcome };
}

const targets = IS_TEST ? emailRecipients.slice(0, TEST.maxPreviewsPerLog) : emailRecipients;
const messages = [];
const sentSecondaries = [];

console.log(`\nSecondary line selection: ${selectionNote}`);
for (const r of targets) {
    const { model, sec, outcome } = buildForSubscriber(r);
    const secondaryKey = sec.dropped === undefined ? sec.key : "none";

    if (IS_TEST) {
        model.test_banner = {
            line_key: secondaryKey,
            outcome: outcome,
            selection: selectionNote,
            as_name: r.subscriberName,
            log_id: cleaningLogRecordId,
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
            Metadata: { cleaning_log: cleaningLogRecordId, secondary_key: secondaryKey },
        };
        if (IS_TEST) msg.TemplateAlias = TEST.templateAlias; else msg.TemplateId = POSTMARK_TEMPLATE_ID;
        messages.push(msg);
    }
}

// ── Send via Postmark batch API ─────────────────────────────
if (IS_TEST) assertOnlyTestRecipients(messages);
console.log(`\nSending ${messages.length} email(s) via Postmark...`);

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
                console.log(`✓ Sent to ${msg.To}`);
            } else {
                console.log(`✗ Failed for ${msg.To}: ${msg.Message}`);
            }
        }
        if (IS_TEST) {
            console.log("Test mode: skipped write-back (Secondary Line stamp, Emails Sent, Milestones Sent).");
        } else {
            const okEmails = new Set(result.filter(m => m.ErrorCode === 0).map(m => String(m.To).toLowerCase()));
            const succeeded = sentSecondaries.filter(s => okEmails.has(String(s.email).toLowerCase()));
            await recordSecondarySends(lines, cleaningLogTable, cleaningLogRecordId, succeeded, subscribersTable);
        }
    } else {
        console.log(`Postmark API error: ${response.status} — ${JSON.stringify(result)}`);
    }
} catch (error) {
    console.log(`Network error calling Postmark: ${error.message}`);
}
