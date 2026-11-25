const assert = require("node:assert/strict");
const test = require("node:test");
const {APIConsole} = require("../dist/selecto-api-console.js");

// Only the selectors and element operations used by the Console are needed here.
class Node {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
    this.value = ""; this.hidden = false; this.disabled = false; this.readOnly = false;
    this.className = ""; this.text = "";
    this.classList = {add() {}, remove() {}, toggle() {}};
  }
  append(...nodes) { for (const node of nodes) { node.parentElement = this; this.children.push(node); } }
  add(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = []; this.text = ""; this.append(...nodes); }
  set textContent(text) { this.replaceChildren(); this.text = String(text); }
  get textContent() { return this.text + this.children.map(node => node.textContent).join(""); }
  setAttribute(key, value) {
    if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    else if (key === "class") this.className = value;
    else this[key] = value;
  }
  setCustomValidity() {}
  addEventListener() {}
  matches(selector) {
    if (/^[a-z][a-z0-9]*$/.test(selector)) return this.tagName.toLowerCase() === selector;
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    const match = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!match) return false;
    const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return Object.hasOwn(this.dataset, key) && (match[2] === undefined || this.dataset[key] === match[2]);
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  set innerHTML(html) {
    this.html = html; this.replaceChildren(); const stack = [this];
    for (const token of html.matchAll(/<\/(\w+)>|<(\w+)([^>]*)>|([^<]+)/g)) {
      if (token[1]) { stack.pop(); continue; }
      if (token[4]) { const text = new Node("text"); text.textContent = token[4]; stack.at(-1).append(text); continue; }
      const node = new Node(token[2]);
      for (const attr of token[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1], attr[2] ?? true);
      stack.at(-1).append(node);
      if (!["input", "br", "hr", "img"].includes(token[2])) stack.push(node);
    }
  }
}

const features = () => ({format: "selecto.explorer-features", format_version: 1, profile: "remote_query.explorer.v1",
  domain: {id: "orders", fingerprint: "fp"}, revision: "rev",
  fields: [{id: "status", path: "status", label: "Status", type: "string", groupable: true, aggregates: ["count"]}],
  limits: {max_limit: 50}, supports: {aggregate: true, rollup: true}});
const aggregateRoutes = [
  {operation_id: "getExplorerFeatures", method: "GET", path: "/api/orders/group-features"},
  {operation_id: "queryExplorer", method: "POST", path: "/api/orders/group-query"},
];
const result = () => ({ok: true, data: {domain: {fingerprint: "fp"}, features: {revision: "rev"}, columns: [{id: "status", role: "group"}, {id: "count", role: "aggregate"}],
  rows: [["open", 2], [null, 2]], row_meta: [{kind: "detail", level: 1}, {kind: "total", level: 0}]}});

async function withDOM(fn) {
  const before = {document: global.document, Option: global.Option, window: global.window, location: global.location, fetch: global.fetch};
  global.document = {createElement: tag => new Node(tag)};
  global.Option = class extends Node { constructor(label, value) { super("option"); this.textContent = label; this.value = value; } };
  global.location = {hash: "", search: "", origin: "https://example.test"};
  global.window = {location: global.location};
  try { await fn(); } finally { Object.assign(global, before); }
}

async function instance({routes = aggregateRoutes, remote = false, resource = true, featureResponse = features()} = {}) {
  const root = new Node(); root.dataset.apiBase = "/api/orders";
  const console = new APIConsole(root);
  // These independent form renderers are covered by the existing chooser tests.
  for (const method of ["seedMutationState", "renderWritePanel", "renderActionPanel", "renderDateFormats",
    "renderSegments", "renderSegmentGroups", "renderSelectedFields", "renderNormalization", "renderFieldList",
    "renderViewHelp", "renderParameters", "renderFilters", "renderFilterFieldList", "renderOrders"]) console[method] = () => {};
  const manifest = {format: "selecto.canonical-domain-api", format_version: 1, domain: {fingerprint: "fp"},
    profiles: remote ? ["remote_query.v1"] : [], routes: [
      {operation_id: "queryDomain", method: "POST", path: "/api/orders/detail-query"},
      ...(resource ? [{operation_id: "getResource", method: "GET", path: "/api/orders/{id}"}] : []), ...routes]};
  const domain = {name: "Orders", domain_fingerprint: "fp", source: {primary_key: "id", fields: ["id", "status"],
    columns: {id: {type: "integer"}, status: {type: "string"}}}};
  const calls = [];
  global.fetch = async (path, init = {}) => {
    calls.push({path, init});
    if (init.method === "POST") return Response.json(result());
    if (path === "/api/orders/") return Response.json(manifest);
    if (path === "/api/orders/domain") return Response.json(domain);
    if (path === "/api/orders/openapi.json") return Response.json({paths: {}});
    if (path === "/api/orders/group-features") {
      if (featureResponse instanceof Error) throw featureResponse;
      if (featureResponse instanceof Response) return featureResponse;
      return Response.json(featureResponse);
    }
    throw new Error(`Unexpected path ${path}`);
  };
  console.renderFatal = error => { throw error; };
  await console.start();
  const node = name => root.querySelector(`[data-sac-${name}]`);
  const choose = value => { node("root-mode").value = value; return console.onInput({target: node("root-mode")}); };
  return {console, root, node, choose, calls};
}

