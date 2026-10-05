// Offline check for the two V3 send scripts (email_automation_v3_secondary.js and
// email_automation_delayed_v3_secondary.js): mocks the Airtable base, input.secret
// and Postmark, then runs the scenarios below (test-mode allowlist, forced lines,
// dropped placeholders, quiet hours, live write-back, catch-up parity).
// Run:  node airtable_automations/tests/harness_v3.js
// Prints "Assertion failed" for any scenario that breaks and exits 1.
const fs = require("fs");
const path = require("path");
// The working copies may carry real test addresses or a different MODE / forceKeys;
// every scenario starts from the same baseline whatever the file says.
const norm = s => s.replace(/const MODE = "(test|live)"/, 'const MODE = "test"')
  .replace(/recipients: \[[^\]]*\]/, 'recipients: ["YOUR_EMAIL_HERE", "PRESIDENT_EMAIL_HERE"]')
  .replace(/forceKeys: \[[^\]]*\],/, 'forceKeys: ["*"],')
  .replace(/sendEveryLine: (true|false)/, "sendEveryLine: false");
const rawSrc = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "email_automation_v3_secondary.js"), "utf8");
const rawDelayedSrc = fs.readFileSync(process.argv[3] || path.join(__dirname, "..", "email_automation_delayed_v3_secondary.js"), "utf8");
const src = norm(rawSrc);
const delayedSrc = norm(rawDelayedSrc);
let failures = 0;
const check = (ok, ...msg) => { if (!ok) { failures++; console.log("Assertion failed:", ...msg); } };
function rec(id, cells) { return { id, getCellValue: f => (f in cells ? cells[f] : null), getCellValueAsString: f => String(cells[f] ?? "") }; }
async function run(name, { patch = s => s, lines, hour = 14, consent = false, noneOptedIn = false, weekly = false, script = "immediate", delayed = [], postmarkStatus = 200, newestLogHasNobody = false }) {
  const writes = []; let sent = null;
  const tables = {
    "Cleaning Log": [rec("recLOG1", { Block: [{ id: "recBLK" }], "Date and Time": "2026-09-18T15:00:00Z", Cleaner: [{ id: "recCLN" }], Trash: { name: "Medium. Up to 1 full bag" } }),
                     rec("recLOG0", { Block: [{ id: "recBLK" }], "Date and Time": "2026-08-18T15:00:00Z", Trash: { name: "Heavy " } }),
                     rec("recLOGOLD", { Block: [{ id: "recBLK" }], "Date and Time": "2025-06-01T15:00:00Z", Trash: { name: "Light" } })],
    "Blocks": [rec("recBLK", { "Block Name (Friendly)": "1000 S Bouvier St", Subscribers: [{ id: "recS1" }, { id: "recS2" }, { id: "recS3" }], "Block Page URL": "gltr.ly/1000SBouvier",
                              "Frequency Label (Lookup)": weekly ? "Every Week" : "Every Other Week", "Next Frequency Label": weekly ? "" : "3 out of 4 Weeks" })],
    "Cleaners": [rec("recCLN", { "Display Name": "Marcus Lee", "OK to Name in Emails": consent })],
    "Subscribers": [
      rec("recS1", { Email: "real.customer1@example.com", "Cleaning Notifications Opt-In": true, "Contribution Status (from Active Subscriptions)": [{ name: "Active" }], "Display Name": "Darrell W", "Referral Code": "DARRELL-LG7", "Member Since": "2025-01-10T00:00:00Z", "Milestones Sent": null }),
      rec("recS2", { Email: "real.customer2@example.com", "Cleaning Notifications Opt-In": true, "Contribution Status (from Active Subscriptions)": [{ name: "Active" }], "Display Name": "New Nora", "Referral Code": "NORA-111", "Member Since": "2026-09-01T00:00:00Z" }),
      rec("recS3", { Email: "optedout@example.com", "Cleaning Notifications Opt-In": false, "Display Name": "Opted Out" })],
    "Email Secondary Lines": lines,
  };
  if (newestLogHasNobody) {
    tables["Cleaning Log"].push(rec("recLOGEMPTY", { Block: [{ id: "recBLK2" }], "Date and Time": "2026-09-18T16:00:00Z" }));
    tables["Blocks"].push(rec("recBLK2", { "Block Name (Friendly)": "4800 N Carlisle St", Subscribers: [{ id: "recS3" }], "Block Page URL": "gltr.ly/4800NCarlisle" }));
  }
  if (delayed.length) tables["Cleaning Log"] = tables["Cleaning Log"].map(r => delayed.includes(r.id) ? rec(r.id, { Block: r.getCellValue("Block"), "Date and Time": r.getCellValue("Date and Time"), Cleaner: r.getCellValue("Cleaner"), Trash: r.getCellValue("Trash"), "Email Delayed": true }) : r);
  if (noneOptedIn) tables["Subscribers"] = tables["Subscribers"].map(r => rec(r.id, { Email: r.getCellValue("Email"), "Display Name": r.getCellValue("Display Name"), "Referral Code": r.getCellValue("Referral Code"), "Member Since": r.getCellValue("Member Since"), "Cleaning Notifications Opt-In": false }));
  const base = { getTable: n => ({
    selectRecordAsync: async id => tables[n].find(r => r.id === id) || null,
    selectRecordsAsync: async o => ({ records: o && o.recordIds ? tables[n].filter(r => o.recordIds.includes(r.id)) : tables[n] }),
    updateRecordAsync: async (id, f) => writes.push({ table: n, id, f }),
  }) };
  const input = { config: () => ({ recordId: "recLOG1" }), secret: k => "SECRET-" + k };
  // The catch-up calls Postmark once per log, so accepted messages accumulate.
  const fetch = async (url, o) => {
    const batch = JSON.parse(o.body).Messages;
    if (postmarkStatus !== 200) return { ok: false, status: postmarkStatus, json: async () => ({ ErrorCode: 10, Message: "rejected" }) };
    sent = (sent || []).concat(batch);
    return { ok: true, status: 200, json: async () => batch.map(m => ({ To: m.To, ErrorCode: 0 })) };
  };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.UTC(2026, 8, 18, hour + 4, 0, 0)); } }
  const logs = []; const con = { log: (...a) => logs.push(a.join(" ")) };
  let error = null;
  try { await new Function("base", "input", "fetch", "console", "Date", `return (async () => {${patch(script === "delayed" ? delayedSrc : src)}\n})()`)(base, input, fetch, con, FakeDate); } catch (e) { error = e.message; }
  console.log(`\n=== ${name}`);
  if (error) console.log("  THREW:", error);
  console.log("  to:", sent ? sent.map(m => m.To).join(", ") : "(nothing sent)");
  if (sent) for (const m of sent.slice(0, 2)) { const t = m.TemplateModel; console.log("  model:", JSON.stringify({ as: t.display_name, secondary: t.secondary, share: t.share && t.share.url, banner: t.test_banner && t.test_banner.outcome, tpl: m.TemplateAlias || m.TemplateId, tag: m.Tag })); }
  console.log("  writes:", JSON.stringify(writes));
  return { sent, writes, error, logs };
}
const L = (id, c) => rec(id, c);
// Minimal CSV reader (quoted fields, doubled quotes, commas and newlines inside quotes).
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') q = false; else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some(c => c !== "")) rows.push(row); row = []; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); if (row.some(c => c !== "")) rows.push(row); }
  const head = rows.shift().map(c => c.replace(/^\uFEFF/, ""));
  return rows.map(r => Object.fromEntries(head.map((k, i) => [k, r[i] ?? ""])));
}
const rot = (key, text, extra = {}) => L("recL_" + key, { Key: key, "Line Text": text, Mode: { name: "Rotation" }, ...extra });
const ALL = [
  rot("referral", "Know a neighbor?", { Active: true, "CTA Label": "Share", "CTA URL": "{block_page_url}" }),
  rot("review", "Enjoying Glitter? A quick review helps.", { "CTA Label": "Leave a review", "CTA URL": "https://g.page/r/abc" }),
  rot("impact_stat", "This is your {cleaning_count_this_year_ordinal} cleaning in {year}. About {block_bags_total} bags so far.", {}),
  rot("impact_alltime", "This was your {cleaning_count_ordinal} cleaning.", {}),
  rot("social_share", "Tag @shareglitter!", { "CTA Label": "Facebook | Instagram | Nextdoor", "CTA URL": "https://facebook.com/shareglitter | instagram.com/shareglitter | https://nextdoor.com/x" }),
  rot("satisfaction", "How'd we do today?", { "CTA Label": "Reply", "CTA URL": "mailto:hello@shareglitter.com?subject=Cleaning on {block_name}" }),
  rot("frequency_upgrade", "Want your block cleaned {next_frequency}? Increase your pledge.", { "CTA Label": "Increase pledge", "CTA URL": "{block_page_url}" }),
  rot("date_and_code", "Cleaned {cleaning_date}. Your code is {referral_code}.", { "CTA Label": "Share", "CTA URL": "{share_url}" }),
  rot("bad_pairs", "x", { "CTA Label": "One | Two", "CTA URL": "https://a.example" }),
  rot("cleaner_spotlight", "Cleaned by {cleaner_first_name}, a neighbor.", {}),
  L("recL_m6", { Key: "milestone_6mo", "Line Text": "Thank you for six months.", Mode: { name: "Milestone" }, Active: true, "Milestone Months": 6 }),
  L("recL_blank", {}),
];
const fill = s => s.replace('"YOUR_EMAIL_HERE", "PRESIDENT_EMAIL_HERE"', '"sid@test.com", "prez@test.com"');
const only = k => s => fill(s).replace('forceKeys: ["*"]', `forceKeys: ${JSON.stringify(k)}`);
const live = s => s.replace('const MODE = "test"', 'const MODE = "live"');
(async () => {
  let r;
  r = await run("1. placeholders left in → must refuse", { lines: ALL });
  check(r.error && !r.sent, "FAIL 1");
  r = await run("2. test, forced review", { lines: ALL, patch: only(["review"]) });
  check(r.sent.every(m => ["sid@test.com", "prez@test.com"].includes(m.To)) && r.sent.length === 2 && r.writes.length === 0 && r.sent[0].TemplateModel.secondary && !r.sent[0].TemplateModel.share, "FAIL 2");
  r = await run("3. test, forced referral → share not secondary", { lines: ALL, patch: only(["referral"]) });
  check(r.sent[0].TemplateModel.share.text === "Know a neighbor?" && r.sent[0].TemplateModel.share.forward_label === "Share" && r.sent[0].TemplateModel.share.forward_mailto && !r.sent[0].TemplateModel.secondary, "FAIL 3");
  r = await run("4. test, forced impact_stat (counts)", { lines: ALL, patch: only(["impact_stat"]) });
  check(r.sent[0].TemplateModel.secondary.text === "This is your 2nd cleaning in 2026. About 4 bags so far.", "FAIL 4: " + r.sent[0].TemplateModel.secondary.text);
  r = await run("4b. test, forced impact_alltime (counts since Member Since include last year)", { lines: ALL, patch: only(["impact_alltime"]) });
  check(r.sent[0].TemplateModel.secondary.text === "This was your 3rd cleaning.", "FAIL 4b: " + r.sent[0].TemplateModel.secondary.text);
  r = await run("5. test, forced cleaner_spotlight, cleaner has not consented → dropped", { lines: ALL, patch: only(["cleaner_spotlight"]) });
  check(!r.sent[0].TemplateModel.secondary && /dropped/.test(r.sent[0].TemplateModel.test_banner.outcome), "FAIL 5");
  r = await run("6. test, real rules → milestone overrides for 20-month member", { lines: ALL, patch: only([]) });
  check(r.sent[0].TemplateModel.secondary.text === "Thank you for six months." && r.writes.length === 0, "FAIL 6");
  r = await run("7. test, quiet hours → nothing sent, no flag written", { lines: ALL, patch: only([]), hour: 23 });
  check(!r.sent && r.writes.length === 0, "FAIL 7");
  r = await run("8. guardrail: sabotage so a subscriber address sneaks in → must throw", { lines: ALL, patch: s => only(["review"])(s).replace('for (const to of (IS_TEST ? TEST.recipients : [r.email]))', 'for (const to of [r.email])') });
  check(r.error && /BLOCKED/.test(r.error) && !r.sent, "FAIL 8");
  r = await run("9. LIVE: real recipients, write-back", { lines: ALL, patch: s => s.replace('const MODE = "test"', 'const MODE = "live"') });
  check(r.sent.length === 2 && r.sent[0].To === "real.customer1@example.com" && !r.sent[0].TemplateModel.test_banner && r.sent[1].TemplateModel.share && r.writes.length === 4, "FAIL 9");
  r = await run("10. LIVE: two rotation lines active → no rotation line, milestone still ok", { lines: [...ALL.slice(0, 1), rot("review", "x", { Active: true }), ALL[4]], patch: s => s.replace('const MODE = "test"', 'const MODE = "live"') });
  check(!r.sent[1].TemplateModel.secondary && !r.sent[1].TemplateModel.share, "FAIL 10");
  r = await run("11. test, nobody eligible → preview still goes to testers only, banner says live sends nothing", { lines: ALL, patch: only(["review"]), noneOptedIn: true });
  check(r.sent && r.sent.length === 2 && r.sent.every(m => ["sid@test.com", "prez@test.com"].includes(m.To)) && /NOBODY/.test(r.sent[0].TemplateModel.test_banner.audience) && r.writes.length === 0, "FAIL 11");
  r = await run("12. test, nobody eligible, preview switched off → nothing sent", { lines: ALL, patch: s => only(["review"])(s).replace("previewWhenNoneEligible: true", "previewWhenNoneEligible: false"), noneOptedIn: true });
  check(!r.sent, "FAIL 12");
  r = await run("13. LIVE, nobody eligible → nothing sent, nothing written", { lines: ALL, patch: s => s.replace('const MODE = "test"', 'const MODE = "live"'), noneOptedIn: true });
  check(!r.sent && r.writes.length === 0, "FAIL 13");
  r = await run("14. test, forced cleaner_spotlight, cleaner consented → line names the cleaner", { lines: ALL, patch: only(["cleaner_spotlight"]), consent: true });
  check(r.sent[0].TemplateModel.secondary && r.sent[0].TemplateModel.secondary.text === "Cleaned by Marcus, a neighbor.", "FAIL 14");
  r = await run("15. three buttons from pipe-separated label/url", { lines: ALL, patch: only(["social_share"]) });
  { const c = r.sent[0].TemplateModel.secondary.ctas; check(c.length === 3 && c[1].url.startsWith("https://instagram.com/shareglitter?utm_source=") && c.map(x => x.label).join() === "Facebook,Instagram,Nextdoor", "FAIL 15: " + JSON.stringify(c)); }
  r = await run("16. mailto Reply button: placeholder encoded, no UTM", { lines: ALL, patch: only(["satisfaction"]) });
  { const c = r.sent[0].TemplateModel.secondary.ctas; check(c.length === 1 && c[0].url === "mailto:hello@shareglitter.com?subject=Cleaning on 1000%20S%20Bouvier%20St", "FAIL 16: " + JSON.stringify(c)); }
  r = await run("17a. frequency_upgrade on an every-other-week block → names the next step", { lines: ALL, patch: only(["frequency_upgrade"]) });
  check(r.sent[0].TemplateModel.secondary.text === "Want your block cleaned 3 out of 4 weeks? Increase your pledge.", "FAIL 17a: " + r.sent[0].TemplateModel.secondary.text);
  r = await run("17b. frequency_upgrade on a weekly block → dropped", { lines: ALL, patch: only(["frequency_upgrade"]), weekly: true });
  check(!r.sent[0].TemplateModel.secondary && /no data for \{next_frequency\}/.test(r.sent[0].TemplateModel.test_banner.outcome), "FAIL 17b: " + r.sent[0].TemplateModel.test_banner.outcome);
  r = await run("18. label/url counts differ → dropped, not half-rendered", { lines: ALL, patch: only(["bad_pairs"]) });
  check(!r.sent[0].TemplateModel.secondary && /2 CTA label/.test(r.sent[0].TemplateModel.test_banner.outcome), "FAIL 18");
  r = await run("19. tour: sendEveryLine sends one email per usable row, testers only, no writes", { lines: ALL, patch: s => fill(s).replace("sendEveryLine: false", "sendEveryLine: true") });
  { const usable = ALL.filter(l => l.getCellValue("Key") && l.getCellValue("Line Text")).length;
    check(r.sent && r.sent.length === usable * 2 && r.sent.every(m => ["sid@test.com", "prez@test.com"].includes(m.To)) && r.writes.length === 0
      && /^\[1\/\d+\] /.test(r.sent[0].TemplateModel.test_banner.outcome) && new Set(r.sent.map(m => m.TemplateModel.test_banner.line_key)).size >= usable - 3, "FAIL 19: " + (r.sent && r.sent.length)); }
  r = await run("20. {cleaning_date}, {referral_code} and {share_url} placeholders", { lines: ALL, patch: only(["date_and_code"]) });
  { const sec = r.sent[0].TemplateModel.secondary; check(sec && sec.text === "Cleaned Friday, September 18. Your code is DARRELL-LG7." && sec.ctas[0].url.startsWith("https://gltr.ly/1000SBouvier?code=DARRELL-LG7&utm_source="), "FAIL 20: " + JSON.stringify(sec)); }
  r = await run("21. {block_cleaning_count_ordinal}: every cleaning of the block, even for a member who joined last month", { lines: [rot("impact_block", "This was your block's {block_cleaning_count_ordinal} cleaning, your {cleaning_count_ordinal}. About {block_bags_total} bags.", { Active: true, "CTA Label": "See your block page", "CTA URL": "{block_page_url}" })], patch: live });
  check(r.sent[0].TemplateModel.secondary.text === "This was your block's 3rd cleaning, your 3rd. About 4 bags." && r.sent[1].TemplateModel.secondary.text === "This was your block's 3rd cleaning, your 1st. About 4 bags.", "FAIL 21: " + JSON.stringify(r.sent.map(m => m.TemplateModel.secondary)));
  const immediateModels = JSON.stringify(r.sent.map(m => [m.To, m.TemplateModel, m.Tag, m.TemplateId]));
  // The canonical copy of the Airtable table: every row must render, with a button, as itself.
  { const seed = parseCsv(fs.readFileSync(path.join(__dirname, "..", "templates", "email_secondary_lines_seed.csv"), "utf8"));
    const seedLines = seed.map((row, i) => L("recSEED" + i, { Key: row["Key"], "Line Text": row["Line Text"], "CTA Label": row["CTA Label"], "CTA URL": row["CTA URL"], Mode: { name: row["Mode"] || "Rotation" } }));
    r = await run("22. seed CSV tour: every row of email_secondary_lines_seed.csv renders with its button", { lines: seedLines, consent: true, patch: s => fill(s).replace('"sid@test.com", "prez@test.com"', '"sid@test.com"').replace("sendEveryLine: false", "sendEveryLine: true") });
    console.log("  rendered rows:");
    for (const m of r.sent || []) { const t = m.TemplateModel; const s = t.secondary || t.share || {};
      console.log(`   ${t.test_banner.outcome}\n      ${(s.text || "").trim()}${t.share ? `  [${t.share.forward_label} → forward mailto]  ${t.share.url}` : (s.ctas || []).map(c => `  [${c.label} → ${c.url.replace(/[?&]utm_source=.*/, "")}]`).join("")}`); }
    check(r.sent && r.sent.length === seed.length && seed.length >= 10 && r.sent.every(m => !/NO LINE/.test(m.TemplateModel.test_banner.outcome) && (m.TemplateModel.share || m.TemplateModel.secondary.ctas.length === 1)), "FAIL 22"); }

  // ── Morning catch-up script ──
  const START = "// SECONDARY LINE MODULE", END = "end secondary line module";
  const moduleOf = s => s.slice(s.indexOf(START), s.indexOf(END));
  console.log("\n=== D0. shared module is byte-identical in both scripts");
  check(rawSrc.includes(START) && moduleOf(rawSrc).length > 5000 && moduleOf(rawSrc) === moduleOf(rawDelayedSrc), "FAIL D0: the secondary line module differs between the two scripts");
  const ONE = [rot("review", "Enjoying Glitter? A quick review helps.", { Active: true, "CTA Label": "Leave a review", "CTA URL": "https://g.page/r/abc", "Emails Sent": 10 }), rot("referral", "Know a neighbor?", {})];
  r = await run("D1. catch-up, placeholders left in → must refuse", { script: "delayed", lines: ONE, delayed: ["recLOG1"] });
  check(r.error && !r.sent && r.writes.length === 0, "FAIL D1");
  r = await run("D2. catch-up test, nothing flagged → previews the 2 most recent logs, testers only, no writes", { script: "delayed", lines: ONE, patch: fill });
  check(r.sent && r.sent.length === 4 && r.sent.every(m => ["sid@test.com", "prez@test.com"].includes(m.To) && m.TemplateAlias === "cleaning-notification-test" && m.TemplateModel.test_banner) && r.writes.length === 0
    && r.sent[0].Metadata.cleaning_log === "recLOG1" && r.sent[2].Metadata.cleaning_log === "recLOG0", "FAIL D2: " + (r.sent && r.sent.length));
  r = await run("D3. catch-up LIVE, two flagged logs → real recipients, running Emails Sent, stamps, flags cleared", { script: "delayed", lines: ONE, patch: live, delayed: ["recLOG1", "recLOG0"] });
  { const counter = r.writes.filter(w => w.table === "Email Secondary Lines").map(w => w.f["Emails Sent"]);
    const cleared = r.writes.filter(w => w.table === "Cleaning Log" && w.f["Email Delayed"] === false).map(w => w.id).sort().join();
    const stamped = r.writes.filter(w => w.table === "Cleaning Log" && w.f["Secondary Line"]).length;
    check(r.sent && r.sent.length === 4 && r.sent.every(m => /^real\.customer/.test(m.To) && m.TemplateId === 45583435 && !m.TemplateModel.test_banner && m.Tag === "secondary:review")
      && /utm_content=review$/.test(r.sent[0].TemplateModel.secondary.ctas[0].url) && counter.join() === "12,14" && cleared === "recLOG0,recLOG1" && stamped === 2 && r.writes.length === 6, "FAIL D3: " + JSON.stringify(r.writes)); }
  r = await run("D4. catch-up LIVE, nothing flagged → nothing sent, nothing written", { script: "delayed", lines: ONE, patch: live });
  check(!r.sent && r.writes.length === 0 && !r.error, "FAIL D4");
  r = await run("D5. catch-up LIVE, Postmark rejects the request → flag stays for tomorrow, nothing written", { script: "delayed", lines: ONE, patch: live, delayed: ["recLOG1"], postmarkStatus: 401 });
  check(!r.sent && r.writes.length === 0 && !r.error, "FAIL D5: " + JSON.stringify(r.writes));
  r = await run("D6. parity: catch-up builds the same messages as the immediate script for the same log", { script: "delayed", lines: [rot("impact_block", "This was your block's {block_cleaning_count_ordinal} cleaning, your {cleaning_count_ordinal}. About {block_bags_total} bags.", { Active: true, "CTA Label": "See your block page", "CTA URL": "{block_page_url}" })], patch: live, delayed: ["recLOG1"] });
  check(r.sent && JSON.stringify(r.sent.map(m => [m.To, m.TemplateModel, m.Tag, m.TemplateId])) === immediateModels, "FAIL D6");
  r = await run("D7. catch-up LIVE, milestone line and two logs for the same subscriber → milestone goes out once", { script: "delayed", lines: ALL, patch: live, delayed: ["recLOG1", "recLOG0"] });
  { const darrell = r.sent.filter(m => m.To === "real.customer1@example.com");
    check(darrell.length === 2 && darrell[0].TemplateModel.secondary && darrell[0].Tag === "secondary:milestone_6mo" && darrell[1].TemplateModel.share && r.writes.filter(w => w.table === "Subscribers").length === 1, "FAIL D7: " + JSON.stringify(darrell.map(m => m.Tag))); }
  r = await run("D8. catch-up test, newest log's block has nobody eligible → passed over, the next two logs are previewed", { script: "delayed", lines: ONE, patch: fill, newestLogHasNobody: true });
  check(r.sent && r.sent.length === 4 && r.sent[0].Metadata.cleaning_log === "recLOG1" && r.sent[2].Metadata.cleaning_log === "recLOG0" && r.writes.length === 0, "FAIL D8: " + (r.sent && r.sent.map(m => m.Metadata.cleaning_log)));
  console.log(failures ? `\nharness done: ${failures} FAILED` : "\nharness done: all scenarios passed");
  process.exit(failures ? 1 : 0);
})();
