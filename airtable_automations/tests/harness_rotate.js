// Offline check for rotate_secondary_line.js: mocks the Airtable base and runs
// the scenarios below (order, wrap-around, hand-ticked rows, date windows, dry run).
// Run:  node airtable_automations/tests/harness_rotate.js
// Prints "Assertion failed" for any scenario that breaks and exits 1.
const fs = require("fs");
const path = require("path");
const src = fs.readFileSync(process.argv[2] || path.join(__dirname, "..", "rotate_secondary_line.js"), "utf8")
  .replace(/const DRY_RUN = (true|false)/, "const DRY_RUN = false");
let failures = 0;
const check = (ok, ...msg) => { if (!ok) { failures++; console.log("Assertion failed:", ...msg); } };
const rec = (id, cells) => ({ id, getCellValue: f => (f in cells ? cells[f] : null) });
const row = (key, order, extra = {}) => rec("rec_" + key, { Key: key, "Line Text": "text", Mode: { name: "Rotation" }, "Rotation Order": order, ...extra });

async function run(name, rows, { patch = s => s, hasOrderField = true } = {}) {
  const calls = []; const logs = []; let error = null;
  const fields = ["Key", "Line Text", "Mode", "Active", "Start Date", "End Date", "Last Sent"].concat(hasOrderField ? ["Rotation Order"] : []).map(n => ({ name: n }));
  const base = { getTable: () => ({ fields, selectRecordsAsync: async () => ({ records: rows }), updateRecordsAsync: async u => calls.push(u) }) };
  const RealDate = Date;
  class FakeDate extends RealDate { constructor(...a) { if (a.length) super(...a); else super(RealDate.UTC(2026, 9, 5, 10, 0, 0)); } }
  try { await new Function("base", "console", "Date", `return (async () => {${patch(src)}\n})()`)(base, { log: (...a) => logs.push(a.join(" ")) }, FakeDate); } catch (e) { error = e.message; }
  // Apply the writes to a plain map so each scenario can assert on the end state.
  const active = new Set(rows.filter(r => r.getCellValue("Active") === true).map(r => r.getCellValue("Key")));
  for (const u of calls.flat()) { const k = rows.find(r => r.id === u.id).getCellValue("Key"); if (u.fields.Active) active.add(k); else active.delete(k); }
  console.log(`=== ${name}\n  ${error ? "THREW: " + error : logs[logs.length - 1]}`);
  return { calls, error, active: [...active].sort().join() };
}

(async () => {
  let r;
  r = await run("1. no Rotation Order field → refuses with a setup message", [row("a", 1)], { hasOrderField: false });
  check(r.error && /Rotation Order/.test(r.error) && r.calls.length === 0, "FAIL 1");
  r = await run("2. dry run → logs the move, writes nothing", [row("a", 1, { Active: true }), row("b", 2)], { patch: s => s.replace("const DRY_RUN = false", "const DRY_RUN = true") });
  check(r.calls.length === 0 && r.active === "a" && !r.error, "FAIL 2");
  r = await run("3. moves to the next number, in one write call", [row("c", 3), row("a", 1, { Active: true }), row("b", 2)]);
  check(r.active === "b" && r.calls.length === 1 && r.calls[0].length === 2, "FAIL 3: " + r.active);
  r = await run("4. wraps from the highest number to the lowest", [row("a", 1), row("b", 2), row("c", 3, { Active: true })]);
  check(r.active === "a", "FAIL 4: " + r.active);
  r = await run("5. two rows ticked → ends with exactly one", [row("a", 1, { Active: true }), row("b", 2, { Active: true }), row("c", 3)]);
  check(r.active === "b", "FAIL 5: " + r.active);
  r = await run("6. hand-ticked row with no number → unticked, resumes with the least recently sent", [row("special", null, { Active: true }), row("a", 1, { "Last Sent": "2026-09-01" }), row("b", 2, { "Last Sent": "2026-09-11" }), row("c", 3), row("d", 4)]);
  check(r.active === "c", "FAIL 6: " + r.active);
  r = await run("7. nothing ticked, nothing ever sent → starts at the lowest number", [row("b", 2), row("a", 1)]);
  check(r.active === "a", "FAIL 7: " + r.active);
  r = await run("8. skips rows with no number, no text, a closed window, or Milestone mode", [row("a", 1, { Active: true }), row("nonum", null), row("notext", 2, { "Line Text": "" }), row("future", 3, { "Start Date": "2026-12-01" }), row("ended", 4, { "End Date": "2026-09-01" }), rec("rec_m", { Key: "m", "Line Text": "t", Mode: { name: "Milestone" }, "Rotation Order": 5, Active: true }), row("z", 6)]);
  check(r.active === "m,z", "FAIL 8: " + r.active);
  r = await run("9. one row in the rotation, already Active → nothing written", [row("a", 1, { Active: true }), row("nonum", null)]);
  check(r.calls.length === 0 && r.active === "a" && !r.error, "FAIL 9");
  r = await run("10. no row has a number → nothing written", [row("a", null, { Active: true })]);
  check(r.calls.length === 0 && r.active === "a" && !r.error, "FAIL 10");
  console.log(failures ? `\nharness done: ${failures} FAILED` : "\nharness done: all scenarios passed");
  process.exit(failures ? 1 : 0);
})();