test("non-remote aggregate publication offers Detail and sends a grouped rollup to its advertised route", () => withDOM(async () => {
  const x = await instance();
  assert.equal(x.console.remoteMode, false);
  assert.deepEqual(x.node("root-mode").children.map(option => [option.value, option.textContent]),
    [["flat", "Detail"], ["aggregate", "Aggregates (explorer v1)"]]);
  assert.equal(x.node("root-state"), null); assert.equal(x.node("nested-state-controls"), null);
  await x.choose("aggregate");
  assert.equal(x.node("aggregate-data").hidden, false);
  assert.equal(x.node("aggregate-builder"), null);
  assert.match(x.node("aggregate-data").textContent, /Group by/);
  assert.equal(x.root.querySelector(".sac-builder").hidden, false);
  x.console.aggregateControl({dataset: {sacAggregateControl: "add-group"}, value: "status"});
  x.console.aggregateControl({dataset: {sacAggregateControl: "grouping"}, value: "rollup"});
  const request = JSON.parse(x.node("request").value);
  assert.deepEqual(request, {format: "selecto.explorer-query", format_version: 1, domain: {fingerprint: "fp"}, features: {revision: "rev"},
    query: {select: ["status", {aggregate: "count", alias: "count"}], group_by: ["status"], rollup: true, limit: 50}});
  assert.equal(x.node("query-path").textContent, "/api/orders/group-query");
  assert.match(x.node("curl").textContent, /curl -X POST 'https:\/\/example.test\/api\/orders\/group-query'/);
  assert.match(x.node("curl").textContent, /selecto.explorer-query/);
  let copied;
  x.console.copy = text => { copied = text; };
  x.console.onClick({target: x.node("copy-request")}); assert.equal(copied, x.node("request").value);
  await x.console.run();
  const posts = x.calls.filter(call => call.init.method === "POST");
  assert.equal(posts.length, 1); assert.equal(posts[0].path, "/api/orders/group-query");
  assert.deepEqual(JSON.parse(posts[0].init.body), request);
  assert.equal(posts[0].init.credentials, "same-origin");
  assert.equal(x.node("result-body").children.length, 2);
  assert.equal(x.node("result-body").children[1].children[0].textContent, "Total");
  x.node("request").value = JSON.stringify(request);
  assert.equal(x.console.loadRequestIntoChooser(), true);
  assert.equal(x.console.aggregateState.grouping, "rollup");
}));

test("ordinary manifests without both aggregate routes show no profile control", () => withDOM(async () => {
  for (const routes of [[], aggregateRoutes.slice(0, 1), aggregateRoutes.slice(1)]) {
    const x = await instance({routes});
    assert.equal(x.node("root-mode"), null);
    assert.equal(x.calls.some(call => call.path.endsWith("group-features")), false);
  }
}));

test("remote manifests retain their labels, gated options and state controls", () => withDOM(async () => {
  for (const routes of [[], aggregateRoutes]) {
    const x = await instance({remote: true, routes});
    const options = x.node("root-mode").children;
    assert.deepEqual(options.map(option => option.textContent), ["Flat Detail (v1)", "Recursive root predicates (v2)", "Complete nested Detail (v1)", "Aggregates (explorer v1)"]);
    assert.equal(Boolean(options[1].disabled), true); assert.equal(Boolean(options[2].disabled), true);
    assert.equal(Boolean(options[3].disabled), routes.length === 0);
    assert.ok(x.node("root-state")); assert.ok(x.node("nested-state-controls"));
  }
}));

test("failed and invalid feature discovery keep a disabled option and a safe adjacent reason", () => withDOM(async () => {
  for (const featureResponse of [new Error("private response <script>"),
    Response.json({ok: false, error: {code: "unavailable", message: "private response <script>", details: {}}}, {status: 403}),
    new Response("private response <script>", {status: 502}), null, {...features(), format_version: 2},
    {...features(), fields: [null]}, {...features(), fields: [{id: "status", path: "status", aggregates: {}}]}]) {
    const x = await instance({featureResponse});
    assert.equal(Boolean(x.node("root-mode").children[1].disabled), true);
    assert.equal(x.node("aggregate-availability").hidden, false);
    assert.equal(x.node("aggregate-availability").textContent, featureResponse instanceof Error || featureResponse instanceof Response
      ? "Aggregates unavailable: features could not be fetched." : "Aggregates unavailable: invalid or unsupported features.");
    assert.doesNotMatch(x.root.textContent, /private response|<script>/);
  }
}));

