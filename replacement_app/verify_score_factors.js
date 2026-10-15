// Run with: node replacement_app/verify_score_factors.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const context = vm.createContext({ React: {} });
const source = fs.readFileSync(path.join(__dirname, "static/app.js"), "utf8");
vm.runInContext(source.slice(0, source.indexOf("function rackTitle")), context);
const factors = (value) => JSON.parse(JSON.stringify(context.score_factors(value)));

assert(factors({}).every((row) => row.tone === "neutral" && row.text === "Unavailable"));
const rows = factors({ same_range: true, range_factor: 100, shared_tags: ["stars"],
  target_rrp_gbp: 3.15, candidate_rrp_gbp: 3.4, price_factor: 3.15 / 3.4 });
assert.deepEqual(rows.map((row) => [row.label, row.text, row.tone]), [
  ["Range", "×100", "positive"], ["Price difference", "×0.926", "negative"],
]);
assert.deepEqual(rows.map((row) => row.label), ["Range", "Price difference"]);
assert.equal(factors({ same_range: false, range_factor: 0 })[0].text, "×0");
assert.equal(factors({ same_range: false, range_factor: 1 })[0].tone, "negative");
const equal_price = factors({ target_rrp_gbp: 3.15, candidate_rrp_gbp: 3.15, price_factor: 1 })[1];
assert.equal(equal_price.text, "×1");
assert.equal(equal_price.tone, "positive");
const wider_price_gap = factors({ target_rrp_gbp: 2, candidate_rrp_gbp: 5.5, price_factor: 2 / 5.5 })[1];
assert.equal(wider_price_gap.text, "×0.364");
assert.equal(wider_price_gap.tone, "negative");
assert(2 / 5.5 < 3.15 / 3.4);
for (const invalid of [null, undefined, "", " ", NaN, Infinity, "invalid", false]) {
  assert.equal(factors({ same_range: true, range_factor: invalid })[0].text, "Unavailable");
  assert.equal(factors({ target_rrp_gbp: invalid, candidate_rrp_gbp: 3, price_factor: 1 })[1].tone, "neutral");
}
assert.equal(factors({ range_factor: 100 })[0].tone, "neutral");

for (const filename of [
  path.join(__dirname, "..", "rank_material_replacement_candidates.sql"),
  path.join(__dirname, "sql", "refresh_snapshots.sql"),
]) {
  const sql = fs.readFileSync(filename, "utf8");
  assert.doesNotMatch(sql, /\bshared_tag_count\b|\btag_factor\b/);
  assert.match(sql, /SORT_ARRAY\(COLLECT_SET\(candidate_tag\.tag\)\) AS shared_tags/);
  assert.equal((sql.match(/LEAST\(p\.target_rrp, p\.candidate_rrp\)\s*\/\s*GREATEST\(p\.target_rrp, p\.candidate_rrp\)/g) || []).length, 2);
  assert.doesNotMatch(sql, /10\.0\s*\*\s*LEAST\(p\.target_rrp/);
}
console.log("Score factor checks passed");
