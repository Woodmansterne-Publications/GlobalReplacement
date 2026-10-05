// Run with: node replacement_app/verify_rack_layout.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "static/rack_layout.js"), "utf8"), context);
const { rack_neighbourhood, rack_scale, positioned_slots } = context;
const label_height = vm.runInContext("RACK_LABEL_HEIGHT_PX", context);
const plain = (value) => JSON.parse(JSON.stringify(value));

function rack(rows, columns, target_tier, target_position) {
  return Array.from({ length: rows * columns }, (_, index) => {
    const tier = Math.floor(index / columns) + 1;
    const position = index % columns + 1;
    return { tier, position, material: tier === target_tier && position === target_position ? "target" : `${tier}${position}` };
  });
}

let layout = rack_neighbourhood(rack(5, 5, 3, 3), "target");
assert.deepEqual(plain(layout.tiers), [4, 3, 2]);
assert.deepEqual(plain(layout.positions), [2, 3, 4]);
for (const [tier, position] of [[1, 1], [5, 5], [1, 3], [3, 5]]) {
  layout = rack_neighbourhood(rack(5, 5, tier, position), "target");
  assert.equal(layout.cells.flat().length, 9);
  assert(layout.tiers.includes(tier) && layout.positions.includes(position));
  assert(layout.tiers.every((value) => value >= 1 && value <= 5));
  assert(layout.positions.every((value) => value >= 1 && value <= 5));
}
for (const [rows, columns] of [[5, 1], [5, 2], [1, 1], [2, 2]]) {
  layout = rack_neighbourhood(rack(rows, columns, 1, 1), "target");
  assert.equal(layout.tiers.length, Math.min(3, rows));
  assert.equal(layout.positions.length, Math.min(3, columns));
}
const sparse = rack(3, 3, 2, 2).filter((slot) => !(slot.tier === 3 && slot.position === 2));
layout = rack_neighbourhood(sparse, "target");
assert.equal(layout.cells[0][1], undefined);
assert.equal(layout.cells[0][2].position, 3);
const repeated = rack(5, 5, 1, 1);
repeated.find((slot) => slot.tier === 5 && slot.position === 5).material = "target";
assert.equal(rack_neighbourhood(repeated, "target").selected.tier, 5);
assert.equal(rack_neighbourhood(repeated, "target", "1:1").selected.tier, 1);
assert.equal(rack_neighbourhood(repeated, "target", "missing").selected.tier, 5);
assert.equal(rack_neighbourhood(rack(3, 3, 2, 2), "target", "1:1").selected.tier, 2);
const mixed = rack(3, 3, 2, 2);
Object.assign(mixed[0], { width_mm: 258, height_mm: 360 });
Object.assign(mixed[1], { width_mm: 0, height_mm: 90 });
Object.assign(mixed[2], { width_mm: 100, height_mm: Infinity });
layout = rack_neighbourhood(mixed, "target");
assert.equal(layout.cells[2][0].width_mm / layout.cells[1][1].width_mm, 2);
assert.equal(layout.column_widths[0], 258);
assert.equal(layout.row_heights[2], 360);
assert.equal(layout.cells[2][1].width_mm, 129);
assert.equal(layout.cells[2][1].height_mm, 90);
assert.equal(layout.cells[2][2].height_mm, 180);
for (const value of [null, "", -1, NaN, Infinity, "invalid"]) {
  const [slot] = positioned_slots([{ tier: 1, position: 1, width_mm: value, height_mm: value }], "target");
  assert.equal(slot.width_mm, 129);
  assert.equal(slot.height_mm, 180);
}
for (const width of [160, 280, 500]) {
  const scale = rack_scale(layout, width);
  assert(layout.width_mm * scale <= width + 1e-8);
  assert(layout.height_mm * scale + layout.tiers.length * label_height + 16 <= 390 + 1e-8);
}
assert.equal(rack_neighbourhood([], "target"), null);
const compact_scale = rack_scale(layout, 300, 240);
assert(layout.height_mm * compact_scale + layout.tiers.length * label_height + 16 <= 240 + 1e-8);
assert.equal(rack_neighbourhood([{ tier: null, position: 1, material: "target" }], "target"), null);
console.log("Rack layout checks passed");
