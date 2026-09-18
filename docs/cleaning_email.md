# "We cleaned your block" email — how it ships, and what's planned

The post-cleaning notification is three pieces that must change together.
Written so it can be picked up cold.

| Piece | Where it lives | Repo copy |
|---|---|---|
| Main send script | Airtable base *Subscription Blocks*, automation **New Cleaning Log: Last Clean Date & Send Email Notification**, 2nd script step | `airtable_automations/email_automation.js` |
| Morning catch-up script | Same base, automation **Send Delayed Cleaning Emails** (daily 6:15am ET) | `airtable_automations/email_automation_delayed.js` |
| Template | Postmark template id `45583435`, stream `cleaning-notifications` | `airtable_automations/templates/post_cleaning_emails_postmark.html` |

Both scripts build the **same `TemplateModel`**. Anything added to one must be
added to the other, or emails delayed overnight (9pm–6am ET) will render
differently from daytime ones. `buildShare()` is copied verbatim into both.

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
- **Share this link** opens the subscriber's block page with `?code=THEIRCODE`.
  The same URL is printed below the buttons for copy/paste (long-press on a
  phone).
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
