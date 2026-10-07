import assert from "node:assert/strict";
import test from "node:test";
import {createExplorerClient, toCanonicalQuery, toExplorerDescriptor, toExplorerResult, ExplorerIntentError} from "../dist/index.js";

const metadata = {format: "selecto.explorer-metadata", format_version: 1, domain: {id: "items", fingerprint: "fp", publication: "alpha-publication"}, label: "Items", fields: [
  {id: "source.id", path: "id", label: "ID", type: "integer", encoding: "json", nullable: false},
  {id: "source.amount", path: "amount", label: "Amount", type: "decimal", encoding: "decimal-string", nullable: false},
], default_select: ["source.id", "source.amount"], query: {profile: "remote_query.v1", operators: ["eq", "gt", "is_null"], limits: {max_limit: 100, max_offset: 100000, max_filters: 20}, supports: {detail: true, nested: false, recursive_filters: false, aggregates: false}}, services: {}};
function request() { return {schema: "selecto.spa.query-request/v1", domainId: "items", view: "detail", state: {selected: ["source.id", "source.amount"], orderBy: [{field: "source.id", direction: "desc"}], groupBy: [], aggregates: [], preventDenormalization: true, rollup: true, rowClickAction: "__default_modal__", fieldConfigs: {}, groupConfigs: {}}, filters: {conjunction: "and", items: [{id: "f1", field: "source.amount", operator: "greater_than", value: "12.50"}]}, page: {number: 2, size: 2}, presentation: {locale: "en", timezone: "America/Denver"}, publication: {fingerprint: "fp", publication: "alpha-publication"}}; }
const manifest = {format: "selecto.canonical-domain-api", format_version: 1, domain: {fingerprint: "fp"}, profiles: ["remote_query.v1"], routes: [{method: "POST", path: "/api/items/query", operation_id: "queryDomain"}, {method: "GET", path: "/api/items/domain", operation_id: "getDomain"}]};

test("Detail translation preserves mapped fields, decimal precision, timezone and paging", () => {
  assert.deepEqual(toCanonicalQuery(request(), metadata), {select: ["id", "amount"], filters: [{field: "amount", op: "gt", value: "12.50"}], order_by: [{field: "id", direction: "desc"}], limit: 2, offset: 2, timezone: "America/Denver"});
  const descriptor = toExplorerDescriptor(metadata);
  assert.equal(descriptor.fields[1].encoding, "decimal-string");
  assert.equal(descriptor.release.fingerprint, "fp");
  assert.equal(descriptor.metadata.canonical.publication, "alpha-publication");
  assert.deepEqual(descriptor.capabilities, ["detail"]);
});

test("unsupported active semantics and stale publication are explicit refusals", () => {
  for (const modify of [
    (r) => { r.view = "aggregate"; }, (r) => { r.filters.conjunction = "or"; },
    (r) => { r.filters.items = [{conjunction: "and", items: []}]; },
    (r) => { r.state.groupBy = ["source.id"]; },
    (r) => { r.state.fieldConfigs = {"source.amount": {format: "currency"}}; },
    (r) => { r.state.selected = ["source.secret"]; },
    (r) => { r.filters.items[0].operator = "between"; r.filters.items[0].valueTo = "20"; },
    (r) => { r.page.size = 101; }, (r) => { r.publication.fingerprint = "old"; },
    (r) => { r.publication.publication = "beta-publication"; },
  ]) { const value = request(); modify(value); assert.throws(() => toCanonicalQuery(value, metadata), ExplorerIntentError); }
});

test("mapped result retains exact values and exposes has-more without invented totals", () => {
  const result = {ok: true, data: {format: "selecto.remote-query-result", format_version: 1, domain: {fingerprint: "fp"}, columns: metadata.fields.map(({path, ...field}) => ({...field, id: path, field: path})), rows: [[3, "12.50"]], row_format: "arrays", row_count: 1, page: {limit: 2, offset: 2, has_more: false}}};
  const translated = toExplorerResult(result, request(), metadata);
  assert.deepEqual(translated.rows, [{"source.id": 3, "source.amount": "12.50"}]);
  assert.deepEqual(translated.page, {number: 2, size: 2});
  assert.equal(translated.metadata.canonical.hasMore, false);
  assert.equal(translated.page.totalRows, undefined);
});

test("query refreshes request-scoped publication and rejects tenant switch before execution", async () => {
  let beta = false; let queries = 0;
  const client = createExplorerClient({baseUrl: "/api", fetch: async (path) => {
    if (path === "/api/catalog") return Response.json({format: "selecto.domain-catalog", format_version: 1, domains: [{id: "items", label: "Items", manifest: "/api/items", explorer_metadata: "/api/items/explorer", publication: beta ? "beta-publication" : "alpha-publication"}]});
    if (path === "/api/items") return Response.json(manifest);
    if (path === "/api/items/explorer") return Response.json({...metadata, domain: {...metadata.domain, publication: beta ? "beta-publication" : "alpha-publication"}});
    if (path === "/api/items/domain") return Response.json({domain_fingerprint: "fp", source: {fields: ["id", "amount"], columns: {id: {}, amount: {}}}});
    queries++; throw new Error("query should not run");
  }});
  assert.equal((await client.getDomain("items")).metadata.canonical.publication, "alpha-publication");
  beta = true;
  await assert.rejects(client.execute(request()), (error) => error.code === "stale_domain_fingerprint");
  assert.equal(queries, 0);
});
