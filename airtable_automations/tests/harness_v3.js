// Offline check for email_automation_v3_secondary.js: mocks the Airtable base,
// input.secret and Postmark, then runs ten scenarios (test-mode allowlist,
// forced lines, dropped placeholders, quiet hours, live write-back).
// Run:  node airtable_automations/tests/harness_v3.js
// Prints "Assertion failed" for any scenario that breaks.
const fs = require("fs");
const src = fs.readFileSync(process.argv[2] || require("path").join(__dirname, "..", "email_automation_v3_secondary.js"), "utf8");
function rec(id, cells) { return { id, getCellValue: f => (f in cells ? cells[f] : null), getCellValueAsString: f => String(cells[f] ?? "") }; }
async function run(name, { patch = s => s, lines, hour = 14, consent = false, noneOptedIn = false, weekly = false }) {
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
  if (noneOptedIn) tables["Subscribers"] = tables["Subscribers"].map(r => rec(r.id, { Email: r.getCellValue("Email"), "Display Name": r.getCellValue("Display Name"), "Referral Code": r.getCellValue("Referral Code"), "Member Since": r.getCellValue("Member Since"), "Cleaning Notifications Opt-In": false }));
  const base = { getTable: n => ({
    selectRecordAsync: async id => tables[n].find(r => r.id === id) || null,
    selectRecordsAsync: async o => ({ records: o && o.recordIds ? tables[n].filter(r => o.recordIds.includes(r.id)) : tables[n] }),
    updateRecordAsync: async (id, f) => writes.push({ table: n, id, f }),
  }) };
  const input = { config: () => ({ recordId: "recLOG1" }), secret: k => "SECRET-" + k };
  const fetch = async (url, o) => { sent = JSON.parse(o.body).Messages; return { ok: true, status: 200, json: async () => sent.map(m => ({ To: m.To, ErrorCode: 0 })) }; };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.UTC(2026, 8, 18, hour + 4, 0, 0)); } }
  const logs = []; const con = { log: (...a) => logs.push(a.join(" ")) };
  let error = null;
  try { await new Function("base", "input", "fetch", "console", "Date", `return (async () => {${patch(src)}\n})()`)(base, input, fetch, con, FakeDate); } catch (e) { error = e.message; }
  console.log(`\n=== ${name}`);
  if (error) console.log("  THREW:", error);
  console.log("  to:", sent ? sent.map(m => m.To).join(", ") : "(nothing sent)");
  if (sent) for (const m of sent.slice(0, 2)) { const t = m.TemplateModel; console.log("  model:", JSON.stringify({ as: t.display_name, secondary: t.secondary, share: t.share && t.share.url, banner: t.test_banner && t.test_banner.outcome, tpl: m.TemplateAlias || m.TemplateId, tag: m.Tag })); }
  console.log("  writes:", JSON.stringify(writes));
  return { sent, writes, error, logs };
}
const L = (id, c) => rec(id, c);
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
(async () => {
  let r;
  r = await run("1. placeholders left in → must refuse", { lines: ALL });
  console.assert(r.error && !r.sent, "FAIL 1");
  r = await run("2. test, forced review", { lines: ALL, patch: only(["review"]) });
  console.assert(r.sent.every(m => ["sid@test.com", "prez@test.com"].includes(m.To)) && r.sent.length === 2 && r.writes.length === 0 && r.sent[0].TemplateModel.secondary && !r.sent[0].TemplateModel.share, "FAIL 2");
  r = await run("3. test, forced referral → share not secondary", { lines: ALL, patch: only(["referral"]) });
  console.assert(r.sent[0].TemplateModel.share.text === "Know a neighbor?" && r.sent[0].TemplateModel.share.forward_label === "Share" && r.sent[0].TemplateModel.share.forward_mailto && !r.sent[0].TemplateModel.secondary, "FAIL 3");
  r = await run("4. test, forced impact_stat (counts)", { lines: ALL, patch: only(["impact_stat"]) });
  console.assert(r.sent[0].TemplateModel.secondary.text === "This is your 2nd cleaning in 2026. About 4 bags so far.", "FAIL 4: " + r.sent[0].TemplateModel.secondary.text);
  r = await run("4b. test, forced impact_alltime (counts since Member Since include last year)", { lines: ALL, patch: only(["impact_alltime"]) });
  console.assert(r.sent[0].TemplateModel.secondary.text === "This was your 3rd cleaning.", "FAIL 4b: " + r.sent[0].TemplateModel.secondary.text);
  r = await run("5. test, forced cleaner_spotlight, cleaner has not consented → dropped", { lines: ALL, patch: only(["cleaner_spotlight"]) });
  console.assert(!r.sent[0].TemplateModel.secondary && /dropped/.test(r.sent[0].TemplateModel.test_banner.outcome), "FAIL 5");
  r = await run("6. test, real rules → milestone overrides for 20-month member", { lines: ALL, patch: only([]) });
  console.assert(r.sent[0].TemplateModel.secondary.text === "Thank you for six months." && r.writes.length === 0, "FAIL 6");
  r = await run("7. test, quiet hours → nothing sent, no flag written", { lines: ALL, patch: only([]), hour: 23 });
  console.assert(!r.sent && r.writes.length === 0, "FAIL 7");
  r = await run("8. guardrail: sabotage so a subscriber address sneaks in → must throw", { lines: ALL, patch: s => only(["review"])(s).replace('for (const to of (IS_TEST ? TEST.recipients : [r.email]))', 'for (const to of [r.email])') });
  console.assert(r.error && /BLOCKED/.test(r.error) && !r.sent, "FAIL 8");
  r = await run("9. LIVE: real recipients, write-back", { lines: ALL, patch: s => s.replace('const MODE = "test"', 'const MODE = "live"') });
  console.assert(r.sent.length === 2 && r.sent[0].To === "real.customer1@example.com" && !r.sent[0].TemplateModel.test_banner && r.sent[1].TemplateModel.share && r.writes.length === 4, "FAIL 9");
  r = await run("10. LIVE: two rotation lines active → no rotation line, milestone still ok", { lines: [...ALL.slice(0, 1), rot("review", "x", { Active: true }), ALL[4]], patch: s => s.replace('const MODE = "test"', 'const MODE = "live"') });
  console.assert(!r.sent[1].TemplateModel.secondary && !r.sent[1].TemplateModel.share, "FAIL 10");
  r = await run("11. test, nobody eligible → preview still goes to testers only, banner says live sends nothing", { lines: ALL, patch: only(["review"]), noneOptedIn: true });
  console.assert(r.sent && r.sent.length === 2 && r.sent.every(m => ["sid@test.com", "prez@test.com"].includes(m.To)) && /NOBODY/.test(r.sent[0].TemplateModel.test_banner.audience) && r.writes.length === 0, "FAIL 11");
  r = await run("12. test, nobody eligible, preview switched off → nothing sent", { lines: ALL, patch: s => only(["review"])(s).replace("previewWhenNoneEligible: true", "previewWhenNoneEligible: false"), noneOptedIn: true });
  console.assert(!r.sent, "FAIL 12");
  r = await run("13. LIVE, nobody eligible → nothing sent, nothing written", { lines: ALL, patch: s => s.replace('const MODE = "test"', 'const MODE = "live"'), noneOptedIn: true });
  console.assert(!r.sent && r.writes.length === 0, "FAIL 13");
  r = await run("14. test, forced cleaner_spotlight, cleaner consented → line names the cleaner", { lines: ALL, patch: only(["cleaner_spotlight"]), consent: true });
  console.assert(r.sent[0].TemplateModel.secondary && r.sent[0].TemplateModel.secondary.text === "Cleaned by Marcus, a neighbor.", "FAIL 14");
  r = await run("15. three buttons from pipe-separated label/url", { lines: ALL, patch: only(["social_share"]) });
  { const c = r.sent[0].TemplateModel.secondary.ctas; console.assert(c.length === 3 && c[1].url.startsWith("https://instagram.com/shareglitter?utm_source=") && c.map(x => x.label).join() === "Facebook,Instagram,Nextdoor", "FAIL 15: " + JSON.stringify(c)); }
  r = await run("16. mailto Reply button: placeholder encoded, no UTM", { lines: ALL, patch: only(["satisfaction"]) });
  { const c = r.sent[0].TemplateModel.secondary.ctas; console.assert(c.length === 1 && c[0].url === "mailto:hello@shareglitter.com?subject=Cleaning on 1000%20S%20Bouvier%20St", "FAIL 16: " + JSON.stringify(c)); }
  r = await run("17a. frequency_upgrade on an every-other-week block → names the next step", { lines: ALL, patch: only(["frequency_upgrade"]) });
  console.assert(r.sent[0].TemplateModel.secondary.text === "Want your block cleaned 3 out of 4 weeks? Increase your pledge.", "FAIL 17a: " + r.sent[0].TemplateModel.secondary.text);
  r = await run("17b. frequency_upgrade on a weekly block → dropped", { lines: ALL, patch: only(["frequency_upgrade"]), weekly: true });
  console.assert(!r.sent[0].TemplateModel.secondary && /no data for \{next_frequency\}/.test(r.sent[0].TemplateModel.test_banner.outcome), "FAIL 17b: " + r.sent[0].TemplateModel.test_banner.outcome);
  r = await run("18. label/url counts differ → dropped, not half-rendered", { lines: ALL, patch: only(["bad_pairs"]) });
  console.assert(!r.sent[0].TemplateModel.secondary && /2 CTA label/.test(r.sent[0].TemplateModel.test_banner.outcome), "FAIL 18");
  r = await run("19. tour: sendEveryLine sends one email per usable row, testers only, no writes", { lines: ALL, patch: s => fill(s).replace("sendEveryLine: false", "sendEveryLine: true") });
  { const usable = ALL.filter(l => l.getCellValue("Key") && l.getCellValue("Line Text")).length;
    console.assert(r.sent && r.sent.length === usable * 2 && r.sent.every(m => ["sid@test.com", "prez@test.com"].includes(m.To)) && r.writes.length === 0
      && /^\[1\/\d+\] /.test(r.sent[0].TemplateModel.test_banner.outcome) && new Set(r.sent.map(m => m.TemplateModel.test_banner.line_key)).size >= usable - 3, "FAIL 19: " + (r.sent && r.sent.length)); }
  r = await run("20. {cleaning_date}, {referral_code} and {share_url} placeholders", { lines: ALL, patch: only(["date_and_code"]) });
  { const sec = r.sent[0].TemplateModel.secondary; console.assert(sec && sec.text === "Cleaned Friday, September 18. Your code is DARRELL-LG7." && sec.ctas[0].url.startsWith("https://gltr.ly/1000SBouvier?code=DARRELL-LG7&utm_source="), "FAIL 20: " + JSON.stringify(sec)); }
  console.log("\nharness done");
})();