test("non-remote switches abort pending queries, clear results and retain builder and raw drafts", () => withDOM(async () => {
  const x = await instance();
  x.console.state.limit = 17; x.console.syncRequest(true);
  const detail = x.node("request").value;
  let release, signal;
  global.fetch = (_path, init) => { signal = init.signal; return new Promise(resolve => { release = resolve; }); };
  const running = x.console.run();
  x.console.renderResponse(result()); x.console.state.response = result();
  await x.choose("aggregate");
  assert.equal(signal.aborted, true); assert.equal(x.console.state.response, null);
  assert.equal(x.node("response-json").textContent, ""); assert.equal(x.node("result-body").children.length, 0);
  assert.equal(x.node("empty-response").hidden, false);
  release(Response.json(result())); await running;
  assert.equal(x.console.state.response, null); assert.equal(x.node("result-body").children.length, 0);
  x.console.aggregateControl({dataset: {sacAggregateControl: "add-group"}, value: "status"});
  const aggregate = x.node("request").value;
  await x.choose("flat"); assert.equal(x.node("request").value, detail); assert.equal(x.console.state.limit, 17);
  await x.choose("aggregate"); assert.equal(x.node("request").value, aggregate);
  assert.deepEqual(x.console.aggregateState.groupBy, ["status"]);
  const raw = aggregate + "\n "; x.node("request").value = raw; x.console.state.rawDirty = true;
  const pending = x.console.run();
  await x.choose("flat"); assert.equal(signal.aborted, true);
  release(Response.json(result())); await pending; assert.equal(x.console.state.response, null);
  const detailRaw = detail + "\n "; x.node("request").value = detailRaw; x.console.state.rawDirty = true;
  await x.choose("aggregate"); assert.equal(x.node("request").value, raw); assert.equal(x.console.state.rawDirty, true);
  await x.choose("flat"); assert.equal(x.node("request").value, detailRaw); assert.equal(x.console.state.rawDirty, true);
}));

test("retained resource GET drafts do not change aggregate transport, editor or result interpretation", () => withDOM(async () => {
  const x = await instance();
  x.console.state.resourceId = "7"; x.console.setQueryMethod("get"); x.console.renderAll();
  const resource = x.node("request").value;
  let release, signal;
  global.fetch = (_path, init) => { signal = init.signal; return new Promise(resolve => { release = resolve; }); };
  const pending = x.console.run(); await x.choose("aggregate");
  assert.equal(signal.aborted, true);
  assert.equal(x.node("query-method-badge").textContent, "POST");
  assert.equal(x.node("query-path").textContent, "/api/orders/group-query"); assert.equal(x.node("request").readOnly, false);
  release(Response.json({ok: true, data: {id: 7}})); await pending;
  assert.equal(x.console.state.response, null); assert.equal(x.node("run-label").textContent, "Run query");
  let post;
  global.fetch = async (path, init) => { post = {path, init}; return Response.json(result()); };
  await x.console.run(); assert.equal(post.path, "/api/orders/group-query"); assert.equal(post.init.method, "POST");
  assert.equal(x.node("result-body").children.length, 2);
  assert.equal(x.node("result-body").children[0].children[0].textContent, "open");
  await x.choose("flat"); assert.equal(x.node("request").value, resource); assert.equal(x.node("request").readOnly, true);
  await x.choose("aggregate"); assert.equal(x.node("request").readOnly, false);
}));


test("Request groups capability-gated choices and numbers only visible builder steps", () => withDOM(async () => {
  for (const remote of [false, true]) {
    for (const advertised of [false, true]) {
      for (const resource of [false, true]) {
        const x = await instance({remote, resource, routes: advertised ? aggregateRoutes : []});
        const request = x.node("request-section");
        const profile = x.node("root-mode");
        assert.equal(request.hidden, !remote && !advertised && !resource);
        assert.equal(x.node("query-method-group").hidden, !resource);
        assert.equal(Boolean(profile), remote || advertised);
        assert.equal(x.node("query-method-group").closest(".sac-card"), request);
        if (profile) assert.equal(profile.closest(".sac-card"), request);
        const visible = x.root.querySelectorAll("[data-sac-query-step]").filter(card => !card.hidden);
        assert.deepEqual(visible.map(card => card.querySelector(".sac-step").textContent),
          visible.map((_, index) => String(index + 1)));
        assert.equal(visible[0].querySelector("h2").textContent, request.hidden ? "Choose data" : "Request");
        if (remote) {
          for (const name of ["root-availability", "nested-availability", "aggregate-availability"]) {
            assert.equal(x.node(name).closest(".sac-card"), request);
          }
          assert.equal(x.node("root-state").closest(".sac-request-card") !== null, true);
          assert.equal(x.node("nested-state-controls").closest(".sac-request-card") !== null, true);
        }
      }
    }
  }
}));

