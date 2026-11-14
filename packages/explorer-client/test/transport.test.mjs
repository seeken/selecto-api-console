import assert from "node:assert/strict";
import test from "node:test";
import {selectHostTransport} from "../dist/index.js";

const catalog = {format: "selecto.domain-catalog", format_version: 1, domains: [{id: "products", label: "Products", manifest: "/api/selecto/canonical/products", explorer_metadata: "/api/selecto/canonical/products/explorer", publication: "p1"}]};
const answer = (status, body, type = "application/json") => async (path, init) => {
  answer.seen = {path, init};
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {status, headers: {"content-type": type}});
};

test("explicit modes never probe the host", async () => {
  const fetch = async () => { throw new Error("no probe expected"); };
  assert.equal(await selectHostTransport({mode: "spa", fetch}), "spa");
  assert.equal(await selectHostTransport({mode: "canonical", fetch}), "canonical");
  await assert.rejects(selectHostTransport({mode: "graphql", fetch}), TypeError);
});

test("auto selects canonical when the host publishes a catalog", async () => {
  const fetch = answer(200, catalog);
  assert.equal(await selectHostTransport({mode: "auto", baseUrl: "/api/selecto/canonical", fetch, headers: () => ({"X-CSRF-Token": "t"})}), "canonical");
  assert.equal(answer.seen.path, "/api/selecto/canonical/catalog");
  assert.equal(new Headers(answer.seen.init.headers).get("x-csrf-token"), "t");
  assert.equal(answer.seen.init.credentials, "same-origin");
});

test("auto falls back to the SPA routes only when the catalog route is absent", async () => {
  assert.equal(await selectHostTransport({catalogPath: "/api/selecto/canonical/catalog", fetch: answer(404, "<h1>Not found</h1>", "text/html")}), "spa");
  assert.equal(await selectHostTransport({catalogPath: "/api/selecto/canonical/catalog", fetch: answer(405, "")}), "spa");
  assert.equal(await selectHostTransport({catalogPath: "/api/selecto/canonical/catalog", fetch: answer(200, "<!doctype html><title>SPA</title>", "text/html")}), "spa");
  assert.equal(await selectHostTransport({catalogPath: "/api/selecto/canonical/catalog", fetch: answer(200, {schema: "selecto.spa.domain-list/v1"})}), "spa");
});

test("auto never downgrades a refusing or broken canonical host", async () => {
  for (const status of [401, 403, 500, 503]) {
    await assert.rejects(selectHostTransport({catalogPath: "/c/catalog", fetch: answer(status, {ok: false})}), (error) => error.status === status && error.code === "transport_selection_failed");
  }
  await assert.rejects(selectHostTransport({catalogPath: "/c/catalog", fetch: answer(200, {format: "selecto.domain-catalog", format_version: 9, domains: []})}));
  await assert.rejects(selectHostTransport({catalogPath: "/c/catalog", fetch: async () => { throw new TypeError("network down"); }}), TypeError);
  await assert.rejects(selectHostTransport({catalogPath: "//evil.example/catalog", fetch: answer(200, catalog)}));
});
