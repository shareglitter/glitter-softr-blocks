# Glitter custom blocks

A collection of standalone HTML/CSS/JS modules for the Glitter member hub at
`app.shareglitter.com` (Softr) and the marketing site at `www.shareglitter.com`
(Squarespace). There is no build step: each file is pasted whole into a Softr
custom code block, the Softr site header, or a Squarespace code block. The repo
and the live page drift until someone re-pastes.

- `blocks/` — page modules (pledge modal, homepage signup form, maps, cleaner
  bars, funding progress, CTA banner, block heading).
- `header/` — Softr site-header code (`header.html` scrapes block fields into
  `window.glitterRecord`; `glitter_ref_capture.html` stores referral codes).
- `footer/`, `css-overrides/` — site-wide Softr additions.
- `airtable_automations/` — copies of Airtable automation scripts (pasted into
  the *Subscription Blocks* base by hand, same drift rules as the blocks).
  `airtable_automations/templates/` holds the Postmark email templates.
- `blocks/archive/` — retired versions, kept for reference only.

## Read these first

- `docs/webhook_presence_guards.md` — the shared Zapier signup webhook: payload
  shape, the Email-exists filter, the blank-GET and dead-mapping incidents,
  and the full re-paste ritual.
- `docs/referral_capture.md` — referral / promo code capture, the two Contact
  Info fields added 2026-09-09, Airtable field types, the www-to-app storage
  gap and the planned cookie fix.
- `docs/cleaning_email.md` — the post-cleaning Postmark email: the two Airtable
  scripts that must stay in sync, the template model and the forward/share
  links. `docs/cleaning_email_roadmap.md` holds the not-yet-built thumbs
  up/down and four-across sections.

## Conventions

- CSS classes are prefixed `gc-`; element ids are camelCase with a `gc` prefix
  (`gcPhone`, `gcReferralCode`). Reuse `.gc-form-row` / `.gc-form-group` /
  `.gc-form-label` / `.gc-form-input` before adding new styles.
- Both signup forms post the same payload shape to one webhook. Add keys freely
  (unmapped keys are harmless in Zapier) but never rename or remove existing
  ones without checking the Zap.
- Code that must run on more than one surface is copied verbatim into each file
  with a guard; keep the copies identical and re-paste every surface together.
