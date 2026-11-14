import assert from "node:assert/strict";
import test from "node:test";
import {createCanonicalHostAdapter, parseBucketRanges, planExplorerV1Query, toExplorerV1Descriptor, ExplorerIntentError} from "../dist/index.js";

// A synthetic explorer.v1 host (independently authored; shapes follow
// docs/remote_query_explorer.md sections 2-4).
const base = {nullable: true, description: null, selectable: true, sortable: true, filterable: true, groupable: true, collection: null, group_formats: [], buckets: [], date_shortcuts: []};
const numeric = ["eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "not_in", "is_null", "not_null"];
const fields = [
  {...base, id: "active", path: "active", label: "active", type: "boolean", encoding: "json", operators: ["eq", "ne", "is_null", "not_null"], aggregates: ["count", "count_distinct", "true_count", "false_count", "true_percentage"]},
  {...base, id: "amount", path: "amount", label: "amount", type: "decimal", encoding: "decimal-string", operators: numeric, aggregates: ["count", "count_distinct", "sum", "avg", "min", "max"], buckets: ["numeric"]},
  {...base, id: "due_on", path: "due_on", label: "due_on", type: "date", encoding: "string", operators: [...numeric, "date_shortcut"], aggregates: ["count", "count_distinct", "min", "max"], group_formats: ["day", "day_hour", "week", "month", "quarter", "year", "month_of_year", "day_of_month", "day_of_week", "hour"], buckets: ["year", "elapsed_days", "relative_days"], date_shortcuts: ["today", "this_year"]},
  {...base, id: "id", path: "id", label: "id", type: "integer", encoding: "json", nullable: false, operators: numeric, aggregates: ["count", "count_distinct", "sum", "avg", "min", "max"], buckets: ["numeric"]},
  {...base, id: "name", path: "name", label: "name", type: "string", encoding: "string", operators: [...numeric, "starts_with", "starts_with_ci", "text_contains", "text_contains_ci", "ends_with", "ends_with_ci"], aggregates: ["count", "count_distinct", "min", "max"]},
];
const supports = {detail: true, aggregate: true, graph: true, rollup: true, grid: true, nested: true, recursive_filters: true, group_formats: true, buckets: true, boolean_aggregates: true, count_exact: true, text_ops: true, date_shortcuts: true, timezones: "iana", export: ["csv", "json"]};
const limits = {max_limit: 100, max_offset: 1000, max_select: 12, max_filters: 8, max_filter_depth: 3, max_filter_values: 6, max_orders: 4, max_group_by: 3, max_aggregates: 4, max_groups: 50, max_result_cells: 200, max_buckets: 6, max_export_rows: 100, max_count_rows: 100};
function features({revision = "sha256:r1", publication = "alpha", overrides = {}} = {}) {
  return {format: "selecto.explorer-features", format_version: 1, profile: "remote_query.explorer.v1", revision,
    domain: {id: "items", fingerprint: "fp", publication}, label: "Items", fields, collections: [],
    default: {select: ["id", "name"], order_by: [], group_by: [], aggregates: [], rollup: true}, query_library: {segments: []},
    limits, supports: {...supports, ...overrides}, services: {}, links: {}};
}
const manifest = (explorer = true) => ({format: "selecto.canonical-domain-api", format_version: 1, domain: {fingerprint: "fp"}, profiles: explorer ? ["remote_query.v1", "remote_query.explorer.v1"] : ["remote_query.v1"],
  routes: [{method: "POST", path: "/api/items/query", operation_id: "queryDomain"}, {method: "GET", path: "/api/items/domain", operation_id: "getDomain"},
    ...(explorer ? [{method: "GET", path: "/api/items/explorer-features", operation_id: "getExplorerFeatures"}, {method: "POST", path: "/api/items/explorer-query", operation_id: "queryExplorer"}] : [])]});
const metadata = {format: "selecto.explorer-metadata", format_version: 1, domain: {id: "items", fingerprint: "fp", publication: "alpha"}, label: "Items",
  fields: [{id: "id", path: "id", label: "id", type: "integer", encoding: "json", nullable: false}], default_select: ["id"],
  query: {profile: "remote_query.v1", operators: ["eq"], limits: {max_limit: 100, max_offset: 1000, max_filters: 8}, supports: {detail: true, nested: false, recursive_filters: false, aggregates: false}}, services: {}};
function result(query, columns, rows, extra = {}) {
  return {ok: true, data: {format: "selecto.explorer-query-result", format_version: 1, domain: {fingerprint: "fp"}, features: {revision: "sha256:r1"}, columns, rows, row_count: rows.length, row_format: "arrays", subtables: {}, page: {limit: query.limit ?? 30, offset: query.offset ?? 0, has_more: false}, ...extra}, meta: {}};
}
function host({explorer = true, answer, doc = () => features(), exported} = {}) {
  const calls = [];
  const fetch = async (path, init = {}) => {
    calls.push({path, init});
    if (path === "/api/catalog") return Response.json({format: "selecto.domain-catalog", format_version: 1, domains: [{id: "items", label: "Items", manifest: "/api/items", explorer_metadata: "/api/items/explorer", publication: doc().domain.publication}]});
    if (path === "/api/items") return Response.json(manifest(explorer));
    if (path === "/api/items/explorer") return Response.json(metadata);
    if (path === "/api/items/explorer-features") return Response.json(doc());
    if (path === "/api/items/domain") return Response.json({domain_fingerprint: "fp", source: {fields: ["id"], columns: {id: {}}}});
    if (path === "/api/items/explorer-query") {
      const body = JSON.parse(init.body);
      if (exported && new Headers(init.headers).get("accept") !== "application/json") return exported(body, init);
      return answer(body, init);
    }
    throw new Error(`unexpected ${path}`);
  };
  return {calls, fetch};
}
const adapterFor = (fetch) => createCanonicalHostAdapter({baseUrl: "/api", catalogPath: "/api/catalog", fetch});
function spa(view, state, filters = {conjunction: "and", items: []}, page = {number: 1, size: 30}) {
  return {schema: "selecto.spa.query-request/v1", domainId: "items", view, state: {selected: ["id"], orderBy: [], groupBy: [], aggregates: [], ...state}, filters, page};
}
const col = (id, type, role, extra = {}) => ({id, label: id, type, encoding: type === "decimal" ? "decimal-string" : type === "string" ? "string" : "json", nullable: true, role, ...extra});

test("explorer.v1 descriptor advertises views, grid, export and field capabilities from supports", async () => {
  const {fetch} = host({answer: () => {throw new Error("no query");}});
  const adapter = adapterFor(fetch);
  const descriptor = await adapter.getDomain("items");
  assert.deepEqual(descriptor.views.map((view) => view.id), ["detail", "aggregate", "graph"]);
  assert.deepEqual(descriptor.capabilities, ["detail", "aggregate", "graph", "aggregate_grid", "export"]);
  for (const feature of ["not_in", "true_percentage", "grid_export", "grid_colorize", "column_occurrences"]) assert.ok(descriptor.protocolFeatures.includes(feature), feature);
  const amount = descriptor.fields.find((field) => field.id === "amount");
  assert.deepEqual(amount.aggregateFunctions, ["count", "count_distinct", "sum", "avg", "min", "max", "buckets"]);
  assert.equal(amount.encoding, "decimal-string");
  assert.ok(descriptor.fields.find((field) => field.id === "name").filterOperators.includes("contains"));
  assert.ok(descriptor.fields.find((field) => field.id === "due_on").aggregateFunctions.includes("age_buckets"));
  assert.deepEqual(adapter.binding("items"), {profile: "remote_query.explorer.v1", fingerprint: "fp", publication: "alpha", revision: "sha256:r1"});
  const unsupported = descriptor.metadata.canonical.unsupported.map((item) => item.id);
  assert.ok(!unsupported.includes("view.aggregate"));
  assert.ok(unsupported.includes("service.saved_views"));
});

test("a host without explorer.v1 stays Detail-only with the unsupported list", async () => {
  const {fetch, calls} = host({explorer: false});
  const adapter = adapterFor(fetch);
  const descriptor = await adapter.getDomain("items");
  assert.deepEqual(descriptor.capabilities, ["detail"]);
  assert.ok(descriptor.metadata.canonical.unsupported.some((item) => item.id === "view.aggregate"));
  assert.ok(!calls.some((call) => call.path.endsWith("/explorer-features")));
  await assert.rejects(adapter.execute(spa("aggregate", {groupBy: ["id"]})), (error) => error instanceof ExplorerIntentError && error.code === "operation_unsupported");
  await assert.rejects(adapter.export(spa("detail", {}), "csv"), /export requires/);
});

test("aggregate with rollup: group/aggregate selections, no sort, rowMeta drilldowns", async () => {
  let sent;
  const {fetch} = host({answer: (body) => {
    sent = body;
    return Response.json(result(body.query, [col("active", "boolean", "group", {field: "active"}), col("sum_amount", "decimal", "aggregate", {aggregate: "sum", field: "amount"})],
      [[false, "10.5"], [true, "3"], [null, "13.50"]],
      {row_meta: [{level: 1, kind: "detail", drilldown: {column: "active", filters: [{field: "active", op: "eq", value: false}]}}, {level: 1, kind: "detail", drilldown: {column: "active", filters: [{field: "active", op: "eq", value: true}]}}, {level: 0, kind: "total", drilldown: null}]}));
  }});
  const adapter = adapterFor(fetch);
  await adapter.getDomain("items");
  const response = await adapter.execute(spa("aggregate", {groupBy: ["active"], aggregates: [{field: "amount", function: "sum"}], rollup: true, orderBy: [{field: "id", direction: "desc"}]}));
  assert.equal(sent.format, "selecto.explorer-query");
  assert.deepEqual(sent.features, {revision: "sha256:r1"});
  assert.deepEqual(sent.query, {select: ["active", {aggregate: "sum", field: "amount", alias: "sum_amount"}], row_format: "arrays", group_by: ["active"], rollup: true, limit: 30, offset: 0});
  assert.deepEqual(response.columns.map((column) => column.id), ["active", "sum_amount"]);
  assert.equal(response.columns[1].label, "Sum of amount");
  assert.equal(response.columns[1].encoding, "decimal-string");
  assert.deepEqual(response.rows[2], {active: null, sum_amount: "13.50"});
  assert.deepEqual(response.rowMeta[0], {rollupLevel: 1, rollupKind: "detail", drilldowns: [{columnId: "active", constraints: [{field: "active", operator: "equals", value: false}]}]});
  assert.deepEqual(response.rowMeta[2], {rollupLevel: 0, rollupKind: "total", drilldowns: []});
});

test("grid: complete, two groups, date format group, derived drilldown leaf round trip", async () => {
  let sent;
  const {fetch} = host({answer: (body) => {
    sent = body;
    return Response.json(result(body.query, [col("due_on_month", "string", "group", {field: "due_on", format: "month"}), col("active", "boolean", "group", {field: "active"}), col("n", "integer", "aggregate", {aggregate: "count", field: "id"})],
      [["2026-01", true, 2]], {complete: true, row_meta: [{level: 2, kind: "detail", drilldown: {column: "active", filters: [{field: "due_on", format: "month", op: "eq", value: "2026-01"}, {field: "active", op: "eq", value: true}]}}]}));
  }});
  const adapter = adapterFor(fetch);
  const response = await adapter.execute(spa("aggregate", {groupBy: ["due_on", "active"], groupConfigs: {due_on: {groupFormat: "month"}}, aggregates: [{field: "id", function: "count", alias: "n"}], aggregateGrid: true, aggregateGridColorize: true, rollup: true}));
  assert.equal(sent.query.complete, true);
  assert.equal(sent.query.rollup, undefined);
  assert.equal(sent.query.limit, 50);
  assert.deepEqual(sent.query.group_by, [{field: "due_on", alias: "due_on_month", format: "month"}, "active"]);
  assert.deepEqual(sent.query.select, [{group: "due_on_month"}, "active", {aggregate: "count", field: "id", alias: "n"}]);
  assert.equal(response.columns[0].id, "due_on");
  assert.equal(response.columns[0].type, "text");
  assert.equal(response.metadata.canonical.complete, true);
  assert.deepEqual(response.gridColor, {scale: "linear", measure: "n", minimum: 2, maximum: 2, minimumPositive: 2});
  const constraint = response.rowMeta[0].drilldowns[0].constraints[0];
  assert.deepEqual(constraint, {field: "due_on", operator: "equals", value: "2026-01", groupConfig: {groupFormat: "month"}});
  // The drilldown constraint as a Detail filter is the host's derived-group leaf.
  const plan = planExplorerV1Query(spa("detail", {}, {conjunction: "and", items: [{id: "d", ...constraint}]}), features());
  assert.deepEqual(plan.query.filters, [{field: "due_on", format: "month", op: "eq", value: "2026-01"}]);
});

test("OR groups become any/all nodes; empty groups drop; integer text values are exact JSON integers", () => {
  const filters = {conjunction: "and", items: [
    {conjunction: "or", items: [{id: "a", field: "name", operator: "contains", value: "lt"}, {id: "b", field: "id", operator: "in", value: ["1", 3]}]},
    {conjunction: "and", items: []},
    {id: "c", field: "amount", operator: "between", value: "1.00", valueTo: "99999999999999999.99"},
    {id: "d", field: "active", operator: "is_not_null"},
  ]};
  const {query} = planExplorerV1Query(spa("detail", {selected: ["id", "amount"]}, filters), features());
  assert.deepEqual(query.filters, [
    {any: [{field: "name", op: "text_contains", value: "lt"}, {field: "id", op: "in", value: [1, 3]}]},
    {field: "amount", op: "between", value: "1.00", end: "99999999999999999.99"},
    {field: "active", op: "not_null"},
  ]);
  assert.equal(query.count, "exact");
  const only = planExplorerV1Query(spa("detail", {}, {conjunction: "or", items: [{id: "a", field: "id", operator: "equals", value: 1}, {id: "b", field: "id", operator: "equals", value: 2}]}), features()).query;
  assert.deepEqual(only.filters, [{any: [{field: "id", op: "eq", value: 1}, {field: "id", op: "eq", value: 2}]}]);
  assert.throws(() => planExplorerV1Query(spa("detail", {}, {conjunction: "or", items: [{id: "a", field: "id", operator: "equals", value: 1}, {id: "b", field: "id", operator: "equals", value: 2}]}), features({overrides: {recursive_filters: false}})), /OR and nested/);
  assert.throws(() => planExplorerV1Query(spa("detail", {}, {conjunction: "and", items: [{id: "a", field: "id", operator: "equals", value: "9007199254740993"}]}), features()), /exact JSON number range/);
});

test("buckets: text grammar to structured specs; bucket measures emit one column per range", () => {
  assert.deepEqual(parseBucketRanges("0-9, 10+, -3, 7", "numeric"), {kind: "numeric", ranges: [{min: 0, max: 9, label: "0-9"}, {min: 10, label: "10+"}, {max: 3, label: "-3"}, {min: 7, max: 7, label: "7"}]});
  assert.deepEqual(parseBucketRanges("*/10", "year"), {kind: "year", step: 10});
  assert.deepEqual(parseBucketRanges("today, yesterday, 2-7", "relative_days").ranges[1], {min: -1, max: -1, label: "yesterday"});
  assert.throws(() => parseBucketRanges("*/5", "elapsed_days"), /step/);
  assert.throws(() => parseBucketRanges("9-1", "numeric"), /reversed/);
  const plan = planExplorerV1Query(spa("aggregate", {groupBy: ["amount"], groupConfigs: {amount: {groupFormat: "buckets", bucketRanges: "0-9, 10+"}},
    aggregates: [{field: "due_on", function: "age_buckets", bucketRanges: "0-30, 31+"}]}), features());
  assert.deepEqual(plan.query.group_by, [{field: "amount", alias: "amount_buckets", buckets: {kind: "numeric", ranges: [{min: 0, max: 9, label: "0-9"}, {min: 10, label: "10+"}]}}]);
  assert.deepEqual(plan.query.select[1], {aggregate: "bucket_count", field: "due_on", alias: "age_buckets_due_on", buckets: {kind: "elapsed_days", ranges: [{min: 0, max: 30, label: "0-30"}, {min: 31, label: "31+"}]}});
  assert.deepEqual(plan.columns.slice(1).map((column) => [column.wire, column.spa.id, column.spa.label]), [["age_buckets_due_on__bucket_1", "age_buckets_due_on__bucket_1", "due_on: 0-30 days"], ["age_buckets_due_on__bucket_2", "age_buckets_due_on__bucket_2", "due_on: 31+ days"]]);
  assert.throws(() => planExplorerV1Query(spa("aggregate", {groupBy: ["name"], groupConfigs: {name: {groupFormat: "text_prefix"}}, aggregates: []}), features()), /not part of remote_query.explorer.v1/);
  assert.throws(() => planExplorerV1Query(spa("aggregate", {groupBy: ["amount"], groupConfigs: {amount: {groupFormat: "buckets", bucketRanges: "1-2"}}}), features({overrides: {buckets: false}})), /not available/);
});

test("Detail: repeated columns alias, exact count, summary aggregates and refusals of unpromised members", () => {
  const plan = planExplorerV1Query(spa("detail", {selected: ["id", "amount"], columns: [{field: "id"}, {field: "amount", alias: "Amt"}, {field: "id", alias: "Again"}], orderBy: [{field: "amount", direction: "desc"}]}), features());
  assert.deepEqual(plan.query.select, ["id", "amount", {field: "id", alias: "id_2"}]);
  assert.deepEqual(plan.columns.map((column) => column.spa.id), ["id", "amount", "id~2"]);
  assert.deepEqual(plan.query.order_by, [{field: "amount", direction: "desc"}]);
  const summary = planExplorerV1Query(spa("aggregate", {aggregates: [{field: "active", function: "true_percentage"}, {field: "amount", function: "sum", ignoreNulls: "auto"}]}), features()).query;
  assert.deepEqual(summary.select, [{aggregate: "true_percentage", field: "active", alias: "true_percentage_active"}, {aggregate: "sum", field: "amount", alias: "sum_amount", ignore_nulls: "auto"}]);
  assert.equal(summary.group_by, undefined);
  assert.throws(() => planExplorerV1Query(spa("aggregate", {aggregates: [{field: "active", function: "true_count"}]}), features({overrides: {boolean_aggregates: false}})), /boolean aggregates/);
  assert.throws(() => planExplorerV1Query(spa("graph", {groupBy: ["id"]}), features({overrides: {graph: false}})), /graph view is not available/);
  assert.equal(planExplorerV1Query(spa("detail", {}), features({overrides: {count_exact: false}})).query.count, undefined);
  assert.throws(() => planExplorerV1Query(spa("detail", {}, undefined, {number: 1, size: 500}), features()), /at most 100 rows/);
});

test("exact codecs: an inexact JSON number lexeme is refused", async () => {
  const {fetch} = host({answer: (body) => new Response(`{"ok":true,"data":{"format":"selecto.explorer-query-result","format_version":1,"domain":{"fingerprint":"fp"},"features":{"revision":"sha256:r1"},"columns":[{"id":"id","label":"id","type":"integer","encoding":"json","nullable":false,"role":"field","field":"id"}],"rows":[[9007199254740993]],"row_count":1,"row_format":"arrays","subtables":{},"page":{"limit":30,"offset":0,"has_more":false},"total_count":1}}`, {headers: {"content-type": "application/json"}})});
  await assert.rejects(adapterFor(fetch).execute(spa("detail", {})), /inexact numeric lexeme|invalid integer/);
});

test("features revision drift after the domain loaded is refused before any query", async () => {
  let revision = "sha256:r1";
  const {fetch, calls} = host({doc: () => features({revision}), answer: () => {throw new Error("must not query");}});
  const adapter = adapterFor(fetch);
  await adapter.getDomain("items");
  revision = "sha256:r2";
  await assert.rejects(adapter.execute(spa("detail", {})), (error) => error.code === "stale_explorer_features");
  assert.ok(!calls.some((call) => call.path.endsWith("/explorer-query")));
});

test("export downloads through queryExplorer with the Accept media type and host filename", async () => {
  let sent, accept;
  const {fetch} = host({answer: () => {throw new Error("no json query");}, exported: (body, init) => { sent = body; accept = new Headers(init.headers).get("accept"); return new Response("id\r\n1\r\n", {headers: {"content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=\"items.csv\""}}); }});
  const adapter = adapterFor(fetch);
  const file = await adapter.export(spa("aggregate", {groupBy: ["active", "due_on"], aggregates: [{field: "id", function: "count"}], aggregateGrid: true}, undefined, {number: 2, size: 10}), "csv");
  assert.equal(accept, "text/csv");
  assert.deepEqual(sent.query.export, {all_rows: true, shape: "rows"});
  assert.equal(sent.query.limit, undefined);
  assert.equal(file.filename, "items.csv");
  assert.equal(await file.data.text(), "id\r\n1\r\n");
  await assert.rejects(adapter.export(spa("detail", {}), "xlsx"), /xlsx export is not available/);
  const grid = planExplorerV1Query({...spa("aggregate", {groupBy: ["active", "due_on"], aggregates: [{field: "id", function: "count"}], aggregateGrid: true}), exportShape: "grid"}, features(), {export: true}).query;
  assert.deepEqual(grid.export, {all_rows: true, shape: "grid"});
  assert.equal(grid.complete, undefined);
});

test("descriptor of a narrow host lists every unpromised feature", () => {
  const descriptor = toExplorerV1Descriptor(features({overrides: {aggregate: false, graph: false, grid: false, buckets: false, export: [], count_exact: false}}));
  assert.deepEqual(descriptor.capabilities, ["detail"]);
  const ids = descriptor.metadata.canonical.unsupported.map((item) => item.id);
  for (const id of ["view.aggregate", "view.graph", "view.aggregate_grid", "group.buckets", "service.export", "page.total_rows"]) assert.ok(ids.includes(id), id);
  assert.ok(!descriptor.fields.find((field) => field.id === "amount").aggregateFunctions.includes("buckets"));
});
