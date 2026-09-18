# Cleaning email — sketch for later

Requested by the president on 2026-09-18, alongside the forward/share links.
**Nothing here is built.** How the email ships today is in
`docs/cleaning_email.md`; read that first, especially the rule that the main
script and the morning catch-up script build the same `TemplateModel`.

## Questions for the president (answer before building)

1. Which four tiles does she want in "4 more ways to get involved"?
2. Do the thumbs sit above or below the forward/share section?
3. Does a thumbs-down start a support conversation, or just get logged?
4. Do cleaners ever see their own thumbs score?

---

## A. "Like what you see?" thumbs up / thumbs down

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

## B. "Want more Glitter? Here are 4 more ways to get involved"

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

## C. If the redesign goes further

Postmark **Layouts** can hold the logo header and footer once, shared with the
`referral-success` template, so brand tweaks happen in one place.

## D. Follow-ups noticed along the way

- The block page's own "Share This Page" button (`docs/share_button.md`) copies
  the bare `Block Page URL`. A logged-in subscriber's share should carry their
  `?code=` the way the email link now does.
- Move the Postmark server tokens and the Slack webhook out of the script
  source and into Airtable automation secrets.
