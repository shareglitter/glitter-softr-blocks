# Signup webhook — presence guards & deploy notes

Covers the shared Zapier catch hook `hooks.zapier.com/hooks/catch/10651977/46ohxr2/`,
which receives the same payload shape from two places:

| Form | File | Deploys to |
|---|---|---|
| Homepage signup | `blocks/glitter_homepage_signup.html` | Squarespace homepage embed block (manual paste, renders inline — not an iframe) |
| Signup page | `blocks/glitter_homepage_signup.html` (same file) | Squarespace `/signup` code block (manual paste, inline). Added 2026-09-04 — **keep in lockstep with the homepage paste; re-paste both every time.** Goal is to drop one of the two surfaces. |
| Block-page pledge modal | `blocks/pledge_modal.html` | Softr custom code block on block detail pages (manual paste) |

**Retired / do not use:** the Softr page `app.shareglitter.com/signup-embed` holds a
pre-2026-08-22 copy of the homepage widget (no `Form Name`, no Block Code, no
`blockRecordId`). It was iframed on Squarespace `/signup` and `/groups`; `/signup`
was switched to an inline paste on 2026-09-04, `/groups` still iframes it. Every
submission through it reports `Source = https://app.shareglitter.com/signup-embed`
because `window.location.href` is evaluated inside the frame. Unpublish it once
`/groups` is switched.

**Filter state as of 2026-09-04:** `Form Name` condition removed, `Email` **(Text)
Exists** only, after the stale embed filtered real signups on 2026-08-26 and
2026-09-01..03. Blank probe hits carry no email, so this still blocks them. Put
`Form Name` back only after every live surface has been re-pasted and verified.

Airtable target: base `appzuuUtAQVDg0YW1`, table `tbljjDIQqyyBE5b7n` (Subscriber).

---

## Two failure modes we hit on 2026-08-22

### 1. Blank Subscriber records from bare GETs

Two Zap runs created empty Airtable records. Zap history showed **no Data In** on
the catch hook and **Data Out: `querystring <BLANK>`** — an empty request, not a
mangled submission. They were ~5 hours apart, so not one burst.

Neither form can produce this. `gcSubmit()` hard-validates first name, last name,
email, a 10-digit phone, a street address containing a digit, and a pledge >= 1
before it calls `fetch`. Even a minimal real submission still carries `Source`,
`timestamp`, `Choose Pledge`, `Services`, `SMS Opt In` and
`Neighborhood Fund Opt In` — constants and derived values that are never blank. A
run with *zero* fields cannot come from either code path.

What does produce it: **Zapier catch hooks fire on GET as well as POST**, and an
empty request creates a run with no data. Every mapping resolves blank, Zapier
drops blank fields, Airtable creates an empty record — and no error is raised.
The webhook URL is hardcoded in public page source in both places, so anything
that scrapes JS can hit it; link scanners (Outlook Safe Links, Slack unfurls,
security tooling) do the same if the URL is ever pasted into a message or doc.

### 2. A deleted Airtable field failed silently for an unknown length of time

`'Block Code'` was mapped to field `fldouWoozGkZmiHJi` ("Existing block code (old)").
The column had been deleted; the mapping stayed. Airtable rejected the whole
write with `Unknown field name: "fldouWoozGkZmiHJi"` and Zapier paused the Zap.

**Why it stayed hidden:** Zapier omits blank mappings from the Airtable call, so a
dead mapping only errors once something actually populates it. Every block-less
signup succeeded; the first signup that selected a block from search blew up. All
1705 blocks in `blocks.json` have a `gltr.ly` URL, so `Block Code` is non-empty
for *every* block picked from search — meaning the Zap was rejecting exactly the
highest-quality submissions and letting the block-less ones through.

Note the field title's `(old)` suffix is what made an earlier debugging pass
conclude the field was unused.

**Generalize this:** a broken Airtable mapping is invisible until the field is
populated. After deleting or renaming an Airtable column, hit *Refresh Fields* on
the Zap step and re-check any mapping that is usually blank.

---

## The presence guard

Both payloads now open with a marker field:

