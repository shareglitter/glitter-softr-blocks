# Cleaning email — roadmap

**Status:** nothing in this file is built. How the email ships today is in `docs/cleaning_email.md`; read that first, especially the rule that the immediate script and the morning catch-up script build the same `TemplateModel`.
**Last merged:** 2026-09-18
**Sources:** (1) the president's Google Doc "Cleaning Confirmation Email — Test Ideas" (Sep 17, 2026), turned into a build spec in a Claude chat; (2) her verbal asks relayed the same week: forward/share links, a thumbs up/down, and a four-across "4 more ways to get involved". The unmodified chat spec is in git history at commit `395a257` as `docs/post-clean-email-secondary-slot.md`.
**Base:** Subscription Blocks (`appzuuUtAQVDg0YW1`)
**Automations touched:**
- `New Cleaning Log: Last Clean Date & Send Email Notification` (`wflCdrhjYRo6d23pd`), script step "Finds subscribers to cleaned block and sends Postmark Broadcast email"
- `Send Delayed Cleaning Emails` (`wflfaR1X0DQAwzTU2`), the 6:15am ET cron catch-up
**Postmark:** template `45583435`, stream `cleaning-notifications`, from `support@shareglitter.com`

---

## How the pieces fit

The two sources describe overlapping things, and one pair conflicts.

| Ask | Where it sits |
|---|---|
| Forward this email / share this link | **Shipped 2026-09-18** as the `{{#share}}` section. It is rotation idea 1 (`referral`) in richer form. |
| One rotating secondary line, 13 ideas | Part 1. The main build. |
| Thumbs up / down | Part 2. A richer form of rotation idea `satisfaction`. |
| Four-across "4 more ways" | Part 3. Not in her doc, and it conflicts with the doc's one-line rule. |

Her doc's hard constraints apply to everything here: exactly one secondary element per email, below the transactional content, no incentive attached, one idea at a time with attribution per idea.

**What that means for the share section.** Today it is always on, because there is no rotation yet. Once Part 1 ships, the share section becomes how the `referral` key renders: the script sends `share` only when `referral` is the active rotation line, and sends `secondary` for every other key, so an email never carries both. Until Part 1 ships, nothing needs to change.

**The referral code on the share link.** The shipped link is `<block page>?code=<Referral Code>`, which is what credits the referrer $10 through the Referral Matching automation. The email copy does not mention any reward, but her doc says no incentive attached to the secondary line. Whether a silent attribution code counts is her call, with counsel if she wants certainty. Falling back is a one-line change in `buildShare()`: send the bare block URL with a UTM instead.

---

## Part 1. Rotating secondary slot

### 1. Goal

Add one rotating "secondary line" below the "See your cleaning photos" button in the cleaning confirmation email, so the president can cycle through 13 growth/retention/revenue/mission ideas every 2 to 3 weeks without any new scripts or templates per idea.

Hard constraints carried over from the president's doc (these keep the email transactional under CAN-SPAM):

- Exactly one secondary line per email. Never two.
- Placed below the main transactional content.
- No incentive attached to the line (no discounts, credits, or rewards).
- Rotation is one idea at a time. Attribution is tracked per idea.

### 2. Architecture in one paragraph

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

### 3. Airtable changes

#### 3a. New table: `Email Secondary Lines`

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

#### 3b. New fields on `Cleaning Log`

| Field | Type | Notes |
|---|---|---|
| `Secondary Line` | Link to `Email Secondary Lines` | Stamped by the script after a successful send. One value. This is the attribution anchor: any reply, upgrade, waitlist signup, or referral can be joined back to the exact line that was live. |
| `Secondary Line Key` | Lookup of `Key` via `Secondary Line` | Convenience for views and Zapier. |

#### 3c. New field on `Subscribers`

| Field | Type | Notes |
|---|---|---|
| `Milestones Sent` | Multiple select: `6mo`, `12mo` | Written by the script so each milestone line goes out once per subscriber. |

#### 3d. Fields to confirm exist (needed for placeholders)

The scripts already use these, so they're confirmed: `Cleaning Log.Block`, `Cleaning Log.Date and Time`, `Cleaning Log.Cleaner`, `Cleaning Log.Email Delayed`, `Blocks.Block Name (Friendly)`, `Blocks.Subscribers`, `Blocks.Block Page URL`, `Subscribers.Email`, `Subscribers.Display Name`, `Subscribers.Cleaning Notifications Opt-In`, `Subscribers.Contribution Status (from Active Subscriptions)`, `Cleaners.Display Name`.

Checked against the live schema on 2026-09-18:

