const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const api = require("../dist/selecto-api-console.js");

test("exports a reusable browser and CommonJS surface", () => {
  assert.equal(api.version, "0.3.2");
  assert.equal(typeof api.APIConsole, "function");
  assert.equal(typeof api.mountAll, "function");
});

test("offers Explorer-style quick periods only for temporal filters", () => {
  assert.ok(api.operatorsForType("date").includes("date_shortcut"));
  assert.ok(api.operatorsForType("epoch_datetime").includes("date_shortcut"));
  assert.ok(!api.operatorsForType("decimal").includes("date_shortcut"));
  const consoleInstance = new api.APIConsole({dataset: {}});
  assert.ok(consoleInstance.dateShortcuts().some((choice) => choice[1] === "mtd_all_years"));
  assert.ok(consoleInstance.dateShortcuts().some((choice) => choice[1] === "qtd_all_years"));
  assert.ok(consoleInstance.dateShortcuts().some((choice) => choice[1] === "ytd_all_years"));
  consoleInstance.fieldMap = new Map([["occurred_at", {path: "occurred_at", type: "epoch_datetime"}]]);
  assert.deepEqual(consoleInstance.filterPayloads({
    field: "occurred_at", op: "date_shortcut", value: "this_week",
  }), [{field: "occurred_at", op: "date_shortcut", value: "this_week"}]);
  consoleInstance.openapi = {components: {schemas: {SelectoFilter: {
    "x-selecto-date-shortcuts": [{group: "Weeks", id: "this_week", label: "This Week"}],
  }}}};
  assert.deepEqual(consoleInstance.dateShortcuts(), [["Weeks", "this_week", "This Week"]]);
});

test("accepts only absolute same-origin API paths", () => {
  assert.equal(api.normalizeAPIBase("/api/v1/orders/"), "/api/v1/orders");
  assert.equal(api.normalizeAPIBase(""), "/api/v1/selecto");
  for (const value of ["api/v1/orders", "//example.test/api", "/api//orders", "/api/orders?x=1", "/api/../admin", "/api/%2e%2e/admin", "/api/%ZZ"]) {
    assert.throws(() => api.normalizeAPIBase(value), /same-origin API path/);
  }
});

test("ignores advertised routes that are not same-origin paths", async () => {
  const requests = [];
  await api.discoverCanonicalAPI("/api/v1/selecto", async (path) => {
    requests.push(path);
    if (path.endsWith("/")) return {routes: [{operation_id: "getDomain", path: "//example.test/domain"}]};
    if (path.endsWith("/domain")) return {source: {columns: {}}};
    return {openapi: "3.1.0"};
  });
  assert.deepEqual(requests, [
    "/api/v1/selecto/",
    "/api/v1/selecto/domain",
    "/api/v1/selecto/openapi.json",
  ]);
});

test("derives sorted public fields from a canonical domain", () => {
  const fields = api.collectFields({
    source: {
      fields: ["secret", "name", "id"],
      columns: {
        id: {type: "integer", label: "Identifier"},
        name: {type: "string", label: "Account name"},
        secret: {type: "string", internal: true},
      },
      associations: {orders: {queryable: "order"}},
    },
    schemas: {
      order: {fields: ["total"], columns: {total: {type: "decimal", label: "Order total"}}},
    },
  });
  assert.deepEqual(fields.map((field) => field.path), ["name", "id", "orders.total"]);
});

test("preserves exact decimal strings for table and JSON result rendering", () => {
  const response = JSON.parse('{"data":{"rows":[["1.2500"]]},"ok":true}');
  assert.equal(response.data.rows[0][0], "1.2500");
  assert.equal(api.renderValue(response.data.rows[0][0]), "1.2500");
  assert.match(JSON.stringify(response), /"1\.2500"/);
});

test("discovers advertised canonical API routes without backend assumptions", async () => {
  const requests = [];
  const responses = new Map([
    ["/api/v7/orders/", {routes: [
      {operation_id: "getDomain", path: "/api/v7/orders/schema"},
      {operation_id: "getOpenApi", path: "/api/v7/orders/spec"},
      {operation_id: "queryDomain", path: "/api/v7/orders/search"},
    ]}],
    ["/api/v7/orders/schema", {source: {columns: {id: {type: "integer"}}}}],
    ["/api/v7/orders/spec", {openapi: "3.1.0"}],
  ]);
  const discovery = await api.discoverCanonicalAPI("/api/v7/orders/", async (path) => {
    requests.push(path);
    return responses.get(path);
  });
  assert.deepEqual(requests, ["/api/v7/orders/", "/api/v7/orders/schema", "/api/v7/orders/spec"]);
  assert.equal(discovery.queryPath, "/api/v7/orders/search");
  assert.equal(discovery.openapi.openapi, "3.1.0");
});

test("build emits a standalone same-origin console", () => {
  const html = fs.readFileSync("dist/index.html", "utf8");
  const css = fs.readFileSync("dist/selecto-api-console.css", "utf8");
  const manifest = JSON.parse(fs.readFileSync("dist/manifest.json", "utf8"));
  const compatibility = JSON.parse(fs.readFileSync("dist/compatibility.json", "utf8"));
  assert.match(html, /data-selecto-api-console/);
  assert.match(html, /selecto-api-console\.js/);
  assert.match(css, /\.sac-query-layout/);
  assert.equal(manifest.format, "selecto.api-console.assets.v1");
  assert.equal(manifest.version, "0.3.2");
  assert.equal(compatibility.targets.length, 14);
  assert.equal(new Set(compatibility.targets.map((target) => target.lineage)).size, 11);
});
