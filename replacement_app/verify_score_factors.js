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
const rows = factors({ same_range: true, range_factor: 100, shared_tags: ["stars"], tag_factor: 10000,
  target_rrp_gbp: 3.15, candidate_rrp_gbp: 3.4, price_factor: 9.264705882 });
assert.deepEqual(rows.map((row) => [row.label, row.text, row.tone]), [
  ["Range", "×100", "positive"], ["Shared tags", "×10,000", "positive"],
  ["Price difference", "×9.265", "negative"],
]);
assert.equal(factors({ same_range: false, range_factor: 0 })[0].text, "×0");
assert.equal(factors({ same_range: false, range_factor: 1 })[0].tone, "negative");
assert.equal(factors({ shared_tags: [], tag_factor: 1 })[1].tone, "negative");
assert.equal(factors({ target_rrp_gbp: 3.15, candidate_rrp_gbp: 3.15, price_factor: 10 })[2].tone, "positive");
for (const invalid of [null, undefined, "", " ", NaN, Infinity, "invalid", false]) {
  assert.equal(factors({ same_range: true, range_factor: invalid })[0].text, "Unavailable");
  assert.equal(factors({ target_rrp_gbp: invalid, candidate_rrp_gbp: 3, price_factor: 5 })[2].tone, "neutral");
}
assert.equal(factors({ range_factor: 100 })[0].tone, "neutral");
assert.equal(factors({ tag_factor: 10 })[1].tone, "neutral");
console.log("Score factor checks passed");
