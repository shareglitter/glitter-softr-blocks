# "We cleaned your block" email — how it ships, and what's planned

The post-cleaning notification is three pieces that must change together.
Written so it can be picked up cold.

| Piece | Where it lives | Repo copy |
|---|---|---|
| Main send script | Airtable base *Subscription Blocks*, automation **New Cleaning Log: Last Clean Date & Send Email Notification**, 2nd script step | `airtable_automations/email_automation_v3_secondary.js` |
| Morning catch-up script | Same base, automation **Send Delayed Cleaning Emails** (daily 6:15am ET) | `airtable_automations/email_automation_delayed_v3_secondary.js` |
| Template | Postmark template id `45583435`, stream `cleaning-notifications` | `airtable_automations/templates/post_cleaning_emails_postmark.html` |

Both scripts build the **same `TemplateModel`**. Anything added to one must be
added to the other, or emails delayed overnight (9pm–6am ET) will render
differently from daytime ones. Since V3 (live 2026-10-05) that is enforced by
one module copied verbatim into both files, between the `SECONDARY LINE MODULE`
markers; it holds `buildShare()` and `buildSubscriberModel()`, which builds
the whole model. The harness fails if the two copies differ.

Both files are committed with `MODE = "test"` and placeholder test addresses.
What runs in Airtable is the same file with `MODE = "live"`. The paste ritual
(paste, click Test once in test mode, then flip to live) is in
`docs/cleaning_email_roadmap.md` section 9. The token comes from the script
step's Secrets as `POSTMARK_SERVER_TOKEN`.

Since V3 the email also carries one rotating secondary line, chosen by the
`Active` checkbox in the `Email Secondary Lines` table. The model gets a
`secondary` object for that line, or `share` when the active line's key is
`referral`, never both, and neither when no row is active. The sections below
describe the share section as first shipped in V2 (`email_automation.js` and
`email_automation_delayed.js`, untracked because they hardcode a token).

## Template model

| Key | Source |
|---|---|
| `display_name`, `block_name`, `cleaning_date`, `cleaner_first_name` | Subscribers / Blocks / Cleaning Log / Cleaners |
| `block_page_url` | Blocks → `Block Page URL`, with `https://` prepended (the field is stored as `gltr.ly/...`) |
| `preference_url` | constant |
| `share.url` | `block_page_url` + `?code=` + the subscriber's `Referral Code` (falls back to the bare block URL when they have no code) |
| `share.forward_mailto` | a complete `mailto:?subject=…&body=…` href, URL-encoded in the script |

`share` is an object so the template can wrap the section in
`{{#share}}…{{/share}}`. When the script sends no `share` (or the old script is
still live) the whole section disappears, so **the template is safe to publish
before the scripts**.

## Forward / share (added 2026-09-18)

Email clients run no JavaScript, so there is no share sheet, no clipboard and
no way to trigger the client's own Forward button.

- **Forward this email** is a `mailto:` with a blank recipient and a prefilled
  note containing the subscriber's link. This is deliberately *not* a real
  forward: a forwarded copy carries the subscriber's own Unsubscribe and
  Manage-preferences links, and a neighbor clicking Unsubscribe would
  unsubscribe the original subscriber.
- **The personal link** (`<block page>?code=THEIRCODE`) is printed under the
  forward button for copy/paste (long-press on a phone). A separate "Share this
  link" button that opened the block page shipped on 2026-09-18 and is removed
  in the V3 template: opening the page did not read as "sharing".
- The encoding is done in the script because Postmark's `{{ }}` HTML-escapes
  but does not URL-encode.

### Dependency: `?code=` on block pages

Attribution runs through the **Referral Matching and Assignment** automation,
which matches `Referral Code Entered` against `Referral Code` (then the legacy
slug). A neighbor arriving at a block page with `?code=` only gets that field
filled once the updated `blocks/pledge_modal.html` and
`header/glitter_ref_capture.html` are pasted into Softr
(see `docs/referral_capture.md`). Until then the link still lands on the right
page; the referrer just isn't credited automatically.

### Deploy order

1. Paste `airtable_automations/templates/post_cleaning_emails_postmark.html` into the Postmark template. Send
   a Postmark test with a model that includes
   `"share": {"url": "https://gltr.ly/TEST?code=TEST-123", "forward_mailto": "mailto:?subject=Test&body=Test"}`
   and one without `share` — the section should appear and vanish.
2. Paste `email_automation.js` into the main automation's script step.
3. Paste `email_automation_delayed.js` into the catch-up automation.
4. Test the main automation on a Cleaning Log record for a block where you are
   the only opted-in subscriber. Click both buttons in Gmail web, iOS Mail and
   the Gmail app.

## Planned, not built

Everything not yet built lives in `docs/cleaning_email_roadmap.md`: the
rotating one-line secondary slot from the president's test-ideas doc, the
thumbs up / down, the four-across "4 more ways to get involved" row, and the
open questions. Read its "How the pieces fit" section before changing the
share section, because the share section becomes the `referral` entry of that
rotation.