```js
'Form Name': 'homepage-signup',   // or 'pledge-modal'
```

It is a constant, so every genuine submission carries it and no empty request
ever can.

**Zapier setup, as currently running** — a *Filter* step immediately after the
catch hook, before the Airtable step, with a single condition:

- `Email` — **(Text) Exists**

Live and verified 2026-08-22: a real test submission passed the filter and
created a Subscriber with "Existing block code (old)" populated. Filtered runs
still appear in task history, so you keep visibility into how often the URL is
being probed.

Email alone is sufficient for the failure mode we actually saw. Those runs had
*no* data at all, so any Exists condition stops them, and `Email` is hard-required
by both forms' validation before `fetch` is ever called. A second `Form Name`
Exists condition was considered and dropped as redundant — it would only add
protection against a hypothetical partial payload that carries an email but no
form marker, which nothing observed has produced.

Keeping the filter off `Form Name` also decouples it from deploys: because the
marker is not required to pass, a surface that has not been re-pasted yet still
submits normally. If you ever do add a `Form Name` condition, read the ordering
warning under *Re-pasting* first.

`Form Name` still ships in both payloads and is worth keeping — it labels which
surface a Subscriber came from, which `Source` only tells you indirectly, and it
is the filter key already in place if the blank-record problem ever returns in a
form Email alone cannot catch. It is deliberately **not** mapped into Airtable.
Unmapped incoming fields are harmless in Zapier; it just flags them as unused.

This is a nuisance guard, not authentication. The URL is public, so anything that
reads page source could replay a full payload. A shared secret would not change
that, since it would be equally visible.

## Other payload change

`'New Block Request': state.skippedBlock` (homepage only) marks the
"Can't find your block? Be the first to pledge" path. Previously that flag was
tracked in state but never sent, so a deliberate new-block request and a block
lookup that silently failed both arrived with empty `Block Code` + empty
`blockRecordId` — untriageable. Map it to a checkbox field in Airtable if you
want to sort them; leaving it unmapped is fine.

Added 2026-09-09 (both forms): `'Referral Code Entered'`,
`'How Did You Hear About Us'` and `'How Did You Hear About Us (Other)'`. Field
types, option strings and the storage design are in `docs/referral_capture.md`.

## Considered and deliberately not changed

- **`mode: 'no-cors'`** on both fetches. It is required for a cross-origin POST
  without a preflight, but it makes the response opaque, so `.then()` runs even
  when Zapier returns an error. Users saw the success redirect throughout the
  outage above. The fix is Zap-side visibility (error notifications on the Zap),
  not client-side. The `Content-Type: application/json` header on those fetches
  is silently dropped by the browser under `no-cors` — the body actually goes as
  `text/plain`, which Zapier parses fine.
- **Normalizing `'Phone'` to 10 digits.** Both forms compute `phoneDigits` for
  validation but send the raw typed string. Sending digits would be tidier, but
  it changes the format of an existing column mid-stream and risks mismatching
  older records in any phone-based lookup or dedupe.

## Re-pasting after a change

There is no build step and no sync — the repo file and the live page drift until
someone re-pastes the **entire file**, `<style>` through `</script>`.

1. **Homepage** — Squarespace homepage → the embed/code block holding the signup
   form → select all → paste `blocks/glitter_homepage_signup.html` in full → save.
2. **Signup page** — Squarespace `/signup` → the code block holding the signup
   form → same full-file replace with `blocks/glitter_homepage_signup.html` → save.
   It is the same file as the homepage; if you touch one, touch both.
3. **Pledge modal** — Softr block detail page → the custom code block → same
   full-file replace with `blocks/pledge_modal.html` → publish.
4. **Verify** with one real submission per surface, checking Zap history that the
   run reaches Airtable and that `Form Name` shows the surface you just pasted.

With the filter keyed on `Email` only, paste order does not matter — an
un-pasted surface still submits successfully. **This stops being true the moment
you add a `Form Name` Exists condition.** If you ever do, re-paste every surface
and confirm the marker in Zap history *first*, or every submission from a surface
still running the old code is silently filtered out — silently because `no-cors`
still shows those users the success redirect.
