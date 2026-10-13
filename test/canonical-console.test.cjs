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

test("canonical flat paging reruns the bound chooser while root and manual requests stay intact", () => {
  const console = instance();
  const result = {ok: true, data: {format: "selecto.remote-query-result", format_version: 1,
    rows: [[1], [3]], row_count: 2, page: {limit: 2, offset: 0, has_more: true}}};
  console.page = console.pageInfo(result);
  assert.deepEqual(console.page, {offset: 0, limit: 2, returned: 2, hasMore: true, text: "Rows 1–2; more rows follow"});
  const sent = [];
  console.changed = () => {};
  console.run = () => sent.push(console.buildPayload());
  console.goToPage("next");
  assert.equal(sent[0].query.offset, 2);
  assert.equal(sent[0].query.limit, 2);
  assert.equal(sent[0].domain.fingerprint, "fp");
  assert.deepEqual(sent[0].query.select, ["id"]);
  console.page = console.pageInfo({...result, data: {...result.data, page: {...result.data.page, offset: 2}}});
  console.goToPage("previous");
  assert.equal(sent[1].query.offset, 0);
  for (const patch of [{state: {rawDirty: true}}, {rootMode: true}, {queryProfile: "root"}, {queryProfile: "nested"}]) {
    console.state.rawDirty = false; console.rootMode = false; console.queryProfile = "flat";
    if (patch.state) Object.assign(console.state, patch.state); else Object.assign(console, patch);
    const before = structuredClone(console.state);
    assert.equal(console.pageInfo(result), null);
    console.goToPage("next");
    assert.deepEqual(console.state, before);
    assert.equal(sent.length, 2, "paging cannot rewrite a manual or complete root/nested request");
  }
  console.state.rawDirty = false; console.rootMode = false; console.queryProfile = "flat";
  for (const mutate of [data => data.page.has_more = "true", data => data.row_count = "2",
    data => data.row_count = 1, data => data.page.limit = 0, data => data.page.offset = -1]) {
    const changed = structuredClone(result); mutate(changed.data);
    assert.equal(console.pageInfo(changed), null, "invalid canonical pagination never falls back to chooser state");
  }
});
