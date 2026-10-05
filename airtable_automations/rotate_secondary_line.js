// ============================================================
// Airtable Automation Script Block — Rotate the secondary line
// Moves the Active checkbox in "Email Secondary Lines" on to the next row,
// so the cleaning email's secondary line changes without anyone touching it.
//
// HOW IT PICKS:
// - Only rows with a number in "Rotation Order" take part (blank = never
//   picked automatically). They must also be Rotation-mode rows with a Key
//   and Line Text, inside their Start Date / End Date window.
// - The next row is the one after the current Active row in Rotation Order,
//   wrapping round to the lowest number.
// - If the Active row is not part of the rotation (ticked by hand, expired,
//   or nothing is ticked), it resumes with the row sent least recently.
// - Every run moves the line on, so the trigger's schedule sets the pace.
//
// SETUP:
// 1. "Email Secondary Lines": add a Number field "Rotation Order" (integer)
//    and number the rows that should rotate: 1, 2, 3, ...
// 2. New automation. Trigger: "At a scheduled time", every 10 days, early
//    morning Eastern. Action: "Run a script", paste this whole file.
//    No input variables, no secrets.
// 3. Click Test with DRY_RUN = true: it logs what it would do, writes nothing.
//    Then set DRY_RUN = false and turn the automation on.
//
// Spec and rollout notes: docs/cleaning_email_roadmap.md
// ============================================================

// true: log the move without making it. false: move the checkbox.
// Clicking Test with false really does rotate the line.
const DRY_RUN = true;

const ROTATE_CONFIG = {
    table: "Email Secondary Lines",
    f: {
        key: "Key",
        text: "Line Text",
        mode: "Mode",                // "Rotation" | "Milestone"; milestone rows are left alone
        active: "Active",
        startDate: "Start Date",
        endDate: "End Date",
        lastSent: "Last Sent",
        order: "Rotation Order",
    },
};

const c = ROTATE_CONFIG;
const table = base.getTable(c.table);
if (!table.fields.some(f => f.name === c.f.order)) {
    throw new Error(`"${c.table}" has no "${c.f.order}" field. Add it as a Number field and number the rows that should rotate.`);
}
const q = await table.selectRecordsAsync({ fields: Object.values(c.f) });

// Same window rule as loadSecondaryLines() in the send scripts.
const today = new Date();
const inWindow = (r) => {
    const s = r.getCellValue(c.f.startDate);
    const e = r.getCellValue(c.f.endDate);
    if (s && new Date(s) > today) return false;
    if (e && new Date(e) < today) return false;
    return true;
};
const isRotation = (r) => ((r.getCellValue(c.f.mode) || {}).name || "Rotation") === "Rotation";
const keyOf = (r) => r.getCellValue(c.f.key) || r.id;

const activeNow = q.records.filter(r => isRotation(r) && r.getCellValue(c.f.active) === true);
const pool = q.records
    .filter(r => isRotation(r) && r.getCellValue(c.f.key) && r.getCellValue(c.f.text)
        && typeof r.getCellValue(c.f.order) === "number" && inWindow(r))
    .sort((a, b) => a.getCellValue(c.f.order) - b.getCellValue(c.f.order) || String(keyOf(a)).localeCompare(String(keyOf(b))));

console.log(`Active now: ${activeNow.map(keyOf).join(", ") || "(none)"}`);
console.log(`In rotation (${pool.length}): ${pool.map(r => `${r.getCellValue(c.f.order)}. ${keyOf(r)}`).join(", ") || "(none)"}`);

if (pool.length === 0) {
    console.log(`No row has a "${c.f.order}" number, a Key and Line Text, and an open date window. Nothing changed.`);
    return;
}

const current = pool.find(r => activeNow.some(a => a.id === r.id));
let next, why;
if (current) {
    next = pool[(pool.indexOf(current) + 1) % pool.length];
    why = `next after "${keyOf(current)}" in ${c.f.order}`;
} else {
    // Resume where the rotation left off: never-sent rows first, then the oldest send.
    const sentAt = (r) => r.getCellValue(c.f.lastSent) ? new Date(r.getCellValue(c.f.lastSent)).getTime() : 0;
    next = [...pool].sort((a, b) => sentAt(a) - sentAt(b))[0];
    why = "the Active row is not in the rotation, so resuming with the row sent least recently";
}

// One call, so the send scripts never see two rows ticked or none.
const updates = activeNow.filter(r => r.id !== next.id).map(r => ({ id: r.id, fields: { [c.f.active]: false } }));
if (next.getCellValue(c.f.active) !== true) updates.push({ id: next.id, fields: { [c.f.active]: true } });

if (updates.length === 0) {
    console.log(`"${keyOf(next)}" is the only row in the rotation and is already Active. Nothing changed.`);
    return;
}
if (DRY_RUN) {
    console.log(`DRY RUN: would make "${keyOf(next)}" the Active line (${why}). Nothing changed.`);
    return;
}
await table.updateRecordsAsync(updates);
console.log(`✓ "${keyOf(next)}" is now the Active line (${why}).`);