- **Subscription start date.** There is no plain start-date field. The closest is `Member Since` (created time) on both Subscribers and Active Subscriptions. Caveat: in a sample of four opted-in Subscribers, two had a created time of 2024-06-17, which looks like a bulk import date rather than a join date (check how many rows share it), so `tenure_months` and `cleaning_count` would be wrong for the earliest members. Either backfill a real `Subscription Start` date field for those rows and use it, or accept `Member Since` and keep the milestone lines off until it is backfilled.
- **Bags per cleaning.** There is no numeric bag count and no field called `Litter Level`. Cleaning Log has two single selects, `Trash` and `Debris`, plus a formula `Numeric Value of Litter Index`. For `block_bags_total`, either add a `Bags` number field cleaners fill in going forward, or map the `Trash` select to an estimate and label the stat as an estimate. Confirm the select's option names before writing `litterToBags`. Recommendation: map for now, add the real field in the cleaner hub later.
- **Cleaner consent to be named.** No consent field exists on `Cleaners` yet. For the cleaner spotlight line, add `OK to Name in Emails` (checkbox). The script falls back to "your cleaner" if unchecked. Note the main email body already names the cleaner by first name today, so this is a wider question than the spotlight line.

---

### 4. Postmark template change

Template `45583435` (repo copy: `airtable_automations/templates/post_cleaning_emails_postmark.html`). Add this block inside the card, after the "Or paste this link" row and before the `{{#share}}` section, restyled to match the card (Epilogue font stack, `#e8e6df` divider, `#0F6E56` link). Mustachio renders the section only when `secondary` is present in the TemplateModel. See "How the pieces fit" above for how `secondary` and `share` avoid appearing together.

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
- Nothing else in the template changes. Existing model keys (`block_name`, `cleaning_date`, `cleaner_first_name`, `preference_url`, `display_name`, `block_page_url`, and the `share` object added 2026-09-18) stay as they are.
- The repo has no copy of the template's text body. Pull it from Postmark into `airtable_automations/templates/` before editing it.
- Send yourself a test with and without `secondary` in the model before deploying the script.

---

### 5. Script changes

Both scripts get the same module pasted in (they are duplicated by design, one runs immediately, one runs at 6:15am for quiet-hours sends). Keep the module byte-identical in both, the same way `buildShare()` already is. Repo copies: `airtable_automations/email_automation.js` (immediate) and `airtable_automations/email_automation_delayed.js` (catch-up).

#### 5a. Shared module: `secondary-line.js`

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
    subscriberStartField: "Member Since",              // created time; see 3d caveat about imported rows
    cleanerConsentField: "OK to Name in Emails",       // on Cleaners, TODO create
    cleaningLogBagsField: null,                        // set to "Bags" once a numeric field exists
    cleaningLogLitterField: "Trash",                   // single select; confirm option names match litterToBags
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

#### 5b. Changes to the immediate script (`wflCdrhjYRo6d23pd`)

Find these spots in the existing script and patch as noted.

**(1) Subscriber fetch.** Add the two new fields to the `selectRecordAsync` fields list:

```js
fields: ["Email", "Cleaning Notifications Opt-In", "Contribution Status (from Active Subscriptions)", "Display Name", "Referral Code",
         SECONDARY_CONFIG.subscriberStartField, SECONDARY_CONFIG.subscriberMilestonesField]
```

and when pushing to `emailRecipients`, carry the extra data:

