# Cleaning email — roadmap

**Status:** Part 1 is **live** as of 2026-10-05: both live automations run the V3 scripts in `MODE = "live"`, the live Postmark template carries the secondary section, and `satisfaction` was the active line at go-live. The president approved the 14 lines in the Airtable table on 2026-10-02. A scheduled automation rotates the active line (section 10), set up the same day. Deferred to a later revision by Sid on 2026-10-02: several buttons on one line, milestone lines, and the four-across row (Part 3). Parts 2 to 4 are not built. How the email ships today is in `docs/cleaning_email.md`; read that first, especially the rule that the immediate script and the morning catch-up script build the same `TemplateModel`.
**Last merged:** 2026-10-05
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
| `Milestones Sent` | Multiple select: `6 months`, `12 months` (as created 2026-09-18) | Written by the script so each milestone line goes out once per subscriber. |

#### 3d. Fields to confirm exist (needed for placeholders)

The scripts already use these, so they're confirmed: `Cleaning Log.Block`, `Cleaning Log.Date and Time`, `Cleaning Log.Cleaner`, `Cleaning Log.Email Delayed`, `Blocks.Block Name (Friendly)`, `Blocks.Subscribers`, `Blocks.Block Page URL`, `Subscribers.Email`, `Subscribers.Display Name`, `Subscribers.Cleaning Notifications Opt-In`, `Subscribers.Contribution Status (from Active Subscriptions)`, `Cleaners.Display Name`.

Checked against the live schema on 2026-09-18:

- **Subscription start date.** There is no plain start-date field. The closest is `Member Since` (created time) on both Subscribers and Active Subscriptions. Caveat: in a sample of four opted-in Subscribers, two had a created time of 2024-06-17, which looks like a bulk import date rather than a join date (check how many rows share it), so `tenure_months` and `cleaning_count` would be wrong for the earliest members. Either backfill a real `Subscription Start` date field for those rows and use it, or accept `Member Since` and keep the milestone lines off until it is backfilled.
- **Bags per cleaning.** There is no numeric bag count and no field called `Litter Level`. Cleaning Log has two single selects, `Trash` and `Debris`, plus a formula `Numeric Value of Litter Index`. For `block_bags_total`, either add a `Bags` number field cleaners fill in going forward, or map the `Trash` select to an estimate and label the stat as an estimate. Confirm the select's option names before writing `litterToBags`. Recommendation: map for now, add the real field in the cleaner hub later.
- **Cleaner consent to be named.** No consent field exists on `Cleaners` yet. For the cleaner spotlight line, add `OK to Name in Emails` (checkbox). The script falls back to "your cleaner" if unchecked. Note the main email body already names the cleaner by first name today, so this is a wider question than the spotlight line.

---

### 4. Postmark template change

Built. The repo copies are the source of truth; paste them whole.

| Postmark field | Repo file |
|---|---|
| HTML body | `airtable_automations/templates/post_cleaning_emails_postmark.html` |
| Text body (new; Postmark had none) | `airtable_automations/templates/post_cleaning_emails_postmark.txt` |
| Preview models for the editor's test box | `airtable_automations/templates/sample_models.json` |

Three conditional sections, each invisible unless the script sends its object:

- `{{#secondary}}` — `{{text}}` plus an optional `{{#cta}}` with `{{label}}` / `{{url}}`. This differs from the first draft of this spec, which used flat `cta_url` / `cta_label` keys inside a nested `{{#cta_url}}` section; that relied on Mustachio resolving `cta_label` from the parent scope. An object avoids the question. **If the draft snippet was pasted into Postmark, replace it with the repo file.**
- `{{#share}}` — the forward section. Sent only when the line's key is `referral`. Since 2026-09-18 its copy is editable like every other line: the row's `Line Text` is the sentence (`{{text}}`), `CTA Label` is the forward button's label (`{{forward_label}}`), and `CTA URL` is ignored because the link is always the subscriber's personal `?code=` link. `{{^text}}` / `{{^forward_label}}` inverted sections hold fallback copy, so the V2 scripts (which send `share` without those keys) still render properly against the new template. The "Share this link" button was removed after the first test: a button that only opens the block page read as confusing. The personal link is still printed under the forward button for copy/paste.
- `{{#test_banner}}` — yellow strip naming the line, who the email was rendered as, and why a line was dropped. Sent only in test mode.

