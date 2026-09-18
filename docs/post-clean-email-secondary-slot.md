# Post-Clean Email: Modular Secondary Slot

**Status:** Build spec, not yet implemented
**Date:** Sep 18, 2026
**Source of ideas:** "Cleaning Confirmation Email — Test Ideas" (president's Google Doc, Sep 17, 2026)
**Base:** Subscription Blocks (`appzuuUtAQVDg0YW1`)
**Automations touched:**
- `New Cleaning Log: Last Clean Date & Send Email Notification` (`wflCdrhjYRo6d23pd`), script step "Finds subscribers to cleaned block and sends Postmark Broadcast email"
- `Send Delayed Cleaning Emails` (`wflfaR1X0DQAwzTU2`), the 6:15am ET cron catch-up
**Postmark:** template `45583435`, stream `cleaning-notifications`, from `support@shareglitter.com`

---

## 1. Goal

Add one rotating "secondary line" below the "See your cleaning photos" button in the cleaning confirmation email, so the president can cycle through 13 growth/retention/revenue/mission ideas every 2 to 3 weeks without any new scripts or templates per idea.

Hard constraints carried over from the president's doc (these keep the email transactional under CAN-SPAM):

- Exactly one secondary line per email. Never two.
- Placed below the main transactional content.
- No incentive attached to the line (no discounts, credits, or rewards).
- Rotation is one idea at a time. Attribution is tracked per idea.

## 2. Architecture in one paragraph

One Airtable config table holds all 13 lines. One checkbox marks which line is live. Both send scripts (immediate and morning catch-up) read the active line, fill any personalization placeholders, append a UTM to the CTA link, pass a `secondary` object to Postmark, and stamp the cleaning log with which line went out. The Postmark template has one conditional block that renders the object if present and nothing otherwise. Changing the rotation is a checkbox flip in Airtable, no code change.

```
Cleaning Log created
   └─ send script (immediate, or 6:15am catch-up)
        ├─ existing: find block, filter eligible subscribers, build TemplateModel
        ├─ NEW: load active line from "Email Secondary Lines"
        ├─ NEW: per recipient, fill placeholders, build secondary {text, cta_label, cta_url}
        ├─ existing: Postmark batchWithTemplates
        └─ NEW: stamp Cleaning Log → Secondary Line (link) + increment Emails Sent on the line
```

---

## 3. Airtable changes

### 3a. New table: `Email Secondary Lines`

| Field | Type | Notes |
|---|---|---|
| `Key` | Single line text (primary) | Stable slug, used in UTM and logs. e.g. `referral`, `satisfaction`, `impact_stat`, `services_waitlist`, `trash_can`, `impact_fund`, `ambassador`, `review`, `cleaner_spotlight`, `social_share`, `frequency_upgrade`, `sponsor_block`, `milestone_6mo`, `milestone_12mo` |
| `Line Text` | Long text | The sentence. Supports single-brace placeholders (see section 6). Plain text only, no HTML. |
| `CTA Label` | Single line text | Optional. If empty, no link renders, text only. |
| `CTA URL` | URL | Optional. Supports placeholders too (e.g. `{block_page_url}`). Script appends UTM params. |
| `Mode` | Single select: `Rotation`, `Milestone` | `Rotation` rows participate in the one-active rule. `Milestone` rows fire per subscriber based on tenure and override the rotation line for that recipient only. |
| `Active` | Checkbox | For `Rotation` rows, exactly one may be checked. For `Milestone` rows, checked means the milestone rule is on. |
| `Milestone Months` | Number | Only for `Milestone` rows. 6 or 12. |
| `Start Date` | Date | Optional guardrail. Script ignores the row before this date. |
| `End Date` | Date | Optional guardrail. Script ignores the row after this date. |
| `Requires Fields` | Multiple select | Documentation only: which placeholders this line needs (`cleaning_count`, `block_bags_total`, `cleaner_first_name`, `tenure_months`). Helps the president see which lines depend on data availability. |
| `Cleaning Logs` | Link to `Cleaning Log` | Auto-populated by the script stamp (inverse of the link below). |
| `Sends (logs)` | Count of `Cleaning Logs` | How many cleaning events carried this line. |
| `Emails Sent` | Number | Incremented by the script per recipient. |
| `First Sent` | Date | Set by script on first send. |
| `Last Sent` | Date | Set by script on every send. |
| `Notes` | Long text | President's "what to watch" column goes here. |
| `Active (Rotation) Count` | Formula or rollup, see below | Guardrail so two rotation rows can't be live at once. |

**Single-active guardrail.** Simplest option: the script refuses to attach any secondary line if more than one `Rotation` row is `Active`, and logs a loud warning. Nicer option: add a helper table or use an Airtable automation on `Active` change that posts to Slack when the count of active rotation rows is not 1. Start with the script refusal, it's zero setup.

### 3b. New fields on `Cleaning Log`

| Field | Type | Notes |
|---|---|---|
| `Secondary Line` | Link to `Email Secondary Lines` | Stamped by the script after a successful send. One value. This is the attribution anchor: any reply, upgrade, waitlist signup, or referral can be joined back to the exact line that was live. |
| `Secondary Line Key` | Lookup of `Key` via `Secondary Line` | Convenience for views and Zapier. |

### 3c. New field on `Subscribers`

| Field | Type | Notes |
|---|---|---|
| `Milestones Sent` | Multiple select: `6mo`, `12mo` | Written by the script so each milestone line goes out once per subscriber. |

### 3d. Fields to confirm exist (needed for placeholders)

The scripts already use these, so they're confirmed: `Cleaning Log.Block`, `Cleaning Log.Date and Time`, `Cleaning Log.Cleaner`, `Cleaning Log.Email Delayed`, `Blocks.Block Name (Friendly)`, `Blocks.Subscribers`, `Blocks.Block Page URL`, `Subscribers.Email`, `Subscribers.Display Name`, `Subscribers.Cleaning Notifications Opt-In`, `Subscribers.Contribution Status (from Active Subscriptions)`, `Cleaners.Display Name`.

Still to confirm (set the names in `SECONDARY_CONFIG` once known):

- **Subscription start date per subscriber.** Needed for `cleaning_count` and `tenure_months`. Active Subscriptions has a created-time field and a plain date field that looks like a start date; confirm which one is the real subscription start, then expose it on Subscribers as a lookup (e.g. `Subscription Start (from Active Subscriptions)`), taking the earliest if multiple.
- **Bags per cleaning.** Cleaning Log has a litter-level single select (Rare / Light / Medium / Heavy / Severe) but no numeric bag count. For `block_bags_total`, either add a `Bags` number field cleaners fill in going forward, or map litter level to an estimate (Rare 0, Light 0.5, Medium 1, Heavy 2, Severe 3) and label the stat as an estimate. Recommendation: map for now, add the real field in the cleaner hub later.
- **Cleaner consent to be named.** For the cleaner spotlight line, add `OK to Name in Emails` (checkbox) on `Cleaners`. The script falls back to "your cleaner" if unchecked.

---

## 4. Postmark template change

Template `45583435`. Add this block directly under the "See your cleaning photos" button, above the footer. Mustachio renders the section only when `secondary` is present in the TemplateModel.

**HTML body:**

```html
{{#secondary}}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:24px;">
  <tr>
    <td style="border-top:1px solid #e3e3e3; padding-top:16px; font-size:15px; line-height:1.5; color:#333;">
      {{text}}
      {{#cta_url}}
      &nbsp;<a href="{{cta_url}}" style="color:#111; font-weight:600;">{{cta_label}}</a>
      {{/cta_url}}
    </td>
  </tr>
</table>
{{/secondary}}
```

**Text body:**

```
{{#secondary}}

{{text}}{{#cta_url}} {{cta_label}}: {{cta_url}}{{/cta_url}}
{{/secondary}}
```

Notes:

- Inside `{{#secondary}}` the context is the `secondary` object, so `{{text}}` is `secondary.text`.
- `{{#cta_url}}...{{/cta_url}}` is a nested section: renders only if `cta_url` is a non-empty string.
- Keep `{{text}}` double-braced (HTML-escaped). The script sends plain text, never HTML.
- Nothing else in the template changes. Existing model keys (`block_name`, `cleaning_date`, `cleaner_first_name`, `preference_url`, `display_name`, `block_page_url`) stay as they are.
- Send yourself a test with and without `secondary` in the model before deploying the script.

---

## 5. Script changes

Both scripts get the same module pasted in (they are duplicated by design, one runs immediately, one runs at 6:15am for quiet-hours sends). Keep the module byte-identical in both. In the repo, keep it as its own file and concatenate at deploy time, or just copy-paste and diff.

### 5a. Shared module: `secondary-line.js`

Paste this above the `// ── Send via Postmark` section in each script.

```js
// ════════════════════════════════════════════════════════════
// SECONDARY LINE MODULE (keep identical in both send scripts)
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
    cleaningLogLinkField: "Secondary Line",            // on Cleaning Log
    subscriberMilestonesField: "Milestones Sent",      // on Subscribers (multi select: "6mo", "12mo")
    subscriberStartField: "Subscription Start (from Active Subscriptions)", // TODO confirm name
    cleanerConsentField: "OK to Name in Emails",       // on Cleaners, TODO create
    cleaningLogBagsField: null,                        // set to "Bags" once a numeric field exists
    cleaningLogLitterField: "Litter Level",            // TODO confirm name of the Rare/Light/... select
    litterToBags: { "Rare": 0, "Light": 0.5, "Medium": 1, "Heavy": 2, "Severe": 3 },
    utm: { source: "cleaning_email", medium: "email", campaign: "post_clean_secondary" },
};

// Load rotation + milestone lines. One query.
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

    const active = q.records.filter(r => r.getCellValue(c.f.active) === true && inWindow(r));
    const modeOf = (r) => (r.getCellValue(c.f.mode) || {}).name || "Rotation";

    const rotation = active.filter(r => modeOf(r) === "Rotation");
    const milestones = active.filter(r => modeOf(r) === "Milestone");

    if (rotation.length > 1) {
        console.log(`⚠ ${rotation.length} rotation lines are Active. Only one is allowed. Sending WITHOUT a secondary line. Fix: ${rotation.map(r => r.getCellValue(c.f.key)).join(", ")}`);
        return { rotation: null, milestones, table };
    }

    return { rotation: rotation[0] || null, milestones, table };
}

// Replace {placeholder} tokens. Unknown or empty placeholders cause the line to be dropped
// (better no line than "your Nth cleaning" with a blank).
function fillPlaceholders(text, ctx) {
    if (!text) return { ok: false, out: "" };
    let missing = false;
    const out = text.replace(/\{([a-z_]+)\}/g, (m, key) => {
        const v = ctx[key];
        if (v === undefined || v === null || v === "") { missing = true; return m; }
        return String(v);
    });
    return { ok: !missing, out };
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
    return (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
}

// Build the secondary object for one recipient, or null.
// ctx: { display_name, block_name, block_page_url, cleaner_first_name, cleaning_count,
//        cleaning_count_ordinal, block_bags_total, tenure_months, milestonesSent: [] }
function buildSecondary(lines, ctx) {
    const c = SECONDARY_CONFIG;

    // 1. Milestone override (per subscriber, once per milestone)
    for (const m of lines.milestones) {
        const months = m.getCellValue(c.f.milestoneMonths);
        const tag = `${months}mo`;
        if (!months || ctx.tenure_months == null) continue;
        if (ctx.tenure_months < months) continue;
        if ((ctx.milestonesSent || []).includes(tag)) continue;
        const built = renderLine(m, ctx);
        if (built) return { ...built, milestoneTag: tag };
    }

    // 2. Rotation line
    if (!lines.rotation) return null;
    return renderLine(lines.rotation, ctx);
}

function renderLine(rec, ctx) {
    const c = SECONDARY_CONFIG;
    const key = rec.getCellValue(c.f.key);
    const t = fillPlaceholders(rec.getCellValue(c.f.text), ctx);
    if (!t.ok) { console.log(`  secondary "${key}" skipped for ${ctx.display_name}: missing placeholder data`); return null; }

    let ctaUrl = "";
    const rawUrl = rec.getCellValue(c.f.ctaUrl);
    if (rawUrl) {
        const u = fillPlaceholders(rawUrl, ctx);
        if (!u.ok) { console.log(`  secondary "${key}" skipped: missing URL placeholder`); return null; }
        ctaUrl = appendUtm(u.out, key);
    }

    return {
        key,
        record: rec,
        model: {
            text: t.out,
            cta_label: rec.getCellValue(c.f.ctaLabel) || "",
            cta_url: ctaUrl,
        },
    };
}

// After a successful send: stamp the log, bump counters, mark milestones.
async function recordSecondarySends(lines, cleaningLogTable, cleaningLogRecordId, sentSecondaries, subscribersTable) {
    const c = SECONDARY_CONFIG;
    if (sentSecondaries.length === 0) return;

    // Count per line
    const byKey = new Map();
    for (const s of sentSecondaries) {
        if (!byKey.has(s.key)) byKey.set(s.key, { record: s.record, count: 0 });
        byKey.get(s.key).count++;
    }
    const today = new Date().toISOString().slice(0, 10);
    for (const { record, count } of byKey.values()) {
        const prev = record.getCellValue(c.f.emailsSent) || 0;
        const fields = { [c.f.emailsSent]: prev + count, [c.f.lastSent]: today };
        if (!record.getCellValue(c.f.firstSent)) fields[c.f.firstSent] = today;
        await lines.table.updateRecordAsync(record.id, fields);
    }

    // Stamp the cleaning log with the rotation line (milestones are per-subscriber, tracked below)
    const rotationSend = sentSecondaries.find(s => !s.milestoneTag);
    if (rotationSend) {
        await cleaningLogTable.updateRecordAsync(cleaningLogRecordId, {
            [c.cleaningLogLinkField]: [{ id: rotationSend.record.id }],
        });
    }

    // Milestones: mark on the subscriber so they never repeat
    for (const s of sentSecondaries.filter(x => x.milestoneTag)) {
        const existing = (s.milestonesSent || []).map(n => ({ name: n }));
        await subscribersTable.updateRecordAsync(s.subscriberId, {
            [c.subscriberMilestonesField]: [...existing, { name: s.milestoneTag }],
        });
    }
}
```

### 5b. Changes to the immediate script (`wflCdrhjYRo6d23pd`)

Find these spots in the existing script and patch as noted.

**(1) Subscriber fetch.** Add the two new fields to the `selectRecordAsync` fields list:

```js
fields: ["Email", "Cleaning Notifications Opt-In", "Contribution Status (from Active Subscriptions)", "Display Name",
         SECONDARY_CONFIG.subscriberStartField, SECONDARY_CONFIG.subscriberMilestonesField]
```

and when pushing to `emailRecipients`, carry the extra data:

```js
emailRecipients.push({
    email: typeof email === "object" ? email.email || email : email,
    subscriberName: displayName,
    subscriberId: subscriber.id,
    startDate: subscriber.getCellValue(SECONDARY_CONFIG.subscriberStartField),   // may be array (lookup)
    milestonesSent: (subscriber.getCellValue(SECONDARY_CONFIG.subscriberMilestonesField) || []).map(x => x.name),
});
```

**(2) Cleaner consent.** Where the cleaner is fetched, also read `SECONDARY_CONFIG.cleanerConsentField` and keep a `cleanerNameable` boolean. Expose `cleaner_first_name` to the secondary context only when true.

**(3) Block stats, lazy.** Right before building the Postmark payload, after `loadSecondaryLines()`:

```js
const lines = await loadSecondaryLines();
const needsCounts = [lines.rotation, ...lines.milestones].some(r =>
    r && /\{(cleaning_count|cleaning_count_ordinal|block_bags_total)\}/.test(r.getCellValue(SECONDARY_CONFIG.f.text) || ""));

let blockLogs = [];
if (needsCounts) {
    const logQ = await cleaningLogTable.selectRecordsAsync({
        fields: ["Block", "Date and Time", SECONDARY_CONFIG.cleaningLogBagsField, SECONDARY_CONFIG.cleaningLogLitterField].filter(Boolean)
    });
    blockLogs = logQ.records.filter(r => (r.getCellValue("Block") || []).some(b => b.id === blockId));
}
const bagsOf = (r) => {
    if (SECONDARY_CONFIG.cleaningLogBagsField) return r.getCellValue(SECONDARY_CONFIG.cleaningLogBagsField) || 0;
    const lvl = ((r.getCellValue(SECONDARY_CONFIG.cleaningLogLitterField) || {}).name || "").split(".")[0].trim();
    return SECONDARY_CONFIG.litterToBags[lvl] || 0;
};
const blockBagsTotal = Math.round(blockLogs.reduce((s, r) => s + bagsOf(r), 0));
```

**(4) Payload.** Replace the `Messages:` map so each recipient gets its own `secondary`:

```js
const sentSecondaries = [];
const messages = emailRecipients.map(r => {
    const start = Array.isArray(r.startDate) ? r.startDate[0] : r.startDate;
    const startD = start ? new Date(start) : null;
    const now = new Date();
    const myLogs = startD ? blockLogs.filter(l => new Date(l.getCellValue("Date and Time")) >= startD) : [];
    const ctx = {
        display_name: r.subscriberName,
        block_name: blockName,
        block_page_url: blockPageUrl,
        cleaner_first_name: cleanerNameable ? cleanerFirstName : null,
        cleaning_count: needsCounts && startD ? myLogs.length : null,
        cleaning_count_ordinal: needsCounts && startD ? ordinal(myLogs.length) : null,
        block_bags_total: needsCounts ? blockBagsTotal : null,
        tenure_months: startD ? monthsBetween(startD, now) : null,
        milestonesSent: r.milestonesSent,
    };
    const sec = buildSecondary(lines, ctx);
    if (sec) sentSecondaries.push({ ...sec, subscriberId: r.subscriberId, milestonesSent: r.milestonesSent, email: r.email });

    const TemplateModel = {
        block_name: blockName,
        cleaning_date: cleaningDate,
        cleaner_first_name: cleanerFirstName,
        preference_url: PREFERENCE_PAGE_URL,
        display_name: r.subscriberName,
        block_page_url: blockPageUrl,
    };
    if (sec) TemplateModel.secondary = sec.model;

    return { From: "support@shareglitter.com", To: r.email, TemplateId: POSTMARK_TEMPLATE_ID, TemplateModel, MessageStream: "cleaning-notifications" };
});
const postmarkPayload = { Messages: messages };
```

**(5) After send.** Inside the `if (response.ok)` branch, only count secondaries for messages that actually succeeded, then record:

```js
const okEmails = new Set(result.filter(m => m.ErrorCode === 0).map(m => m.To.toLowerCase()));
const succeeded = sentSecondaries.filter(s => okEmails.has(s.email.toLowerCase()));
await recordSecondarySends(lines, cleaningLogTable, cleaningLogRecordId, succeeded, subscribersTable);
```

**(6) Quiet-hours path is unchanged.** If the record is flagged `Email Delayed`, the morning script handles the secondary line at send time, so the line that's active at 6:15am is the one that goes out. That's the correct behavior.

### 5c. Changes to the morning catch-up script (`wflfaR1X0DQAwzTU2`)

Same module, same patches, with two differences:

- It already loads all tables up front (to stay under the 30-query limit). Add `SECONDARY_CONFIG.subscriberStartField` and `subscriberMilestonesField` to the Subscribers fields list, add the litter/bags field to the Cleaning Log fields list, and add the cleaner consent field to the Cleaners list. Then call `loadSecondaryLines()` once at the top (one more query, total 5) and reuse `lines` for every delayed record.
- `blockLogs` comes from `allCleaningLogs.records.filter(...)` instead of a new query.

Query budget after changes: 5 loads + per-record updates (Email Delayed clear, Secondary Line stamp, line counters, milestone marks). Each update is a write, not a query, but watch the run log the first week for the 30-query ceiling if a night has many delayed cleanings.

---

## 6. Placeholder catalog

Placeholders use single braces so they never collide with Postmark's `{{ }}`. The script fills them before the payload goes out, so Postmark only ever sees final text.

| Placeholder | Value | Source | Needed by ideas |
|---|---|---|---|
| `{display_name}` | Subscriber display name | already in script | any |
| `{block_name}` | Friendly block name | already in script | any |
| `{block_page_url}` | Block page URL (usable in CTA URL too) | already in script | 1, 3 |
| `{cleaner_first_name}` | Cleaner's first name, only if consent checkbox is on | Cleaners table + new consent field | 9 |
| `{cleaning_count}` | Number of cleanings on this block since the subscriber's start date | Cleaning Log + subscription start | 3 |
| `{cleaning_count_ordinal}` | Same, as "12th" | derived | 3 |
| `{block_bags_total}` | Total bags collected on this block (real field or litter-level estimate) | Cleaning Log | 3 |
| `{tenure_months}` | Whole months since subscription start | subscription start | 13 |

Rule: if a line references a placeholder the script can't fill for that recipient, the line is dropped for that recipient (email still sends, just without the secondary). This is what makes it safe to turn on the impact-stat line before every subscriber has a clean start date.

---

## 7. Seed rows (from the president's doc)

| Key | Mode | Line Text | CTA Label | CTA URL |
|---|---|---|---|---|
| `referral` | Rotation | Know a neighbor who'd want this for their block? Forward this email or share your block page. | Share your block page | `{block_page_url}` |
| `satisfaction` | Rotation | How'd we do? Reply and let us know. | | |
| `impact_stat` | Rotation | This was your {cleaning_count_ordinal} cleaning. Your block has collected about {block_bags_total} bags so far. | See your block page | `{block_page_url}` |
| `services_waitlist` | Rotation | Curious about compost, leaves, weeds, or snow? Join the waitlist. | Join the waitlist | TODO waitlist form URL |
| `trash_can` | Rotation | Ask about adding a trash can to your block. | Ask us | TODO form or mailto |
| `impact_fund` | Rotation | Want to help a block that needs support? Chip in to the Impact Fund. | Impact Fund | TODO |
| `ambassador` | Rotation | Want to help organize your block or bring in neighbors? Let us know. | Let us know | TODO |
| `review` | Rotation | Enjoying Glitter? A quick Google review helps other blocks find us. | Leave a review | TODO Google review link |
| `cleaner_spotlight` | Rotation | Your block was cleaned by {cleaner_first_name}, a neighbor earning a living wage doing it. | | |
| `social_share` | Rotation | Tag @shareglitter if you post about your clean block. | | |
| `frequency_upgrade` | Rotation | Want your block cleaned twice a month instead of once? | Ask about upgrading | TODO |
| `sponsor_block` | Rotation | Know a block that could use this but can't afford it? Sponsor a cleaning for them. | Sponsor a block | TODO |
| `milestone_6mo` | Milestone (6) | Thank you for six months of clean blocks. | | |
| `milestone_12mo` | Milestone (12) | Thank you for a year of clean blocks. | | |

Set `Active` on `referral` only (it's the one running now). Set `Active` on both milestone rows if you want them live from day one.

Three items need a decision before their row can go live:

- **`cleaner_spotlight`**: needs the consent checkbox on Cleaners populated. Until then it silently drops for every recipient.
- **`satisfaction`**: no link, so it depends entirely on Reply-To. Confirm the template's Reply-To goes to a monitored inbox (support@) and that replies get triaged. Consider a Postmark inbound webhook to Slack later.
- **`frequency_upgrade`**: should probably only show to subscribers whose block is currently on a once-a-month cadence. That needs a per-recipient eligibility check the current design doesn't have. Ship it as a plain rotation line first; add an `Eligibility` field (formula name on Blocks to check) as a v2 if it gets traction.

---

## 8. Attribution and measurement

Three layers, cheapest first:

1. **UTM on every CTA.** `utm_source=cleaning_email&utm_medium=email&utm_campaign=post_clean_secondary&utm_content=<key>`. Any web destination (Softr block page, waitlist form, review link) can be read in GA or Softr analytics by `utm_content`.
2. **Stamp on Cleaning Log.** `Secondary Line` link tells you which line was live for each cleaning event. A view grouped by `Secondary Line Key` with the date range gives you the denominator per idea.
3. **Source tagging on outcomes.** The president's doc already assumes `Source: referral` on new signups. For the other ideas, add the matching source values to whatever intake captures the outcome (waitlist form, upgrade request, review count) so the numerator lines up with the key. Where the outcome is a reply, count replies in the support inbox during the window, no plumbing needed.

Per-line counters (`Emails Sent`, `First Sent`, `Last Sent`) live on the config table so the president can see send volume without opening a script log.

---

## 9. Rollout and test plan

1. Create the table and fields in section 3. Seed the 14 rows. Leave everything inactive.
2. Edit Postmark template `45583435` per section 4. Send a test with `secondary` present and absent. Check HTML and text bodies, and the link.
3. In a test copy of the immediate script (or the automation's test runner), run against a recent Cleaning Log record with `referral` active. Confirm: email has the line, link has UTM, Cleaning Log got stamped, `Emails Sent` incremented.
4. Activate two rotation rows on purpose. Confirm the script logs the warning and sends with no secondary. Deactivate one.
5. Activate `impact_stat` with no start dates populated. Confirm emails still go out with no secondary and the log says "missing placeholder data". Then populate one subscriber's start date and confirm they get the line.
6. Deploy to both automations. Watch the 6:15am run log the next morning.
7. Hand the president the table. The rotation runs from there.

---

## 10. Repo layout (softr-blocks / glitter)

```
email/
  post-clean/
    README.md                       ← this doc
    secondary-line.js               ← module in 5a, the one source of truth
    send-immediate.js               ← full immediate script, with module pasted in
    send-morning-catchup.js         ← full catch-up script, with module pasted in
    postmark-template-45583435.html ← HTML body as deployed
    postmark-template-45583435.txt  ← text body as deployed
    seed-lines.csv                  ← the 14 rows for import
```

**Secrets.** Both live scripts currently hardcode the Postmark server token. Before committing, replace it with a placeholder (`const POSTMARK_SERVER_TOKEN = "<<POSTMARK_SERVER_TOKEN>>";`) and keep the real value only in Airtable. Airtable automation scripts have no secrets manager, so the token will still sit in the automation, but it should never land in git. Also rotate the token once the repo exists, since it's been pasted in two places already.

---

## 11. Open questions for Sid / the president

1. Which field is the canonical subscription start date, and should it live on Subscribers as a lookup?
2. Bag counts: add a real `Bags` field to the cleaner flow, or ship the litter-level estimate and say "about N bags"?
3. Cleaner naming: OK to add a consent checkbox and ask cleaners, or leave `cleaner_spotlight` off?
4. Where do the six TODO CTA URLs point (waitlist, trash can, Impact Fund, ambassador, review, upgrade, sponsor)?
5. Milestones: should the 6 and 12 month lines be on from day one, and do we want them to override the rotation line that day (current design) or add a second line (which breaks the one-line rule, so recommended no)?
