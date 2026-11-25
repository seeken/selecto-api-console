const assert = require("node:assert/strict");
const test = require("node:test");
const {APIConsole, requestPayloadFromLocation} = require("../dist/selecto-api-console.js");
const client = globalThis.SelectoCanonicalClient;
const explorer = globalThis.SelectoExplorerClient;

function flat(optional = true) {
  const nodes = Object.fromEntries(["request", "pin-domain", "domain-pin-control", "domain-pin-help"].map(name =>
    [`[data-sac-${name}]`, {value: "", matches: selector => selector === `[data-sac-${name}]`} ]));
  const console = new APIConsole({dataset: {apiBase: "/api/orders"}, querySelector: selector => nodes[selector]});
  console.remoteMode = true;
  console.manifest = {format: "selecto.canonical-domain-api", format_version: 1, domain: {fingerprint: "fp"},
    profiles: ["remote_query.v1"], query_capabilities: {optional_domain_pin: optional},
    routes: [{method: "POST", operation_id: "queryDomain", path: "/api/orders/query"}]};
  console.domain = {source: {fields: ["id"], columns: {id: {type: "integer"}}}, query_library: {}};
  console.fields = [{path: "id", type: "integer"}];
  console.fieldMap = new Map(console.fields.map(field => [field.path, field]));
  console.filterFields = console.fields; console.filterFieldMap = console.fieldMap;
  console.state.selectedFields = [{id: "1", field: "id", alias: "", format: ""}];
  console.updateCurl = () => {};
  return {console, nodes};
}
const result = fingerprint => ({ok: true, data: {format: "selecto.remote-query-result", format_version: 1,
  domain: {fingerprint}, columns: [{id: "id", label: "ID", type: "integer", encoding: "json", nullable: false}],
  rows: [[1]], row_count: 1, page: {limit: 100, offset: 0, has_more: false}}});

test("flat requests default unpinned, pin explicitly, and import pins from JSON and deep links", () => {
  const {console, nodes} = flat();
  const unpinned = console.buildPayload(); assert.equal(Object.hasOwn(unpinned, "domain"), false);
  console.renderDomainPin(); assert.equal(nodes["[data-sac-pin-domain]"].checked, false);
  nodes["[data-sac-request]"].value = JSON.stringify(unpinned);
  const checkbox = nodes["[data-sac-pin-domain]"]; checkbox.checked = true;
  console.onChange({target: checkbox});
  const pinned = JSON.parse(nodes["[data-sac-request]"].value);
  assert.deepEqual(pinned.domain, {fingerprint: "fp"});
  console.pinDomains.flat = false;
  console.loadPayloadIntoChooser(requestPayloadFromLocation({hash: `#request=${encodeURIComponent(JSON.stringify(pinned))}`}));
  console.renderDomainPin(); assert.equal(checkbox.checked, true);
  assert.deepEqual(console.buildPayload().domain, pinned.domain);
  console.loadPayloadIntoChooser(unpinned); assert.equal(console.pinsDomain(), false);
});

test("flat client sends the selected pins and accepts fingerprint changes only without a pin", async () => {
  const {console} = flat(); const sent = [];
  const transport = client.createCanonicalClient({baseUrl: "/api/orders", fetch: async (_path, init) => {
    sent.push(JSON.parse(init.body)); return Response.json(result("changed"));
  }});
  await transport.query(console.manifest, {select: ["id"]}, {pinDomain: false});
  assert.equal(Object.hasOwn(sent[0], "domain"), false);
  await assert.rejects(transport.query(console.manifest, {select: ["id"]}), /Domain fingerprint drift/);
  assert.deepEqual(sent[1].domain, {fingerprint: "fp"});
  assert.doesNotThrow(() => client.assertQueryResult(result("changed"), undefined));
});

test("flat older hosts always build and send pins", async () => {
  for (const capability of [undefined, false, "true"]) {
    const {console, nodes} = flat(capability);
    // An omitted argument uses this helper's default; explicitly model the missing flag.
    console.manifest.query_capabilities.optional_domain_pin = capability;
    console.renderDomainPin();
    assert.equal(nodes["[data-sac-pin-domain]"].disabled, true);
    assert.deepEqual(console.buildPayload().domain, {fingerprint: "fp"});
    let sent;
    const transport = client.createCanonicalClient({baseUrl: "/api/orders", fetch: async (_path, init) => {
      sent = JSON.parse(init.body); return Response.json(result("fp"));
    }});
    await transport.query(console.manifest, {select: ["id"]}, {pinDomain: false});
    assert.deepEqual(sent.domain, {fingerprint: "fp"});
  }
});

test("nested default envelopes omit pins, imports retain them, and context refusal remains enforced", async () => {
  const x = (await import("../packages/canonical-client/test/nested-fixture.mjs")).fixture();
  x.features.supports.optional_domain_pin = true;
  assert.doesNotThrow(() => client.assertNestedDetailFeatures(x.features));
  const context = {...x.trusted, features: x.features};
  const {console} = flat(); console.queryProfile = "nested"; console.nestedDetailContext = context;
  console.loadNestedPayload(client.buildNestedDetailRequest("fp", {...x.query, timezone: "UTC"},
    {features: x.features, context: x.context, pinDomain: false}));
  assert.equal(Object.hasOwn(console.buildPayload(), "domain"), false);
  const pinned = client.buildNestedDetailRequest("fp", {...x.query, timezone: "UTC"}, {features: x.features, context: x.context});
  console.loadNestedPayload(pinned); assert.equal(console.pinDomains.nested, true);
  assert.deepEqual(console.buildPayload().domain, {fingerprint: "fp"});
  const changed = structuredClone(x.result); changed.data.domain.fingerprint = "changed";
  assert.doesNotThrow(() => client.assertNestedDetailResult(changed, {...x, pinDomain: false}));
  assert.throws(() => client.assertNestedDetailResult(changed, x), /fingerprint drift/);
  assert.doesNotThrow(() => explorer.toNestedDetailExplorerResult(changed, console.nestedState.intent, context, {pinDomain: false}));
  changed.meta.selecto_nested_detail.publication = "changed";
  assert.throws(() => client.assertNestedDetailResult(changed, {...x, pinDomain: false}), /context drift/);
  x.features.supports.optional_domain_pin = false;
  console.pinDomains.nested = false;
  assert.deepEqual(console.buildPayload().domain, {fingerprint: "fp"});
});
