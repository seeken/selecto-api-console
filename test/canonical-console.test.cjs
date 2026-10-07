const assert = require("node:assert/strict");
const test = require("node:test");
const {APIConsole, renderValue} = require("../dist/selecto-api-console.js");

const metadata = {format: "selecto.explorer-metadata", format_version: 1,
  domain: {id: "items", fingerprint: "fp", publication: "alpha"}, label: "Items",
  fields: [{id: "source.id", path: "id", label: "Id", type: "integer", encoding: "json", nullable: false}],
  default_select: ["source.id"], query: {profile: "remote_query.v1", operators: ["eq", "is_not_null"], limits: {max_limit: 100, max_offset: 100000, max_filters: 20}, supports: {detail: true, nested: false, recursive_filters: false, aggregates: false}}, services: {}};

function instance() {
  const console = new APIConsole({dataset: {apiBase: "/api/items"}});
  console.remoteMode = true;
  console.manifest = {domain: {fingerprint: "fp"}};
  console.domain = {source: {fields: ["id"], columns: {id: {type: "integer"}}}, schemas: {}, query_library: {}};
  console.fields = [{path: "id", type: "integer"}];
  console.fieldMap = new Map([["id", console.fields[0]]]);
  console.filterFields = console.fields;
  console.filterFieldMap = console.fieldMap;
  console.state.selectedFields = [{id: "1", field: "id", alias: "", format: ""}];
  console.explorerMetadata = metadata;
  return console;
}

test("profile-aware Console chooser emits the same shared remote envelope", () => {
  const console = instance();
  console.state.timezone = "America/Denver";
  const payload = console.buildPayload();
  assert.equal(payload.format, "selecto.remote-query");
  assert.equal(payload.domain.fingerprint, "fp");
  assert.equal(payload.query.timezone, "America/Denver");
  assert.deepEqual(payload.query.select, ["id"]);
  console.loadPayloadIntoChooser(payload);
  assert.equal(console.state.timezone, "America/Denver");
  console.state.limit = 0;
  assert.throws(() => console.buildPayload(), /integer >= 1/);
});

test("Explorer handoff preserves timezone/publication and rejects unrepresentable semantics atomically", () => {
  const console = instance();
  const request = {schema: "selecto.spa.query-request/v1", domainId: "items", view: "detail",
    state: {selected: ["source.id"], orderBy: [], groupBy: [], aggregates: [], rollup: true},
    filters: {conjunction: "and", items: []}, page: {number: 2, size: 30},
    presentation: {timezone: "America/Denver"}, publication: {fingerprint: "fp", publication: "alpha"}};
  console.loadPayloadIntoChooser(request);
  assert.deepEqual(console.buildPayload().query, {
    select: ["id"], filters: [], order_by: [], limit: 30, offset: 30,
    timezone: "America/Denver",
  });
  const before = structuredClone(console.state);
  for (const changed of [{...request, publication: {fingerprint: "fp", publication: "beta"}}, {...request, filters: {conjunction: "or", items: []}}]) {
    assert.throws(() => console.loadPayloadIntoChooser(changed));
    assert.deepEqual(console.state, before);
  }
});

test("current nonempty Explorer fragment retains the shared canonical intent through the chooser", () => {
  const console = instance();
  const request = {schema: "selecto.spa.query-request/v1", domainId: "items", view: "detail",
    state: {selected: ["source.id"], orderBy: [{field: "source.id", direction: "desc"}], groupBy: [], aggregates: []},
    filters: {conjunction: "and", items: [{id: "current", field: "source.id", operator: "equals", value: 2}]},
    page: {number: 3, size: 2}, presentation: {timezone: "UTC"}, publication: {fingerprint: "fp", publication: "alpha"}};
  const hash = `#request=${encodeURIComponent(JSON.stringify(request))}`;
  const {requestPayloadFromLocation} = require("../dist/selecto-api-console.js");
  console.loadPayloadIntoChooser(requestPayloadFromLocation({hash}));
  assert.deepEqual(console.buildPayload().query, globalThis.SelectoExplorerClient.toCanonicalQuery(request, metadata));
  console.state.rowFormat = "objects";
  assert.equal(console.buildPayload().query.row_format, "objects");

  request.filters.items = [{id: "nonnull", field: "source.id", operator: "is_not_null"}];
  console.loadPayloadIntoChooser(request);
  assert.deepEqual(console.buildPayload().query, globalThis.SelectoExplorerClient.toCanonicalQuery(request, metadata));
  assert.equal(console.state.filters[0].op, "not_null", "preserve the existing chooser selector value");
});

test("cancelled late requests cannot replace a newer rendered Console result", async () => {
  const console = instance();
  const nodes = {
    "[data-sac-request]": {value: JSON.stringify({format: "selecto.remote-query", format_version: 1, domain: {fingerprint: "fp"}, query: {select: ["id"], limit: 2}})},
    "[data-sac-run]": {disabled: false, classList: {add() {}, remove() {}}},
    "[data-sac-run-label]": {textContent: "Run query"},
    "[data-sac-cancel-query]": {hidden: true},
  };
  console.root.querySelector = (selector) => nodes[selector];
  console.setStatus = () => {};
  const rendered = [];
  console.renderResponse = (payload) => rendered.push(payload);
  const pending = [];
  console.canonicalClient = {query: (_manifest, _query, options) => new Promise((resolve) => pending.push({resolve, options}))};
  const first = console.run();
  console.cancelQuery();
  assert.equal(pending[0].options.signal.aborted, true);
  const second = console.run();
  pending[1].resolve({ok: true, data: {rows: [[2]]}});
  await second;
  pending[0].resolve({ok: true, data: {rows: [[1]]}});
  await first;
  assert.deepEqual(rendered, [{ok: true, data: {rows: [[2]]}}]);
  assert.equal(nodes["[data-sac-run]"].disabled, false);
  assert.equal(nodes["[data-sac-cancel-query]"].hidden, true);
});

test("Console displays exact large integer and decimal strings without numeric conversion", () => {
  assert.equal(renderValue("9007199254740993"), "9007199254740993");
  assert.equal(renderValue("9007199254740993.123456"), "9007199254740993.123456");
});
