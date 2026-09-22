# Cleaning email — roadmap

**Status:** Part 1 is **in test** as of 2026-09-18 (script, template and table exist; a test-only automation sends to two staff addresses). Parts 2 to 4 are not built. How the email ships today is in `docs/cleaning_email.md`; read that first, especially the rule that the immediate script and the morning catch-up script build the same `TemplateModel`.
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

Built as one file: `airtable_automations/email_automation_v3_secondary.js`. It is the V2 immediate script plus the secondary-line module, with a `MODE` constant.

| | `MODE = "test"` | `MODE = "live"` |
|---|---|---|
| Recipients | only `TEST.recipients` (hard allowlist, 1 to 3 addresses) | the block's eligible subscribers |
| Rendered as | the first `TEST.maxPreviewsPerLog` eligible subscribers of the cleaned block | each subscriber |
| Tour of the whole table | `TEST.sendEveryLine: true` sends every usable row as its own email in one run, banner marked `[n/N]`, so one Test click previews all lines. Set `recipients` to one address first or the count doubles. | n/a |
| Nobody eligible on the block | still sends the testers a preview, rendered as the first linked subscriber, with the banner saying live would send nothing (`TEST.previewWhenNoneEligible`, on by default) | sends nothing |
| Template | alias `cleaning-notification-test` | id `45583435` |
| Line choice | `TEST.forceKeys`: `["*"]` random tour of every row, a list of keys, or `[]` for the real rules | Active checkbox, date window, milestones, one-active guardrail |
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

`node airtable_automations/tests/harness_v3.js` runs the script against a mocked base and mocked Postmark through twenty-two scenarios (allowlist, table tour, nobody-eligible blocks, multi-button rows, mailto buttons, this-year counts, weekly-block drop, forced lines, dropped placeholders, quiet hours, live write-back). Run it after every script edit.

**Still to do at go-live:** the morning catch-up script needs the same module. Port it once the copy and code have settled in testing, then apply the secrets change to it too.

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
| `{block_bags_total}` | Total bags on this block, estimated from the `Trash` select until a `Bags` field exists | Cleaning Log |
| `{cleaner_first_name}` | Cleaner's first name, only when `OK to Name in Emails` is checked | Cleaners |
| `{block_frequency}` | Current cadence, lower-case: "every other week" | Blocks → `Frequency Label (Lookup)` |
| `{next_frequency}` | The next cadence up: "3 out of 4 weeks". **Blank for Every Week blocks**, so a line using it drops for them, which answers the doc's "what if already weekly" comment | Blocks → `Next Frequency Label` |
| `{tenure_months}` | Whole months since `Member Since` (drives milestones, rarely printed) | Subscribers |

Rule: if a line references a placeholder the script can't fill for that recipient, the line is dropped for that recipient (email still sends, just without the secondary). This is what makes it safe to turn on the impact-stat line before every subscriber has a clean start date.

---

### 7. Seed rows (from the president's doc, updated 2026-09-22)

The canonical list is `airtable_automations/templates/email_secondary_lines_seed.csv` (22 rows). The table in Airtable was seeded from the 14-row version on 2026-09-18; the 8 rows the doc added since (`door_hangers`, `ambassador_booking`, `snow_waitlist`, `leaves_waitlist`, `weeding_waitlist`, `request_sign`, `testimonial`, `service_poll`) and the reworded rows have to be entered by hand.

