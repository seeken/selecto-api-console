import assert from "node:assert/strict";
import test from "node:test";
import {createCanonicalHostAdapter, detailProfile, StaleResultError, toCanonicalQuery, ExplorerIntentError} from "../dist/index.js";

const fields = [
  {id: "source.id", path: "id", label: "ID", type: "integer", encoding: "json", nullable: false},
  {id: "source.amount", path: "amount", label: "Amount", type: "decimal", encoding: "decimal-string", nullable: false},
  {id: "source.large", path: "large", label: "Large", type: "integer", encoding: "decimal-string", nullable: false},
];
function metadata(publication = "alpha", operators = ["eq", "gt", "is_null", "between"]) {
  return {format: "selecto.explorer-metadata", format_version: 1, domain: {id: "items", fingerprint: "fp", publication}, label: "Items", fields, default_select: ["source.id"], query: {profile: "remote_query.v1", operators, limits: {max_limit: 100, max_offset: 100000, max_filters: 20}, supports: {detail: true, nested: false, recursive_filters: false, aggregates: false}}, services: {}, links: {api_console: "/console"}};
}
const manifest = {format: "selecto.canonical-domain-api", format_version: 1, domain: {fingerprint: "fp"}, profiles: ["remote_query.v1"], routes: [{method: "POST", path: "/api/items/query", operation_id: "queryDomain"}, {method: "GET", path: "/api/items/domain", operation_id: "getDomain"}]};
function result(rows = [[1, "12.50", "9007199254740993"]]) {
  return {ok: true, data: {format: "selecto.remote-query-result", format_version: 1, domain: {fingerprint: "fp"}, columns: fields.map(({path, id, ...field}) => ({...field, id: path, field: path})), rows, row_count: rows.length, row_format: "arrays", page: {limit: 2, offset: 0, has_more: false}}};
}
function request(extra = {}) {
  return {schema: "selecto.spa.query-request/v1", domainId: "items", view: "detail", state: {selected: ["source.id", "source.amount", "source.large"], orderBy: [], groupBy: [], aggregates: [], rollup: true, rowClickAction: "__default_modal__", fieldConfigs: {"source.amount": {format: "number", alias: "Amt"}}, groupConfigs: {}}, filters: {conjunction: "and", items: []}, page: {number: 1, size: 2}, ...extra};
}
function host({publication = () => "alpha", query, operators} = {}) {
  const calls = [];
  const fetch = async (path, init = {}) => {
    calls.push({path, init});
    if (path === "/api/catalog") return Response.json({format: "selecto.domain-catalog", format_version: 1, domains: [{id: "items", label: "Items", manifest: "/api/items", explorer_metadata: "/api/items/explorer", publication: publication()}]});
    if (path === "/api/items") return Response.json(manifest);
    if (path === "/api/items/explorer") return Response.json(metadata(publication(), operators));
    if (path === "/api/items/domain") return Response.json({domain_fingerprint: "fp", source: {fields: ["id", "amount", "large"], columns: {id: {}, amount: {}, large: {}}}});
    if (path === "/api/items/query") return query ? query(init, calls) : Response.json(result());
    throw new Error(`unexpected ${path}`);
  };
  return {calls, fetch};
}
const queries = (calls) => calls.filter((call) => call.path === "/api/items/query");

test("descriptor lists unsupported features and advertised range operators", async () => {
  const {fetch} = host();
  const adapter = createCanonicalHostAdapter({baseUrl: "/api", catalogPath: "/api/catalog", fetch});
  assert.equal(adapter.transport, "canonical");
  assert.deepEqual(adapter.profiles, ["remote_query.v1"]);
  const [descriptor] = await adapter.listDomains();
  assert.deepEqual(descriptor.capabilities, ["detail"]);
  assert.ok(descriptor.fields[0].filterOperators.includes("between"));
  const unsupported = descriptor.metadata.canonical.unsupported.map((item) => item.id);
  for (const id of ["view.aggregate", "view.graph", "view.aggregate_grid", "filters.groups", "operator.in", "operator.contains", "page.total_rows", "service.saved_views", "service.export"]) assert.ok(unsupported.includes(id), id);
  assert.ok(!unsupported.includes("operator.between"));
  assert.deepEqual(adapter.binding("items"), {profile: "remote_query.v1", fingerprint: "fp", publication: "alpha"});
});

