# Referral capture — current state and the cross-subdomain follow-up

Covers the `?ref=` / `?sref=` / `?code=` capture shared by the homepage signup
form and the block-page pledge modal, the two new Contact Info fields added on
2026-09-09, and the cookie change planned for when block pages move to the new
UI. Written so it can be picked up cold months later.

| Piece | File | Status (2026-09-10) |
|---|---|---|
| Homepage signup form | `blocks/glitter_homepage_signup.html` | **Live** on Squarespace homepage. Tested: `www.shareglitter.com/?code=PROMO999` pre-fills the field. |
| Block-page pledge modal | `blocks/pledge_modal.html` | Updated in repo, **not pasted** into Softr yet. |
| Site-header snippet | `header/glitter_ref_capture.html` | New file, **not pasted** into Softr yet. |
| Squarespace `/signup` page | (same homepage file) | Being **removed** — one surface is enough. |
| Airtable automation | (Airtable, not in repo) | Live: matches new referrals to their referrer for billing. |

Related: `docs/webhook_presence_guards.md` for the Zap filter, blank-GET
incident and the full re-paste ritual.

---

## What the code does today

### URL params

| Param | Meaning | Payload key | Existing behavior |
|---|---|---|---|
| `?ref=` | ambassador referral | `'Ambassador Source'` | unchanged |
| `?sref=` | customer referral (e.g. `gltr.ly/750S15th?sref=badou-t-c02if`) | `'Referral Slug'` | unchanged, also shows the "Referred by a neighbor" note |
| `?code=` | referral / promo code | `'Referral Code Entered'` | new |

The original `readRefParam` / `captureRefParam` path (own query string, then
`document.referrer` when framed, then `sessionStorage` under `gc_ref` /
`gc_sref`) is untouched. Everything below sits on top of it.

### The `glitter_ref` storage entry

An IIFE stores the **first present** of `ref`, `sref`, `code` (in that order)
in `localStorage` as:

```js
glitter_ref = { code: 'PROMO999', source: 'ref' | 'sref' | 'code', ts: 1757000000000 }
```

- Written on every page load that carries one of the params; a newer URL param
  overwrites the stored entry.
- Ignored on read when `ts` is older than 30 days, or when the JSON is missing
  or malformed. Every storage call is wrapped in try/catch.
- Exposed as `window.glitterRef = { KEY, read(), write(code, source), capture() }`.
- Guarded with `if (window.glitterRef) return;` so the same IIFE can be loaded
  twice on one page without redefining anything.

**It lives in three places and they must stay identical:**

1. `header/glitter_ref_capture.html` — the standalone copy for Softr
   *Settings → Custom Code → Header*, so any Softr page captures a code.
2. Inlined in `blocks/pledge_modal.html` under the heading
   `GLITTER REFERRAL CAPTURE (block-agnostic)`.
3. Inlined in `blocks/glitter_homepage_signup.html` under the same heading.
   Squarespace has no Softr header, so this is the only copy on the homepage.

### How the forms use it

Right after `ambassadorRef` / `subscriberRef` are captured:

```js
var storedRef = window.glitterRef ? window.glitterRef.read() : null;
if (!ambassadorRef && storedRef && storedRef.source === 'ref') {
  ambassadorRef = storedRef.code;          // fallback for 'Ambassador Source'
}
var referralCodeDefault = storedRef ? storedRef.code : '';   // pre-fills the input
```

Decisions confirmed 2026-09-09:

- Param priority when a URL carries more than one: `ref` → `sref` → `code`.
- Only a stored entry whose `source` is `'ref'` may stand in for
  `'Ambassador Source'`. A stored `sref` or `code` value still reaches Airtable
  through `'Referral Code Entered'`, but never masquerades as an ambassador.
- The prefill only fills an **empty** input. A value the user typed always wins.

### The two new Contact Info fields

Both forms have a new row under Email / Phone:

| Field | Element id | Payload key | Notes |
|---|---|---|---|
| "Referral or promo code (optional)" | `gcReferralCode` | `'Referral Code Entered'` | pre-filled from `glitter_ref`; sent trimmed + uppercased; `''` when blank |
| "How did you hear about us?" | `gcHeardFrom` | `'How Did You Hear About Us'` | `<select>`; `''` when left on "Select one" |
| "Tell us more (optional)" | `gcHeardOther` | `'How Did You Hear About Us (Other)'` | full-width row shown only when "Other" is chosen; cleared when the select changes away from Other |

Select options, in order — these strings must match the Airtable single
select exactly:

