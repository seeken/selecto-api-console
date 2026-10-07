import assert from "node:assert/strict";
import test from "node:test";
import {createCanonicalClient, assertQueryResult, assertScalar, safePath, buildRemoteRequest, CanonicalHttpError, CanonicalWireError} from "../dist/index.js";

const manifest = {format: "selecto.canonical-domain-api", format_version: 1, domain: {fingerprint: "fp"}, profiles: ["remote_query.v1"], routes: [{method: "POST", path: "/api/items/query", operation_id: "queryDomain"}]};
const columns = [
  {id: "id", label: "ID", type: "integer", encoding: "json", nullable: false},
  {id: "amount", label: "Amount", type: "decimal", encoding: "decimal-string", nullable: false},
  {id: "large", label: "Large", type: "integer", encoding: "decimal-string", nullable: false},
  {id: "note", label: "Note", type: "string", encoding: "string", nullable: true},
  {id: "day", label: "Day", type: "date", encoding: "string", nullable: false},
];
function result() { return {ok: true, data: {format: "selecto.remote-query-result", format_version: 1, domain: {fingerprint: "fp"}, columns, rows: [[1, "12.50", "9007199254740993", null, "2026-10-07"]], row_count: 1, row_format: "arrays", page: {limit: 2, offset: 0, has_more: false}}}; }

test("discovers profile and sends exact fingerprint envelope with browser auth and signal", async () => {
  const seen = [];
  const signal = new AbortController().signal;
  const client = createCanonicalClient({baseUrl: "/api/items", headers: {Authorization: "Bearer fixture"}, fetch: async (path, init) => {
    seen.push({path, init});
    return Response.json(path === "/api/items/" ? manifest : result());
  }});
  const discovered = await client.manifest();
  const returned = await client.query(discovered, {select: columns.map((column) => column.id), limit: 2, offset: 0}, {signal, requestId: "case"});
  assert.equal(returned.data.rows[0][1], "12.50");
  assert.deepEqual(JSON.parse(seen[1].init.body), {format: "selecto.remote-query", format_version: 1, domain: {fingerprint: "fp"}, query: {select: columns.map((column) => column.id), limit: 2, offset: 0}, request_id: "case"});
  assert.equal(seen[1].init.signal, signal);
  assert.equal(seen[1].init.credentials, "same-origin");
  assert.equal(seen[1].init.headers.get("authorization"), "Bearer fixture");
});

test("refuses type coercion, shape drift and malformed profile responses", () => {
  const mutate = (fn) => { const value = structuredClone(result()); fn(value); return value; };
  for (const value of [
    mutate((r) => { r.data.rows[0][1] = 12.5; }),
    mutate((r) => { r.data.rows[0][2] = 9007199254740992; }),
    mutate((r) => { r.data.rows[0][4] = "2026-02-30"; }),
    mutate((r) => { r.data.rows[0].pop(); }),
    mutate((r) => { r.data.row_count = 3; }),
    mutate((r) => { r.data.columns[1].id = "id"; }),
    mutate((r) => { r.data.domain.fingerprint = "other"; }),
    mutate((r) => { r.data.format_version = 2; }),
    mutate((r) => { r.data.page.has_more = "false"; }),
  ]) assert.throws(() => assertQueryResult(value, "fp", {limit: 2, offset: 0}), CanonicalWireError);
  const additive = result(); additive.data.future = {optional: true};
  assert.equal(assertQueryResult(additive, "fp").data.future.optional, true);
});

test("object rows require exact keys and exact nullability", () => {
  const value = result(); value.data.row_format = "objects";
  value.data.rows = [Object.fromEntries(columns.map((column, i) => [column.id, value.data.rows[0][i]]))];
  assert.doesNotThrow(() => assertQueryResult(value, "fp", {row_format: "objects"}));
  value.data.rows[0].extra = "ignored?";
  assert.throws(() => assertQueryResult(value, "fp", {row_format: "objects"}), /row keys/);
  assert.throws(() => assertScalar(null, columns[0], "id"), /non-nullable/);
  assert.throws(() => assertScalar("true", {id: "active", type: "boolean", encoding: "json", nullable: false}, "active"), /invalid boolean/);
});

test("preserves native safe error and never retries stale or cancelled requests", async () => {
  let calls = 0;
  const envelope = {ok: false, error: {code: "stale_domain_fingerprint", message: "Publication changed", details: {active: "new"}}, meta: {request_id: "r"}};
  const client = createCanonicalClient({baseUrl: "/api/items", fetch: async () => { calls++; return Response.json(envelope, {status: 409}); }});
  await assert.rejects(client.query(manifest, {select: ["id"]}), (error) => error instanceof CanonicalHttpError && error.status === 409 && error.requestId === "r" && error.details.active === "new");
  assert.equal(calls, 1);
  const abort = new DOMException("Cancelled", "AbortError");
  const aborted = createCanonicalClient({baseUrl: "/api/items", fetch: async () => { throw abort; }});
  await assert.rejects(aborted.query(manifest, {select: ["id"]}), (error) => error === abort);
});

test("rejects unsafe routes and invalid positive paging before fetch", () => {
  for (const path of ["https://evil.test", "//evil.test", "/api/../secret", "/api/%2e%2e/secret", "/api/%2fsecret", "/api/%5csecret", "/api/%00secret", "/api?url=https://evil"]) assert.throws(() => safePath(path));
  assert.equal(safePath("/api/items/"), "/api/items/");
  assert.throws(() => buildRemoteRequest("fp", {select: ["id"], limit: 0}), /integer >= 1/);
  assert.throws(() => buildRemoteRequest("fp", {select: ["id"], tenant: "alpha"}), /unsupported members/);
});