test("execute keeps exact values, display-only configs and between end values", async () => {
  const {calls, fetch} = host();
  const adapter = createCanonicalHostAdapter({baseUrl: "/api", catalogPath: "/api/catalog", fetch});
  await adapter.getDomain("items");
  const response = await adapter.execute(request({filters: {conjunction: "and", items: [{id: "f", field: "source.amount", operator: "between", value: "1.00", valueTo: "99999999999999999.99"}]}}));
  assert.deepEqual(response.rows, [{"source.id": 1, "source.amount": "12.50", "source.large": "9007199254740993"}]);
  assert.equal(response.columns[2].encoding, "decimal-string");
  assert.deepEqual(response.metadata.canonical, {fingerprint: "fp", publication: "alpha", hasMore: false});
  const body = JSON.parse(queries(calls)[0].init.body);
  assert.deepEqual(body.query.filters, [{field: "amount", op: "between", value: "1.00", end: "99999999999999999.99"}]);
  assert.equal(body.domain.fingerprint, "fp");
});

test("drift from the loaded publication is refused before execution", async () => {
  let current = "alpha";
  const {calls, fetch} = host({publication: () => current});
  const adapter = createCanonicalHostAdapter({baseUrl: "/api", catalogPath: "/api/catalog", fetch});
  await adapter.getDomain("items");
  current = "beta";
  await assert.rejects(adapter.execute(request()), (error) => error instanceof ExplorerIntentError && error.code === "stale_domain_fingerprint");
  assert.equal(queries(calls).length, 0);
  // An explicit reload rebinds visibly; then execution proceeds.
  assert.equal((await adapter.getDomain("items")).metadata.canonical.publication, "beta");
  await adapter.execute(request());
  assert.equal(queries(calls).length, 1);
});

test("unsupported intent is an explicit refusal, never a dropped member", async () => {
  const {calls, fetch} = host();
  const adapter = createCanonicalHostAdapter({baseUrl: "/api", catalogPath: "/api/catalog", fetch});
  await adapter.getDomain("items");
  for (const value of [request({view: "aggregate"}), request({filters: {conjunction: "or", items: []}}), request({filters: {conjunction: "and", items: [{id: "f", field: "source.id", operator: "in", value: [1]}]}})]) {
    await assert.rejects(adapter.execute(value), ExplorerIntentError);
  }
  const grouped = request(); grouped.state.fieldConfigs = {"source.id": {groupFormat: "month"}};
  await assert.rejects(adapter.execute(grouped), /unsupported members: groupFormat/);
  assert.equal(queries(calls).length, 0);
});

test("a superseded request is aborted and its late result suppressed", async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const signals = [];
  const {fetch} = host({query: async (init, calls) => {
    signals.push(init.signal);
    if (signals.length === 1) {
      await gate; // the first response is only produced after the second request finished
      return Response.json(result([[2, "1.00", "1"]]));
    }
    return Response.json(result());
  }});
  // The first response ignores abort to model a host that already wrote its response.
  const adapter = createCanonicalHostAdapter({baseUrl: "/api", catalogPath: "/api/catalog", fetch, supersede: "domain"});
  await adapter.getDomain("items");
  const first = adapter.execute(request());
  while (signals.length < 1) await new Promise((resolve) => setTimeout(resolve, 1));
  const second = await adapter.execute(request());
  assert.equal(second.rows[0]["source.id"], 1);
  assert.equal(signals[0].aborted, true);
  assert.ok(signals[0].reason instanceof StaleResultError);
  release();
  await assert.rejects(first, (error) => error instanceof StaleResultError && error.name === "AbortError" && error.code === "stale_result");
});

test("caller cancellation reaches the HTTP request", async () => {
  const controller = new AbortController();
  const {fetch} = host({query: (init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason)))});
  const adapter = createCanonicalHostAdapter({baseUrl: "/api", catalogPath: "/api/catalog", fetch});
  await adapter.getDomain("items");
  const pending = adapter.execute(request(), {signal: controller.signal});
  await new Promise((resolve) => setTimeout(resolve, 5));
  controller.abort();
  await assert.rejects(pending, (error) => error.name === "AbortError");
});

test("a later profile strategy is chosen ahead of Detail when the host advertises it", async () => {
  const {fetch} = host();
  const seen = [];
  const explorerProfile = {...detailProfile, id: "remote_query.explorer.v1",
    accepts: ({manifest}) => { seen.push(manifest.profiles); return manifest.profiles.includes("remote_query.explorer.v1"); }};
  const adapter = createCanonicalHostAdapter({baseUrl: "/api", catalogPath: "/api/catalog", fetch, profiles: [explorerProfile, detailProfile]});
  assert.deepEqual(adapter.profiles, ["remote_query.explorer.v1", "remote_query.v1"]);
  await adapter.getDomain("items");
  assert.equal(seen.length, 1);
  assert.equal(adapter.binding("items").profile, "remote_query.v1");
  assert.equal(toCanonicalQuery(request(), metadata()).select.length, 3);
});