```js
emailRecipients.push({
    email: typeof email === "object" ? email.email || email : email,
    subscriberName: displayName,
    referralCode: subscriber.getCellValueAsString("Referral Code"),   // already there for buildShare()
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
    // `referral` is rendered by the richer {{#share}} section instead of the one-line slot,
    // so an email never carries both. See "How the pieces fit".
    if (sec && sec.key === "referral") {
        TemplateModel.share = buildShare(blockPageUrl, blockName, r.referralCode);
    } else if (sec) {
        TemplateModel.secondary = sec.model;
    }

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

#### 5c. Changes to the morning catch-up script (`wflfaR1X0DQAwzTU2`)

Same module, same patches, with two differences:

- It already loads all tables up front (to stay under the 30-query limit). Add `SECONDARY_CONFIG.subscriberStartField` and `subscriberMilestonesField` to the Subscribers fields list, add the litter/bags field to the Cleaning Log fields list, and add the cleaner consent field to the Cleaners list. Then call `loadSecondaryLines()` once at the top (one more query, total 5) and reuse `lines` for every delayed record.
- `blockLogs` comes from `allCleaningLogs.records.filter(...)` instead of a new query.

Query budget after changes: 5 loads + per-record updates (Email Delayed clear, Secondary Line stamp, line counters, milestone marks). Each update is a write, not a query, but watch the run log the first week for the 30-query ceiling if a night has many delayed cleanings.

---

### 6. Placeholder catalog

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

### 7. Seed rows (from the president's doc)

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

Set `Active` on `referral` only (it's the one running now, as the forward/share section shipped 2026-09-18; its `Line Text` and CTA here are only used if the share section is ever retired). Set `Active` on both milestone rows if you want them live from day one.

Three items need a decision before their row can go live:

- **`cleaner_spotlight`**: needs the consent checkbox on Cleaners populated. Until then it silently drops for every recipient.
- **`satisfaction`**: no link, so it depends entirely on Reply-To. Confirm the template's Reply-To goes to a monitored inbox (support@) and that replies get triaged. Consider a Postmark inbound webhook to Slack later.
- **`frequency_upgrade`**: should probably only show to subscribers whose block is currently on a once-a-month cadence. That needs a per-recipient eligibility check the current design doesn't have. Ship it as a plain rotation line first; add an `Eligibility` field (formula name on Blocks to check) as a v2 if it gets traction.

---

### 8. Attribution and measurement

Three layers, cheapest first:

1. **UTM on every CTA.** `utm_source=cleaning_email&utm_medium=email&utm_campaign=post_clean_secondary&utm_content=<key>`. Any web destination (Softr block page, waitlist form, review link) can be read in GA or Softr analytics by `utm_content`.
2. **Stamp on Cleaning Log.** `Secondary Line` link tells you which line was live for each cleaning event. A view grouped by `Secondary Line Key` with the date range gives you the denominator per idea.
3. **Source tagging on outcomes.** The president's doc already assumes `Source: referral` on new signups. For the other ideas, add the matching source values to whatever intake captures the outcome (waitlist form, upgrade request, review count) so the numerator lines up with the key. Where the outcome is a reply, count replies in the support inbox during the window, no plumbing needed.

Per-line counters (`Emails Sent`, `First Sent`, `Last Sent`) live on the config table so the president can see send volume without opening a script log.

---

### 9. Rollout and test plan

1. Create the table and fields in section 3. Seed the 14 rows. Leave everything inactive.
2. Edit Postmark template `45583435` per section 4. Send a test with `secondary` present and absent. Check HTML and text bodies, and the link.
3. In a test copy of the immediate script (or the automation's test runner), run against a recent Cleaning Log record with `referral` active. Confirm: email has the line, link has UTM, Cleaning Log got stamped, `Emails Sent` incremented.
4. Activate two rotation rows on purpose. Confirm the script logs the warning and sends with no secondary. Deactivate one.
5. Activate `impact_stat` with no start dates populated. Confirm emails still go out with no secondary and the log says "missing placeholder data". Then populate one subscriber's start date and confirm they get the line.
6. Deploy to both automations. Watch the 6:15am run log the next morning.
7. Hand the president the table. The rotation runs from there.

---

## Part 2. "Like what you see?" thumbs up / thumbs down

This is the richer version of the `satisfaction` rotation line ("How'd we do? Reply and let us know."). The reply-based line needs no build at all, so run that first and build the thumbs only if replies show people want to give feedback. If built, treat it like `referral`: it renders in place of the one-line slot when `satisfaction` is the active key, never alongside another secondary.

Two image links in the email. The work is in where they point.

### Design

- **Do not point them straight at a Zapier Catch Hook.** Mail security scanners
  and link prefetchers open every URL in an email; each one would record a vote
  (same family as the blank-GET incident in `webhook_presence_guards.md`), and
  the person would land on raw JSON.
- Point them at a Softr page instead, e.g.
  `app.shareglitter.com/cleaning-feedback?v=up&log=<cleaningLogRecId>&sub=<subscriberRecId>`.
  A small custom block reads the params, **posts to a webhook from JavaScript**
  (scanners mostly don't run JS), and shows a thank you. On thumbs-down it also
  shows an optional "what did we miss?" textarea that posts a second time with
  the comment.
- Use record ids in the URL, never the email address.
- Latest vote per (log, subscriber) wins; dedupe in a view or rollup rather
  than in the Zap.
- Payoff beyond the email: votes link to the Cleaning Log row, so they roll up
  per cleaner next to Audits.

### Build steps

1. Airtable: new **Cleaning Feedback** table — link to Cleaning Log, link to
   Subscribers, `Vote` single select (Up / Down), `Comment` long text, created
   time. Add rollups on Cleaning Log and Cleaners if wanted.
2. Zapier: a **new** catch hook (do not reuse the signup webhook) → filter on
   `log` and `sub` both present → create the Cleaning Feedback record → on
   Down, post to Slack.
3. Softr: new page `/cleaning-feedback` with a new custom block
   (`blocks/cleaning_feedback.html`, `gc-` prefixed as usual).
4. Both scripts: add `feedback: { up_url, down_url }` to the model. The
   subscriber record id (`link.id`) and `cleaningLogRecord.id` are already in
   hand. Note the main script's recipient object does not keep the subscriber
   id today; add it next to `referralCode`.
5. Template: a `{{#feedback}}…{{/feedback}}` section with two linked images,
   so it stays hidden until the scripts send the URLs. Needs two hosted PNGs.

---

## Part 3. "Want more Glitter? Here are 4 more ways to get involved"

**Conflict to resolve first:** the president's own test-ideas doc sets "exactly one secondary line per email, never two" to keep this email transactional under CAN-SPAM. Four promotional tiles on every send is the opposite of that rule. Options: (a) drop it from this email and put the four-across in a separate marketing send (the `broadcast` stream, with its own unsubscribe), (b) accept the risk knowingly after a legal read, (c) make the four-across itself one rotation entry that replaces the line for a 2 to 3 week window. Do not build until she picks.

A four-across tile row between the card and the footer.

- Layout: four `inline-block` columns (~120px) inside one `<td>`, each with a
  96px icon, a bold title and a one-line blurb, the whole tile linked. With
  `inline-block` + `max-width` they fall to 2×2 on phones without relying on
  media queries (Gmail strips those in some contexts). Outlook needs the usual
  `<!--[if mso]>` ghost table around them.
- Needs four hosted PNG icons (the logo is served from the ActiveCampaign CDN;
  same place works).
- Start **static in the Postmark template** — no script change, and copy can
  be edited in Postmark without touching Airtable.
- Candidate tiles, all backed by things that already exist in the base:

  | Tile | Backed by |
  |---|---|
  | Refer a neighbor | `Referral Code`, reuse `share.url` |
  | Volunteer to put out bags | Bag Volunteer table |
  | Join the compost waitlist | Compost Interest table |
  | Chip in to the Impact / Neighborhood Fund | the two fund opt-in checkboxes |
  | Request flyers or door hangers | Outreach Materials table |
  | Become an ambassador | Ambassadors / Ambassador Leads |
  | Gift a cleaning | Gift Certificate Promo Codes base |

- Later, if wanted: pass `more_ways: [{title, blurb, url, img}]` from the
  scripts and render with `{{#each more_ways}}`, so tiles a subscriber already
  does (compost opted in, already a bag volunteer) can be swapped out.

---

## Part 4. Smaller follow-ups

- **Postmark Layouts.** If the redesign goes further, a Layout can hold the logo header and footer once, shared with the `referral-success` template, so brand tweaks happen in one place.
- **Block page share button.** `docs/share_button.md` copies the bare `Block Page URL`. A logged-in subscriber's share should carry their `?code=` the way the email link does (subject to the incentive decision above).
- **Secrets.** Both send scripts hardcode the Postmark server token, and `airtable_automations/postmark_automation_script.js` holds a second token plus a Slack webhook URL. All three scripts are deliberately **untracked in git** until this is fixed. The chat spec said Airtable has no secrets manager; the Airtable MCP exposes a `list_secrets` tool, so check the automation editor for a Secrets option first and fall back to a `<<POSTMARK_SERVER_TOKEN>>` placeholder in the repo copies if it is not available on this plan. Rotate both tokens and the webhook afterwards, since they have been pasted into chats.

---

## Open questions for Sid / the president

Decisions that block work:

1. Four-across versus the one-line rule: separate marketing email, accept the risk, or make it a rotation entry? (Part 3)
2. Is a silent `?code=` on the share link acceptable under "no incentive attached"? (How the pieces fit)
3. Subscription start date: backfill a real date for the rows that look bulk-imported on 2024-06-17, or run on `Member Since` with milestones off? (3d)
4. Bag counts: add a real `Bags` field to the cleaner flow, or ship an estimate from the `Trash` select and say "about N bags"? (3d)
5. Cleaner naming: add a consent checkbox and ask cleaners, or leave `cleaner_spotlight` off? (3d)
6. Where do the TODO CTA URLs point (waitlist, trash can, Impact Fund, ambassador, review, upgrade, sponsor)? (section 7)
7. Milestones: on from day one, and do they override the rotation line that day (current design) or add a second line (breaks the one-line rule, recommended no)?

Only if the thumbs get built (Part 2):

8. Does a thumbs-down start a support conversation, or just get logged?
9. Do cleaners ever see their own thumbs score?

Only if the four-across gets built (Part 3):

10. Which four tiles?
