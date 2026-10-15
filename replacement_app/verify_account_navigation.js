// Run with: node replacement_app/verify_account_navigation.js
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "static/app.js"), "utf8");
const pending = [];
const state = { page: null, loading: false, error: "" };
const context = vm.createContext({
  URLSearchParams,
  active_material_ref: { current: "507205" },
  rack_request_ref: { current: 0 },
  setLoadingRack: (value) => { state.loading = value; },
  setRackError: (value) => { state.error = value; },
  setRackPage: (value) => { state.page = value; },
  request: (url) => new Promise((resolve, reject) => pending.push({ url, resolve, reject })),
});
vm.runInContext(source.slice(source.indexOf("  async function loadRack("), source.indexOf("  async function loadMoreTargets(")), context);
const plain = (value) => JSON.parse(JSON.stringify(value));
const rack_page = (account) => ({ items: [{ account }], next_cursor: "1", previous_cursor: null });

async function main_check() {
  const initial = context.loadRack(null);
  assert.equal(pending[0].url, "/api/targets/507205/rack-examples");
  const selected = context.loadRack(null, "ABB020");
  assert.equal(pending[1].url, "/api/targets/507205/rack-examples?account=ABB020");
  assert.deepEqual(plain(state.page), { items: [], next_cursor: null, previous_cursor: null });
  pending[1].resolve(rack_page("ABB020"));
  await selected;
  pending[0].resolve(rack_page("OLD"));
  await initial;
  assert.equal(state.page.items[0].account, "ABB020");

  const older = context.loadRack(null, "ABB020");
  const latest = context.loadRack(null, "XYZ030");
  pending[2].reject(new Error("Old account failed"));
  await older;
  assert.equal(state.loading, true);
  assert.equal(state.error, "");
  pending[3].resolve(rack_page("XYZ030"));
  await latest;
  assert.equal(state.page.items[0].account, "XYZ030");
  assert.equal(state.loading, false);

  const previous = context.loadRack("0", "A&B + C");
  const previous_url = new URL(pending[4].url, "http://localhost");
  assert.equal(previous_url.searchParams.get("account"), "A&B + C");
  assert.equal(previous_url.searchParams.get("cursor"), "0");
  pending[4].resolve({ items: [], next_cursor: null, previous_cursor: null });
  await previous;
  assert.equal(state.page.items.length, 0);

  const failed = context.loadRack(null, "XYZ030");
  pending[5].reject(new Error("Warehouse unavailable"));
  await failed;
  assert.equal(state.error, "Warehouse unavailable");
  const retry = context.loadRack(null, "XYZ030");
  assert.equal(state.error, "");
  pending[6].resolve(rack_page("XYZ030"));
  await retry;

  const old_material = context.loadRack(null, "ABB020");
  context.active_material_ref.current = "517792";
  const new_material = context.loadRack(null, null, "517792");
  assert.equal(pending[8].url, "/api/targets/517792/rack-examples");
  pending[8].resolve(rack_page("NEW"));
  await new_material;
  pending[7].resolve(rack_page("OLD MATERIAL"));
  await old_material;
  assert.equal(state.page.items[0].account, "NEW");
  console.log("Account navigation checks passed");
}

main_check().catch((error) => { console.error(error); process.exitCode = 1; });