| Key | Mode | Line Text | CTA Label | CTA URL |
|---|---|---|---|---|
| `referral` | Rotation | Know a neighbor who'd want Glitter cleanings for their block? Forward this email, or send them your personal link. | Forward this email | ignored |
| `satisfaction` | Rotation | How'd we do today? Reply and let us know if we hit the mark for your cleaning. | Reply | mailto:hello@shareglitter.com?subject=Cleaning on {block_name} |
| `impact_stat` | Rotation | This is your {cleaning_count_this_year_ordinal} cleaning in {year}. Your block has collected about {block_bags_total} bags so far. | See your block page | {block_page_url} |
| `services_waitlist` | Rotation | Curious about our new services like block-wide composting, or leaf, weed, and snow removal? Join the waitlist for one or more! | See New Services | TODO |
| `trash_can` | Rotation | Ask about adding a trash can to your block that Glitter will maintain each week. | Add a Trashcan | mailto:hello@shareglitter.com?subject=Trash can for {block_name} |
| `impact_fund` | Rotation | Want to help a block that needs cleaning support? Chip in to the Impact Fund. | Join Impact Fund | TODO |
| `ambassador` | Rotation | Want to help organize your block or bring in more neighbors to pledge? Let us know. | Reply | mailto:hello@shareglitter.com?subject=Helping out on {block_name} |
| `door_hangers` | Rotation | Want to let your neighbors know about Glitter and raise more funds? Request door hangers! | Get free doorhangers | TODO |
| `review` | Rotation | Enjoying Glitter? A quick Google review helps other blocks find us. | Review us on Google | TODO |
| `cleaner_spotlight` | Rotation | Your block was cleaned by {cleaner_first_name}, a neighbor earning a living wage doing it. Learn more about who we hire. | Watch 'Meet our Cleaners' | TODO |
| `ambassador_booking` | Rotation | Want help talking to neighbors about Glitter? Book a free ambassador door-knocking session at your convenience. | Book an Ambassador | TODO |
| `social_share` | Rotation | Share what we do for your block and tag @shareglitter to help others learn about us! | Facebook | Instagram | Nextdoor | https://www.facebook.com/shareglitter | https://www.instagram.com/shareglitter | https://nextdoor.com |
| `frequency_upgrade` | Rotation | Want your block cleaned {next_frequency}? Increase your pledge. | Increase pledge | {block_page_url} |
| `snow_waitlist` | Rotation | Show your interest in adding snow removal service to your block that Glitter will do seasonally. Join the waitlist! | Join snow removal waitlist | TODO |
| `leaves_waitlist` | Rotation | Show your interest in adding leaf removal service to your block that Glitter will do seasonally. Join the waitlist! | Join leaf removal waitlist | TODO |
| `weeding_waitlist` | Rotation | Show your interest in adding weed removal service to your block that Glitter will do seasonally. Join the waitlist! | Join weed removal waitlist | TODO |
| `sponsor_block` | Rotation | Know a block that could use this but can't afford it? Sponsor a cleaning for them by making a pledge on that block. | Pledge on a new block here | https://www.shareglitter.com |
| `request_sign` | Rotation | Want to show off that you are a Glitter block and raise more funds? Request a sign! | Request free sign | TODO |
| `testimonial` | Rotation | Has Glitter made a difference on your block? Tell us about it in a sentence or two. | Share your story | mailto:hello@shareglitter.com?subject=My Glitter story ({block_name}) |
| `service_poll` | Rotation | What should Glitter offer next near you? Tell us your ideas! | Tell us your ideas | TODO |
| `milestone_6mo` | Milestone (6) | Thank you for six months of clean blocks. |  |  |
| `milestone_12mo` | Milestone (12) | Thank you for a year of clean blocks. |  |  |

Set `Active` on `referral` only (it's the one running now). Leave the milestone rows inactive until the start-date question is settled. Lines with a TODO URL send as text only until the URL is filled in.

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
| Test recipients | Two staff addresses, both Sid's for now; add the president's when she is ready to receive them (max 3). |
| `Active (Rotation) Count` field | Skipped on purpose. A formula cannot count across rows, and the script already refuses to send a rotation line when more than one is active. |
| Catch-up script | Not ported. V2 still live. |

**Test phase:**

1. Postmark: duplicate template `45583435`, alias `cleaning-notification-test`. Paste the repo HTML and text bodies into the copy. Preview with each object in `sample_models.json`.
2. Airtable: test automation as described in the table above, with the secret `POSTMARK_SERVER_TOKEN` added on the script step.
3. Use the script step's Test button on a recent Cleaning Log record. Expect one banner-marked email per test recipient and nothing changed in Airtable. If Postmark answers with a template-not-found error, the alias in step 1 is missing or misspelled.
4. Turn the automation on. Every real cleaning now produces one preview per tester, with a random line each time (`forceKeys: ["*"]`).
5. After the copy settles, set `forceKeys: []` to rehearse the real rules: activate one rotation row; activate two on purpose and confirm the banner reports it; leave milestones inactive until the start-date question is settled.
6. Known gap while testing: cleanings logged 9pm to 6am ET produce no test email.
7. Every script edit: change the repo file first, run `node airtable_automations/tests/harness_v3.js`, then paste. Copy edits to lines happen in the Airtable table and need no paste at all.

**Go-live:**

1. Port the module into the catch-up script.
2. Paste the tested HTML and text into template `45583435`.
3. Paste the script into the **existing** live automation's script step with `MODE = "live"`, add the secret there, and switch the test automation off in the same sitting. Two automations in live mode would double-send.
4. Watch the first runs and the next 6:15am catch-up log.

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