`{{text}}` stays double-braced (HTML-escaped). The script sends plain text, never HTML.

**Two templates during testing.** Duplicate template `45583435` in Postmark and give the copy the alias `cleaning-notification-test`. The test automation sends through the alias, so copy edits never touch live sends. Suggested subject for the copy: `{{#test_banner}}[TEST · {{line_key}}] {{/test_banner}}` followed by the live subject. Promote by pasting the tested HTML and text into `45583435`.

---

### 5. Script changes

Built as two files that share one module:

- `airtable_automations/email_automation_v3_secondary.js`, the immediate script: V2 plus the secondary-line module, with a `MODE` constant. The table below describes it.
- `airtable_automations/email_automation_delayed_v3_secondary.js`, the morning catch-up (added 2026-10-02). Same `MODE` constant and the same allowlist guardrails. Its test mode always uses the real rules (Active checkbox), previews the flagged logs or, when none are flagged, the `TEST.maxLogs` most recent ones, and writes nothing, so flags are left for the live run.

Everything between the `SECONDARY LINE MODULE` and `end secondary line module` markers is byte-identical in the two files, including `buildSubscriberModel()`, which builds the whole `TemplateModel`. Edit it in the immediate script, copy the block across, and let the harness confirm the copies match (scenario D0).

| | `MODE = "test"` | `MODE = "live"` |
|---|---|---|
| Recipients | only `TEST.recipients` (hard allowlist, 1 to 3 addresses) | the block's eligible subscribers |
| Rendered as | the first `TEST.maxPreviewsPerLog` eligible subscribers of the cleaned block | each subscriber |
| Tour of the whole table | `TEST.sendEveryLine: true` sends every usable row as its own email in one run, banner marked `[n/N]`, so one Test click previews all lines. Set `recipients` to one address first or the count doubles. | n/a |
| Nobody eligible on the block | still sends the testers a preview, rendered as the first linked subscriber, with the banner saying live would send nothing (`TEST.previewWhenNoneEligible`, on by default) | sends nothing |
| Template | alias `cleaning-notification-test` | id `45583435` |
| Line choice | `TEST.forceKeys`: `[]` for the real rules (the default since 2026-10-02, for go-live rehearsal), `["*"]` random tour of every row, or a list of keys | Active checkbox, date window, milestones, one-active guardrail |
| Airtable writes | **none** (no `Email Delayed`, no log stamp, no counters, no `Milestones Sent`) | all of them |
| Quiet hours | skips the send, writes nothing | sets `Email Delayed` for the catch-up |
| Postmark tag | `secondary-test` | `secondary:<key>` |

Guardrails in test mode: the script throws before doing anything if the placeholder addresses are still in `TEST.recipients`; `assertOnlyTestRecipients()` re-checks every message immediately before the Postmark call and throws if any `To` is off the list or a Cc/Bcc is present; and because nothing is written, a test run cannot mark a real subscriber's milestone as sent or pollute attribution counts.

Other differences from V2 worth knowing:

- The Postmark token is read with `input.secret("POSTMARK_SERVER_TOKEN")` (Airtable automation Secrets), so this file is safe to commit.
- Subscribers load in one query per 100 links instead of one query each, which removes the 30-query ceiling for big blocks.
- `Milestones Sent` options are `6 months` / `12 months` as created in Airtable, not `6mo` / `12mo`.
- A row renders buttons only when it has **both** labels and URLs. Rows whose URL is still TODO send as text only. Since V3.1 (2026-09-22) a row can carry several buttons: pipe-separate the labels and the URLs in the same order (`Facebook | Instagram | Nextdoor`). Mismatched counts drop the line rather than half-render it. A `mailto:` URL (the doc's Reply buttons) gets its placeholders URL-encoded and no UTM.
- The share link gets no UTM: it is the subscriber's personal link, it is printed for copy/paste, and `?code=` already carries attribution.
- Bag totals under 1 and cleaning counts of 0 count as missing data, so the line drops instead of saying "about 0 bags".
- `cleanerConsentField` is `"OK to Name in Emails"`, a checkbox on Cleaners (added 2026-09-18 once several cleaners had consented). `{cleaner_first_name}` is only available to a line when the cleaner who did that cleaning has it checked; otherwise `cleaner_spotlight` drops for that email. The field must exist before the script is pasted, because asking Airtable for a field name that does not exist fails the whole run.

Catch-up differences from its V2 worth knowing:

- A log keeps its `Email Delayed` flag when Postmark rejects the whole request (wrong token in the secret, missing template), so the next morning retries it. V2 cleared the flag regardless and those emails were lost. A network error still clears the flag, because the request may have gone through.
- `Emails Sent` is counted across all the logs of one run, and a milestone sent for one log is remembered for the next log in the same run.

`node airtable_automations/tests/harness_v3.js` runs both scripts against a mocked base and mocked Postmark through 33 scenarios: allowlist, table tour, nobody-eligible blocks, multi-button rows, mailto buttons, counts, weekly-block drop, forced lines, dropped placeholders, quiet hours, live write-back, a render of every row of the seed CSV (scenario 22, which prints the rendered lines), and for the catch-up: module identity, flag handling, running counters and message-for-message parity with the immediate script. It exits 1 on any failure. It resets `MODE`, `TEST.recipients`, `forceKeys` and `sendEveryLine` before each scenario, so it runs against the working copy even when that holds real test addresses. Run it after every script edit.

---

### 6. Placeholder catalog

Placeholders use single braces so they never collide with Postmark's `{{ }}`. The script fills them before the payload goes out, so Postmark only ever sees final text. They work in Line Text and in CTA URL.

| Placeholder | Value | Source |
|---|---|---|
| `{display_name}` | Subscriber display name | Subscribers |
| `{block_name}` | Friendly block name | Blocks |
| `{block_page_url}` | Block page URL, usable as a CTA URL | Blocks |
| `{cleaning_date}` | "Friday, September 18", the same date the greeting shows | Cleaning Log |
| `{referral_code}` | The subscriber's own code, e.g. `SUNNY-9IH` | Subscribers → `Referral Code` |
| `{share_url}` | Their personal `?code=` block link, usable as a CTA URL | derived |
| `{cleaner_name_in_greeting}` | Cleaner's first name **without** the consent gate, i.e. what the greeting already prints. Prefer `{cleaner_first_name}` for anything that talks about the cleaner as a person. | Cleaners |
| `{year}` | Current year in Eastern time | clock |
| `{cleaning_count_this_year}` / `{…_ordinal}` | Cleanings on this block this calendar year, since the subscriber's start | Cleaning Log + `Member Since` |
| `{cleaning_count}` / `{cleaning_count_ordinal}` | Same, all time since the subscriber's start | Cleaning Log + `Member Since` |
| `{block_cleaning_count}` / `{block_cleaning_count_ordinal}` | Every logged cleaning of the block, whenever the subscriber joined. Use this one for "your block's Nth cleaning" (added 2026-10-02) | Cleaning Log |
| `{block_bags_total}` | Total bags on this block, estimated from the `Trash` select until a `Bags` field exists | Cleaning Log |
| `{cleaner_first_name}` | Cleaner's first name, only when `OK to Name in Emails` is checked | Cleaners |
| `{block_frequency}` | Current cadence, lower-case: "every other week" | Blocks → `Frequency Label (Lookup)` |
| `{next_frequency}` | The next cadence up: "3 out of 4 weeks". **Blank for Every Week blocks**, so a line using it drops for them, which answers the doc's "what if already weekly" comment | Blocks → `Next Frequency Label` |
| `{tenure_months}` | Whole months since `Member Since` (drives milestones, rarely printed) | Subscribers |

Rule: if a line references a placeholder the script can't fill for that recipient, the line is dropped for that recipient (email still sends, just without the secondary). This is what makes it safe to turn on the impact-stat line before every subscriber has a clean start date.

---

### 7. The lines (approved by the president, 2026-10-02)

The Airtable table is the source of truth; lines are edited there. `airtable_automations/templates/email_secondary_lines_seed.csv` is a verbatim export of the table taken 2026-10-02, the version the president reviewed and agreed to. It replaces the 22-row list drafted on 2026-09-22 (that draft is in git history). Fourteen rotation rows, each with one button, no milestone rows:

| Key | Line Text | CTA Label | CTA URL |
|---|---|---|---|
| `referral` | Know a neighbor who'd want Glitter for their block? Earn $10 when they use your referral code ({referral_code}) and have them sign up at | Refer a neighbor to Glitter | ignored, see below |
| `satisfaction` | How did we do cleaning your block today? | Reply and let us know. | mailto:support@shareglitter.com?subject=Cleaning on {block_name} {cleaning_date} |
| `frequency_upgrade` | Want your block cleaned more often? | Increase your pledge | https://app.shareglitter.com/pledge |
| `compost` | Get shared compost on your block with Glitter's partnership with Bennett Compost | Join Compost Waitlist | https://shareglitter.com/compost |
| `impact_stat` | This was your block's {cleaning_count_ordinal} cleaning. We've collected about {block_bags_total} bags so far. | See your block's Glitter Hub page | {block_page_url} |
| `impact_fund` | Want to help fund cleanings in areas that can't afford it? | Chip into the Impact Fund | https://www.shareglitter.com/funds |
| `services_waitlist` | Curious about our new services like shared composting, trash cans, or leaf, weed, and snow removal? | Join the waitlist for one or more! | https://www.shareglitter.com/services |
| `door_hangers` | Want free materials to let your neighbors know about Glitter and get them to contribute? | Request door hangers and signs! | https://app.shareglitter.com/signs |
| `review` | Enjoying Glitter? A quick Google review helps other blocks find us. | Leave a review | https://g.page/r/CSo-5bIwtB-aEBM/review |
| `trash_can` | Ask about adding a trash can to your block that Glitter will install and maintain each week. | Add a trash can | https://www.shareglitter.com/services |
| `ambassador` | Want help talking to neighbors on your block about Glitter? | Let us know | https://app.shareglitter.com/neighbor-engagement |
| `cleaner_spotlight` | Your block was cleaned by {cleaner_first_name}, a neighbor earning a living wage through this work. | Learn more about who we hire. | https://www.youtube.com/watch?v=HPaqhyAfYs4 |
| `sponsor_block` | Want to help fund another block? You can make a pledge the same way you did for your block on our home page. | Sponsor a block | https://shareglitter.com |
| `social_share` | Posting on Instagram? Tag us! | @shareglitter | https://www.instagram.com/shareglitter |

Notes on these rows, as checked 2026-10-02:

- **No row is `Active` in the export.** Live mode with no active row sends the email with no secondary line at all, which also drops the forward section that V2 puts in every email. Tick exactly one before going live.
- **`referral` renders as the forward section**, not as a plain line: the sentence, then a button with the row's label that opens a pre-written mail draft, then the subscriber's personal `?code=` link. The row's CTA URL is not used. The sentence as written ends in "sign up at", which is followed by the button and then the link. The `Notes` cell in Airtable still describes the pre-2026-09-18 behaviour. To render it as a plain line with its own button and URL instead, set `shareKey: null` in `SECONDARY_CONFIG` in both scripts. Its copy also names a $10 reward, which is the first departure from the "no incentive attached" constraint in section 1; that was the president's call.
- **`impact_stat` says "your block's Nth cleaning" but `{cleaning_count_ordinal}` counts only since the subscriber joined.** Swap it for `{block_cleaning_count_ordinal}` in the row.
- **Bare `shareglitter.com` URLs** (`compost`, `sponsor_block`) redirect to `www.` and lose every UTM parameter except `utm_content` on the way. Write them with `www.` to keep the full set.
- **`door_hangers` and `ambassador`** point at hub pages that send a logged-out visitor through the login page first.
- All ten web URLs answered 200 with the UTM parameters attached, including the Google review and YouTube links.
- Several `Notes` cells still say "TODO: CTA URL" on rows that now have one, and `cleaner_spotlight`'s note predates the `OK to Name in Emails` field. Cosmetic.
- `satisfaction` says "today"; an email held overnight goes out the next morning.

---

### 8. Attribution and measurement

Three layers, cheapest first:

1. **UTM on every CTA.** `utm_source=cleaning_email&utm_medium=email&utm_campaign=post_clean_secondary&utm_content=<key>`. Any web destination (Softr block page, waitlist form, review link) can be read in GA or Softr analytics by `utm_content`.
2. **Stamp on Cleaning Log.** `Secondary Line` link tells you which line was live for each cleaning event. A view grouped by `Secondary Line Key` with the date range gives you the denominator per idea.
3. **Source tagging on outcomes.** The president's doc already assumes `Source: referral` on new signups. For the other ideas, add the matching source values to whatever intake captures the outcome (waitlist form, upgrade request, review count) so the numerator lines up with the key. Where the outcome is a reply, count replies in the support inbox during the window, no plumbing needed.

Per-line counters (`Emails Sent`, `First Sent`, `Last Sent`) live on the config table so the president can see send volume without opening a script log.

---

### 9. Rollout and test plan

**State as checked through the Airtable API on 2026-09-18 (evening):**

| Item | State |
|---|---|
| `Email Secondary Lines` table (`tblKKLTOfuKu6DmEL`) | Exists with the section 3a fields. The duplicate link was removed and the remaining one renamed `Cleaning Logs`. `Sends (logs)` count not added yet. |
| Seed rows | Imported by hand from `email_secondary_lines_seed.csv` per Sid, **but the API returned 0 records in this table on two reads right afterwards.** Confirm the 14 rows are really in this table (a CSV import that was previewed but not saved, or saved into another base, looks the same from the UI tab you were on). With no rows, every test email's banner reads "NO LINE: no usable row matches forceKeys". |
| Cleaning Log | `Secondary Line` (link) and `Key (from Secondary Line)` (lookup) are right. A leftover **text** field named `Email Secondary Lines` remains from deleting the duplicate link; delete it. |
| Subscribers | `Milestones Sent` exists with options `6 months` / `12 months`. |
| Test automation | `wfl9ZtmXDUoMB64uJ`, "New Cleaning Log: Last Clean Date & Send Email Notification copy", **not turned on yet**. A duplicate of the live automation with the write steps removed (no Last Clean Date update, no Schedule matcher, no First Clean Date branch); what remains is the read-only "Find associated block" step and the V3 script with `MODE = "test"`, `forceKeys: ["*"]`, input `recordId`. Rename it to start with "TEST:" so nobody mistakes it for the live one. |
| First end-to-end test | **Passed 2026-09-18.** Script step's Test button on a 1000 Dickinson St log: opted-out subscriber skipped, `referral` picked at random and rendered as the forward/share section, two emails delivered through the `cleaning-notification-test` template, nothing written to Airtable. The 14 seed rows are confirmed present (the earlier empty API read was stale). An initial 401 was a wrong value in the `POSTMARK_SERVER_TOKEN` secret. |
| Test automation switched on | **2026-09-18, evening.** Running in test mode for Sid and the president; every real cleaning outside quiet hours produces one banner-marked preview each. Review period is open-ended. |
| V3.1 tour test | **2026-09-22.** `sendEveryLine` tour of all 22 rows rendered cleanly after `{cleaning_date}` and `{referral_code}` were added. Sid is now reviewing copy with the president. Milestone rows removed from the table until `Member Since` is trustworthy. Open with her: whether three social buttons breaks the one-line rule. |
| Test recipients | Two staff addresses, both Sid's for now; add the president's when she is ready to receive them (max 3). |
| `Active (Rotation) Count` field | Skipped on purpose. A formula cannot count across rows, and the script already refuses to send a rotation line when more than one is active. |
| Catch-up script | **Ported 2026-10-02** as `email_automation_delayed_v3_secondary.js`. |
| Copy approval | **2026-10-02.** The president approved the 14 rows now in the table (exported to the seed CSV). Multi-button lines, milestones and the four-across are deferred to a later revision. |

| Go-live | **2026-10-05.** Template `45583435` updated, then both scripts pasted into the existing automations, each tested once in `MODE = "test"` (catch-up: 4 previews from the two most recent cleanings with an eligible subscriber; immediate: 2 previews) and switched to `"live"`. Active line: `satisfaction`. The test automation `wfl9ZtmXDUoMB64uJ` was deleted, so the Postmark template alias `cleaning-notification-test` is now only used by the scripts' own test mode. First live sends and the first 6:15am catch-up run had not been observed when this was written. |
| Lessons from the paste | The token must be added under the script step's **Secrets**, not as an input variable; as an input the script reads 0 characters and says so in its first log line. The catch-up's test mode originally previewed only the two newest logs and sent nothing when neither block had an eligible subscriber; it now passes over such blocks (9 of the 11 newest logs that day had nobody eligible). |

**Test phase** (history; the test automation no longer exists):

1. Postmark: duplicate template `45583435`, alias `cleaning-notification-test`. Paste the repo HTML and text bodies into the copy. Preview with each object in `sample_models.json`.
2. Airtable: test automation as described in the table above, with the secret `POSTMARK_SERVER_TOKEN` added on the script step.
3. Use the script step's Test button on a recent Cleaning Log record. Expect one banner-marked email per test recipient and nothing changed in Airtable. If Postmark answers with a template-not-found error, the alias in step 1 is missing or misspelled.
4. Turn the automation on. Every real cleaning now produces one preview per tester, with a random line each time (`forceKeys: ["*"]`).
5. After the copy settles, set `forceKeys: []` to rehearse the real rules: activate one rotation row; activate two on purpose and confirm the banner reports it; leave milestones inactive until the start-date question is settled.
6. Known gap while testing: cleanings logged 9pm to 6am ET produce no test email.
7. Every script edit: change the repo file first, run `node airtable_automations/tests/harness_v3.js`, then paste. Copy edits to lines happen in the Airtable table and need no paste at all.

**Go-live** (done 2026-10-05; kept as the ritual for any later script change, minus steps 1, 2 and the test automation):

1. Airtable table: tick `Active` on exactly one row. Apply the row fixes listed under section 7 if wanted.
2. Postmark: paste the repo HTML and text into live template `45583435`. Safe to do first: the V2 scripts keep rendering against it.
3. Catch-up automation `wflfaR1X0DQAwzTU2`: add the secret `POSTMARK_SERVER_TOKEN` on the script step, paste `email_automation_delayed_v3_secondary.js`, put the test addresses in `TEST.recipients`, leave `MODE = "test"` and click Test. Expect previews of the two most recent cleanings at the test addresses, each carrying the active line, and nothing changed in Airtable. Then change `MODE` to `"live"` and save.
4. Immediate automation `wflCdrhjYRo6d23pd`: add the secret, paste `email_automation_v3_secondary.js` into the existing script step, leave `MODE = "test"` and click Test (one preview per tester, nothing written). Then change `MODE` to `"live"`, save, and switch the test automation `wfl9ZtmXDUoMB64uJ` off. Two automations in live mode would double-send.
5. Do not click Test on either script once it says `"live"`: the immediate script would email that record's real subscribers again, and the catch-up would send whatever is flagged at that moment.
6. Watch the first runs and the next 6:15am catch-up log. Rollback is pasting the V2 files back (`email_automation.js`, `email_automation_delayed.js`); the template works with both.
7. Afterwards: rotate the Postmark server token (it is hardcoded in the V2 files and has been pasted into chats), update the secret in both automations, and delete or scrub the V2 files.

Changing the line later is a checkbox move in the table: untick the old row, tick the new one. Two ticked rows means emails go out with no line until it is fixed.

---

### 10. Automatic rotation

`airtable_automations/rotate_secondary_line.js` moves the `Active` checkbox to the next row on a schedule, so nobody has to remember to. Written and **set up 2026-10-05**: the `Rotation Order` field exists, the dry run and then real Test runs moved the checkbox down the rows as expected, and Sid switched the automation on. Those test runs moved the active line on from `satisfaction`, so the line live after setup is wherever the checkbox was left. The pace is whatever the trigger's schedule says in Airtable; it is not recorded here.

How it picks:

- Only rows with a number in a new **`Rotation Order`** field take part. Blank means the row is never picked automatically, which is how to hold back a seasonal or unfinished line. Rows must also be Rotation mode, have a Key and Line Text, and be inside their Start Date / End Date window.
- Next is the row after the current active one in `Rotation Order`, wrapping round to the lowest number.
- If the active row is not part of the rotation (ticked by hand for a special, expired, or nothing ticked), it unticks it and resumes with the row whose `Last Sent` is oldest, never-sent rows first.
- Both checkbox changes go in one write, so the send scripts never see two rows ticked.
- Every run moves the line on. The pace is whatever the trigger's schedule says.

Setup:

1. `Email Secondary Lines`: add a Number field `Rotation Order` and number the rows that should rotate.
2. New automation, trigger "At a scheduled time" every 10 days (early morning Eastern), action "Run a script" with the whole file. No inputs, no secrets.
3. Click Test with `DRY_RUN = true`: the log lists the rows in rotation and says which one it would activate, and nothing changes. Then set `DRY_RUN = false` and turn the automation on. A Test click with `false` really does rotate.

A row ticked by hand stays live only until the next scheduled run. To pin one line for longer, turn the rotation automation off.

`node airtable_automations/tests/harness_rotate.js` covers it offline (10 scenarios).

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
- **Secrets.** Airtable automations do have a secrets store: `input.secret("NAME")`, added per script step under Secrets. The V3 script already uses it. The two V2 send scripts and `airtable_automations/postmark_automation_script.js` still hardcode Postmark tokens and a Slack webhook, and stay **untracked in git** until they are switched over. Rotate both tokens and the webhook afterwards, since they have been pasted into chats.

---

## Open questions for Sid / the president

Settled:

- Cleaner naming: the `OK to Name in Emails` checkbox exists (2026-09-18); `cleaner_spotlight` drops for cleaners without it.
- CTA URLs: every row has one as of 2026-10-02.
- Bag counts: shipping the estimate from the `Trash` select ("about N bags") for now.
- Incentive on the referral line: the approved copy names the $10 reward, so the silent `?code=` question is moot.

Still open:

1. Should `referral` render as the forward section (today) or as a plain line with its own button? (section 7)
2. Rotation pace: every 10 days was the first suggestion; adjust the trigger's schedule after a cycle or two. (section 10)

Deferred to the next revision (Sid, 2026-10-02):

3. Several buttons on one line (the three social buttons) versus the one-line rule.
4. Milestones: on at all, and do they override the rotation line that day (current design) or add a second line (breaks the one-line rule, recommended no)? Needs the subscription start date settled first: backfill a real date for the rows that look bulk-imported on 2024-06-17, or run on `Member Since`. (3d)
5. Four-across versus the one-line rule: separate marketing email, accept the risk, or make it a rotation entry? (Part 3)

Only if the thumbs get built (Part 2):

8. Does a thumbs-down start a support conversation, or just get logged?
9. Do cleaners ever see their own thumbs score?

Only if the four-across gets built (Part 3):

10. Which four tiles?