```
A neighbor or friend
Flyer or door hanger
Saw a Glitter cleaner on my block
Social media
Nextdoor
Google search
News or press
Community event
Other
```

Neither field is validated; both are optional and never turn red.

CSS added for this (the only new CSS): `.gc-form-label.gc-nowrap`,
`.gc-form-row.gc-form-row-wrap` (+ its `.gc-form-group` flex basis, reset to
`auto` inside the 600px media query so it does not become a height),
`select.gc-form-input` (custom chevron, `appearance: none`) and
`select.gc-form-input.gc-placeholder` (grey text until a choice is made).
The referral label measures 245px in Epilogue at 14px; the wrap row stacks
its two columns whenever one would drop under 250px, so the label never
overflows between the 600px breakpoint and full width.

### Airtable mapping in the Zap

| Payload key | Airtable field type |
|---|---|
| `'Referral Code Entered'` | single line text |
| `'How Did You Hear About Us'` | single select with the nine options above |
| `'How Did You Hear About Us (Other)'` | single line text |

Single select was chosen over text because `'Choose Pledge'` already proves
the string-match pattern in this Zap, and grouping/filtering is the point of
the question. If an option is ever reworded in the form, reword it in Airtable
the same day. Zapier drops blank mappings, so an unanswered field just stays
empty. Unmapped keys are harmless (Zapier flags them as unused).

---

## The known gap: www → app does not carry over

`localStorage` is scoped per origin. The homepage is `www.shareglitter.com`
(Squarespace) and block pages are `app.shareglitter.com` (Softr). A code
captured on the homepage is **not** readable by the pledge modal, even after
the Softr header snippet is pasted. The header snippet only carries a code
between Softr pages.

This does not matter yet: referrals are being tested on the homepage only
until block pages move to the new UI.

## Next version: add a parent-domain cookie

Agreed 2026-09-10. Not urgent. Do it when the block pages move, and do the
three pastes in one go.

### Spec

Change only `read()` and `write()` inside the snippet. The forms call those
two functions and nothing else, so the prefill, the Ambassador fallback and
the payload keys do not change.

- `write()` writes **both** a cookie and localStorage:
  ```
  glitter_ref=<encodeURIComponent(JSON)>; domain=.shareglitter.com; path=/;
  max-age=604800; SameSite=Lax; Secure
  ```
  The `domain` attribute must be explicit — a cookie set without it is
  host-only and would stay stuck on www exactly like localStorage.
- `read()` parses both, validates each the same way as today, and returns the
  entry with the **newer `ts`**. A code seen on app after an older one on www
  should win.
- Use **one 7-day TTL everywhere** (cookie `max-age` and the localStorage
  check). Safari caps script-set cookies at 7 days regardless; matching it
  makes every browser behave the same and shortens the stale-prefill window.
  7 days was judged plenty.
- Keep localStorage as the fallback on purpose: a browser silently rejects a
  cookie whose domain does not match the page, so on any preview or staging
  host the cookie write is a no-op and localStorage keeps tests working.
- Update all three copies of the IIFE together, then re-paste: Softr header,
  Softr pledge-modal block, Squarespace homepage.

### UX considerations already accepted

- **Stale prefill.** Someone who clicked a friend's link last week sees that
  code pre-filled when signing up for another reason. The field is visible and
  editable; the 7-day TTL keeps it rare. A small clear button in the field is
  a cheap addition if it ever matters.
- **Shared devices** see the same effect; same mitigation.
- **A typed value always wins** — the prefill never overwrites a non-empty
  input.
- **Privacy wording.** First-party functional cookie, not a tracker. Add one
  line to the privacy policy naming it and its purpose. If Squarespace's
  cookie banner is ever enabled for EU visitors, classify it as functional.

---

## Test checklist (per surface, after any re-paste)

1. Visit with `?code=TEST123`, open the form: the code field shows `TEST123`.
2. Open the same site again with **no** params in the same browser: the field
   still shows `TEST123` (storage fallback).
3. Visit with `?ref=amb-x` and no `?code=`: submit and confirm Zap history
   shows `Ambassador Source = amb-x` and `Referral Code Entered = AMB-X`.
4. Choose "Other", type something, switch to another option: the text row
   hides and the payload sends `''` for the Other key.
5. Submit with both new fields empty: the run still reaches Airtable with the
   fields blank.
6. Check `Form Name` in Zap history shows the surface you just pasted.

After the cookie change, add: visit `www.shareglitter.com/?code=X`, then open
an `app.shareglitter.com` block page and the modal — the field shows `X`.