test("Request remains reachable across profiles and GET hides only POST builder steps", () => withDOM(async () => {
  const x = await instance({remote: true});
  const steps = () => x.root.querySelectorAll("[data-sac-query-step]").filter(card => !card.hidden);
  const numbers = () => steps().map(card => card.querySelector(".sac-step").textContent);
  x.console.setQueryMethod("get"); x.console.renderAll();
  assert.deepEqual(numbers(), ["1", "2"]);
  assert.equal(x.node("resource-id-wrap").hidden, false);
  await x.choose("aggregate");
  assert.equal(x.node("query-method-group").hidden, true);
  assert.deepEqual(numbers(), ["1", "2", "3", "4"]);
  assert.equal(x.node("data-heading").textContent, "Group & measure");
  for (const profile of ["root", "nested"]) {
    x.console.renderNestedBuilder = () => {};
    x.console.queryProfile = profile; x.console.applyQueryProfile();
    assert.equal(x.root.querySelector(".sac-builder").hidden, false);
    assert.equal(x.node("request-section").hidden, false);
    assert.equal(x.node("query-method-group").hidden, true);
    assert.deepEqual(numbers(), ["1"]);
  }
  await x.choose("flat");
  assert.equal(x.node("query-method-group").hidden, false);
  assert.equal(x.node("root-mode").value, "flat");
  assert.equal(x.node("resource-id-wrap").hidden, false);
  assert.deepEqual(numbers(), ["1", "2"]);
  x.console.setQueryMethod("post"); x.console.renderAll();
  assert.deepEqual(numbers(), ["1", "2", "3", "4"]);
}));

test("optional aggregate pins default off, survive drafts and links, and check only pinned responses", () => withDOM(async () => {
  const document = features(); document.supports.optional_domain_pin = true;
  const x = await instance({featureResponse: document});
  await x.choose("aggregate");
  const pin = x.node("pin-domain");
  assert.equal(pin.disabled, false); assert.equal(pin.checked, false);
  const unpinned = JSON.parse(x.node("request").value);
  assert.equal(Object.hasOwn(unpinned, "domain"), false);
  assert.equal(Object.hasOwn(unpinned, "features"), false);
  global.fetch = async () => Response.json({...result(), data: {...result().data, domain: {fingerprint: "changed"}, features: {revision: "changed"}}});
  await x.console.run();
  assert.equal(x.console.state.response.ok, true);
  assert.equal(x.node("response-fingerprint").textContent, "Domain fingerprint: changed");
  pin.checked = true; x.console.onChange({target: pin});
  const pinned = JSON.parse(x.node("request").value);
  assert.deepEqual(pinned.domain, {fingerprint: "fp"}); assert.deepEqual(pinned.features, {revision: "rev"});
  assert.match(x.node("curl").textContent, /fingerprint/);
  await x.console.run(); assert.match(x.console.state.response.error.message, /Domain fingerprint drift/);
  await x.choose("flat"); await x.choose("aggregate");
  assert.equal(pin.checked, true); assert.deepEqual(JSON.parse(x.node("request").value), pinned);
  let link; x.console.copy = async value => {link = value;};
  global.location.href = "https://example.test/console";
  await x.console.copyRequestLink({});
  const restored = JSON.parse(new URLSearchParams(new URL(link).hash.slice(1)).get("request"));
  x.console.pinDomains.aggregate = false; x.console.loadPayloadIntoChooser(restored); x.console.renderDomainPin();
  assert.equal(pin.checked, true);
  x.console.loadPayloadIntoChooser(unpinned); x.console.renderDomainPin(); assert.equal(pin.checked, false);
}));

test("older aggregate hosts force pins and explain the disabled checkbox", () => withDOM(async () => {
  for (const capability of [undefined, false, "true"]) {
    const document = features(); document.supports.optional_domain_pin = capability;
    const x = await instance({featureResponse: document}); await x.choose("aggregate");
    assert.equal(x.node("pin-domain").disabled, true); assert.equal(x.node("pin-domain").checked, true);
    assert.match(x.node("domain-pin-help").textContent, /always include pins/);
    assert.deepEqual(JSON.parse(x.node("request").value).domain, {fingerprint: "fp"});
  }
}));
