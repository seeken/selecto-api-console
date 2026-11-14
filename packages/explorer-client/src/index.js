import * as canonical from "@selecto/canonical-client";

// Comparison/null operators are remote_query.v1 base; range/list operators are
// translated only when the publication's metadata advertises them.
const operatorMap = {equals: "eq", not_equals: "ne", greater_than: "gt", greater_than_or_equal: "gte", less_than: "lt", less_than_or_equal: "lte", is_null: "is_null", is_not_null: "is_not_null", between: "between", in: "in", not_in: "not_in"};
const reverseOperators = Object.fromEntries(Object.entries(operatorMap).map(([key, value]) => [value, key]));
const {record, nonEmptyString, integer, keys, safePath, CanonicalWireError} = canonical;

export class ExplorerIntentError extends Error {
  constructor(path, message, code = "operation_unsupported") {
    super(`${path}: ${message}`);
    this.name = "ExplorerIntentError";
    this.path = path;
    this.code = code;
    this.details = {path};
  }
}
function refuse(path, message, code) { throw new ExplorerIntentError(path, message, code); }
function nestedValidationFailure(error, reason) {
  return error instanceof ExplorerIntentError || error instanceof CanonicalWireError ? canonical.markNestedDetailRefusal(error, reason) : error;
}
function nestedRefuse(path, message, code, reason) {
  throw canonical.markNestedDetailRefusal(new ExplorerIntentError(path, message, code), reason);
}
function isEmpty(value) { return value === undefined || value === null || value === false || (Array.isArray(value) && !value.length) || (typeof value === "object" && !Object.keys(value).length); }

export function assertExplorerMetadata(value, manifest, entry, domain) {
  record(value, "metadata");
  if (value.format !== "selecto.explorer-metadata" || value.format_version !== 1) throw new CanonicalWireError("metadata", "expected selecto.explorer-metadata version 1");
  record(value.domain, "metadata.domain");
  nonEmptyString(value.domain.id, "metadata.domain.id");
  nonEmptyString(value.domain.fingerprint, "metadata.domain.fingerprint");
  nonEmptyString(value.domain.publication, "metadata.domain.publication");
  if (manifest && manifest.domain.fingerprint !== value.domain.fingerprint) throw new CanonicalWireError("metadata.domain.fingerprint", "differs from manifest fingerprint");
  if (entry && (entry.id !== value.domain.id || entry.publication !== value.domain.publication)) throw new CanonicalWireError("metadata.domain", "differs from catalog publication");
  nonEmptyString(value.label, "metadata.label");
  if (!Array.isArray(value.fields) || !value.fields.length) throw new CanonicalWireError("metadata.fields", "expected non-empty fields");
  const ids = new Set();
  const paths = new Set();
  value.fields.forEach((field, i) => {
    canonical.assertColumn(field, `metadata.fields.${i}`);
    nonEmptyString(field.path, `metadata.fields.${i}.path`);
    if (domain && (!domain.source.fields.includes(field.path) || !Object.hasOwn(domain.source.columns, field.path))) throw new CanonicalWireError(`metadata.fields.${i}.path`, "field absent from canonical publication");
    if (ids.has(field.id) || paths.has(field.path)) throw new CanonicalWireError("metadata.fields", "duplicate field id or path");
    ids.add(field.id); paths.add(field.path);
  });
  if (!Array.isArray(value.default_select) || value.default_select.some((id) => !ids.has(id)) || new Set(value.default_select).size !== value.default_select.length) throw new CanonicalWireError("metadata.default_select", "expected unique published field IDs");
  record(value.query, "metadata.query");
  if (value.query.profile !== "remote_query.v1") throw new CanonicalWireError("metadata.query.profile", "requires remote_query.v1");
  if (!Array.isArray(value.query.operators) || value.query.operators.some((op) => typeof op !== "string")) throw new CanonicalWireError("metadata.query.operators", "expected operator IDs");
  record(value.query.supports, "metadata.query.supports");
  for (const key of ["detail", "nested", "recursive_filters", "aggregates"]) if (typeof value.query.supports[key] !== "boolean") throw new CanonicalWireError(`metadata.query.supports.${key}`, "expected boolean");
  if (!value.query.supports.detail) throw new CanonicalWireError("metadata.query.supports.detail", "Detail profile unavailable");
  record(value.query.limits, "metadata.query.limits");
  integer(value.query.limits.max_limit, "metadata.query.limits.max_limit", 1);
  integer(value.query.limits.max_offset, "metadata.query.limits.max_offset");
  integer(value.query.limits.max_filters, "metadata.query.limits.max_filters");
  record(value.services, "metadata.services");
  if (value.links !== undefined) {
    record(value.links, "metadata.links");
    if (value.links.api_console !== undefined) {
      nonEmptyString(value.links.api_console, "metadata.links.api_console");
      safePath(value.links.api_console.split("?")[0]);
      if (value.links.api_console.includes("#")) throw new CanonicalWireError("metadata.links.api_console", "fragments are reserved for request handoff");
    }
  }
  return value;
}

export function toExplorerDescriptor(metadata) {
  assertExplorerMetadata(metadata);
  return {
    schema: "selecto.spa.domain-descriptor/v1", schemaVersion: 1,
    id: metadata.domain.id, name: metadata.label, source: metadata.label,
    capabilities: ["detail"], protocolFeatures: metadata.links?.api_console ? ["api_console"] : [],
    fields: metadata.fields.map((field) => ({id: field.id, label: field.label, type: field.type === "string" ? "text" : field.type === "binary" ? "text" : field.type, encoding: field.encoding, selectable: true, sortable: true, groupable: false, aggregatable: false,
      filterOperators: metadata.query.operators.map((op) => reverseOperators[op]).filter(Boolean)})),
    views: [{id: "detail", kind: "detail", label: "Detail"}],
    defaults: {selected: metadata.default_select.slice(), orderBy: [], groupBy: [], aggregates: [], rollup: true, preventDenormalization: true},
    release: {schema: "selecto.domain-publication/v1", id: metadata.domain.publication, version: metadata.domain.fingerprint, fingerprint: metadata.domain.fingerprint, status: "published"},
    ...(metadata.links?.api_console ? {artifacts: {apiConsole: metadata.links.api_console}} : {}),
    metadata: {canonical: {transport: "canonical", profile: metadata.query.profile, fingerprint: metadata.domain.fingerprint, publication: metadata.domain.publication, supports: {...metadata.query.supports}, limits: {...metadata.query.limits}, services: {...(metadata.services ?? {})}, unsupported: unsupportedExplorerFeatures(metadata)}},
  };
}

/**
 * Explorer features of the SPA protocol that this publication does not provide.
 * Frameworks render this list so absent features are visible, never silently
 * dropped. Ids are stable: `view.*`, `filters.*`, `fields.*`, `columns.*`,
 * `operator.*`, `page.*` and `service.*`.
 */
export function unsupportedExplorerFeatures(metadata) {
  const supports = metadata.query.supports;
  const operators = new Set(metadata.query.operators);
  const richer = "requires the remote_query.explorer.v1 profile";
  const list = [
    {id: "view.aggregate", label: "Aggregate view", reason: richer},
    {id: "view.graph", label: "Graph view", reason: richer},
    {id: "view.aggregate_grid", label: "Aggregate grid", reason: richer},
  ];
  if (!supports.recursive_filters) list.push({id: "filters.groups", label: "OR and nested filter groups", reason: "this publication accepts flat AND filters only"});
  list.push({id: "fields.joined", label: "Joined fields", reason: "explorer metadata v1 publishes root fields only"});
  if (!supports.nested) list.push({id: "fields.collections", label: "Nested collection columns", reason: richer});
  list.push({id: "columns.occurrences", label: "Repeated columns", reason: richer});
  for (const [spa, op] of [["between", "between"], ["in", "in"], ["not_in", "not_in"], ["contains", "text_contains"], ["starts_with", "starts_with"], ["ends_with", "ends_with"], ["date_shortcut", "date_shortcut"]]) {
    if (!operators.has(op) || !operatorMap[spa]) list.push({id: `operator.${spa}`, label: `Filter operator ${spa.replaceAll("_", " ")}`, reason: "not advertised by this publication"});
  }
  list.push({id: "page.total_rows", label: "Total row count", reason: "no implicit count; paging uses has_more"});
  for (const [id, label] of [["saved_views", "Saved views"], ["export", "Export"], ["actions", "Actions"], ["canned_pages", "Canned pages"], ["record_editors", "Record editors"], ["row_refresh", "Row refresh"], ["diagnostics", "SQL debug"], ["localization", "Localized descriptors"]]) {
    if (!Object.hasOwn(metadata.services ?? {}, id)) list.push({id: `service.${id}`, label, reason: "host service not advertised"});
  }
  return list;
}

/** Translate the bounded Detail profile; never discard unsupported semantics. */
export function toCanonicalQuery(request, metadata) {
  assertExplorerMetadata(metadata);
  keys(request, ["schema", "domainId", "view", "state", "filters", "page", "presentation", "publication", "exportShape"], "request");
  if (request.schema !== "selecto.spa.query-request/v1") refuse("request.schema", "unknown SPA request version", "invalid_query");
  if (request.domainId !== metadata.domain.id) refuse("request.domainId", "does not match publication", "invalid_query");
  if (request.view !== "detail") refuse("request.view", "only Detail is supported");
  if (request.publication !== undefined) {
    keys(request.publication, ["fingerprint", "publication"], "request.publication");
    if (request.publication.fingerprint !== metadata.domain.fingerprint || (request.publication.publication !== undefined && request.publication.publication !== metadata.domain.publication)) refuse("request.publication", "publication changed; reload the domain", "stale_domain_fingerprint");
  }
  if (request.exportShape !== undefined) refuse("request.exportShape", "export is not available");
  const state = record(request.state, "request.state");
  keys(state, ["selected", "preventDenormalization", "rowClickAction", "fieldConfigs", "orderBy", "groupBy", "groupConfigs", "rollup", "aggregateGrid", "aggregateGridColorize", "aggregateGridColorScale", "columns", "aggregates", "graph", "queryLibrary"], "request.state");
  for (const key of ["groupBy", "aggregates", "graph", "queryLibrary", "aggregateGrid", "aggregateGridColorize", "aggregateGridColorScale"]) if (!isEmpty(state[key])) refuse(`request.state.${key}`, "requires a richer profile");
  if (state.preventDenormalization !== undefined && state.preventDenormalization !== true) refuse("request.state.preventDenormalization", "denormalization is unavailable");
  if (state.rowClickAction && state.rowClickAction !== "__default_modal__") refuse("request.state.rowClickAction", "configured row actions are unavailable");
  if (state.columns !== undefined && !isEmpty(state.columns)) refuse("request.state.columns", "repeated/formatted columns require a richer profile");
  // Display alias/format are client-only presentation (PHASE0 R08, R09, R36);
  // anything that changes query semantics (group formats, buckets) is refused.
  for (const key of ["fieldConfigs", "groupConfigs"]) {
    if (state[key] === undefined) continue;
    for (const [id, config] of Object.entries(record(state[key], `request.state.${key}`))) {
      const extra = Object.keys(record(config, `request.state.${key}.${id}`)).filter((member) => !["alias", "format"].includes(member));
      if (extra.length) refuse(`request.state.${key}.${id}`, `unsupported members: ${extra.join(", ")}; they change query semantics and require a richer profile`);
      if (config.alias !== undefined && typeof config.alias !== "string") refuse(`request.state.${key}.${id}.alias`, "expected text", "invalid_query");
      if (config.format !== undefined && typeof config.format !== "string") refuse(`request.state.${key}.${id}.format`, "expected a display format", "invalid_query");
    }
  }
  const byId = new Map(metadata.fields.map((field) => [field.id, field]));
  function field(id, path) {
    const value = byId.get(id);
    if (!value) refuse(path, `unresolved field ${JSON.stringify(id)}`, "invalid_field");
    return value;
  }
  if (!Array.isArray(state.selected) || !state.selected.length || new Set(state.selected).size !== state.selected.length) refuse("request.state.selected", "expected unique non-empty fields", "invalid_query");
  const query = {select: state.selected.map((id) => field(id, "request.state.selected").path)};
  const filters = record(request.filters, "request.filters");
  keys(filters, ["conjunction", "items"], "request.filters");
  if (filters.conjunction !== "and" || !Array.isArray(filters.items)) refuse("request.filters", "only flat AND filters are supported");
  if (filters.items.length > metadata.query.limits.max_filters) refuse("request.filters", "exceeds advertised filter limit", "invalid_query");
  query.filters = filters.items.map((filter, index) => {
    const path = `request.filters.items.${index}`;
    if (filter?.items !== undefined || filter?.conjunction !== undefined) refuse(path, "recursive filters require a richer profile");
    keys(filter, ["id", "field", "operator", "value", "valueTo", "promoted", "groupConfig"], path);
    if (!isEmpty(filter.groupConfig)) refuse(path, "grouping semantics require a richer profile");
    const op = operatorMap[filter.operator];
    if (!op || !metadata.query.operators.includes(op)) refuse(`${path}.operator`, "operator not supported by this profile");
    if (filter.valueTo !== undefined && op !== "between") refuse(`${path}.valueTo`, "only between carries an end value", "invalid_query");
    const result = {field: field(filter.field, `${path}.field`).path, op};
    if (op === "between") {
      if (!Object.hasOwn(filter, "value") || !Object.hasOwn(filter, "valueTo")) refuse(path, "between requires value and valueTo", "invalid_query");
      result.value = filter.value; result.end = filter.valueTo;
    } else if (op === "in" || op === "not_in") {
      if (!Array.isArray(filter.value) || !filter.value.length) refuse(`${path}.value`, "a non-empty list is required", "invalid_query");
      result.value = filter.value;
    } else if (!["is_null", "is_not_null"].includes(op)) {
      if (!Object.hasOwn(filter, "value")) refuse(`${path}.value`, "a value is required", "invalid_query");
      result.value = filter.value;
    } else if (filter.value !== undefined && filter.value !== null && filter.value !== "") refuse(`${path}.value`, "null test cannot carry a value", "invalid_query");
    return result;
  });
  if (!Array.isArray(state.orderBy)) refuse("request.state.orderBy", "expected an array", "invalid_query");
  query.order_by = state.orderBy.map((order, index) => {
    keys(order, ["field", "direction"], `request.state.orderBy.${index}`);
    if (!["asc", "desc"].includes(order.direction)) refuse("request.state.orderBy", "invalid direction", "invalid_query");
    return {field: field(order.field, "request.state.orderBy").path, direction: order.direction};
  });
  keys(request.page, ["number", "size"], "request.page");
  integer(request.page.number, "request.page.number", 1); integer(request.page.size, "request.page.size", 1);
  query.limit = request.page.size;
  query.offset = (request.page.number - 1) * request.page.size;
  if (!Number.isSafeInteger(query.offset) || query.limit > metadata.query.limits.max_limit || query.offset > metadata.query.limits.max_offset) refuse("request.page", "exceeds advertised paging limits", "invalid_query");
  if (request.presentation !== undefined) {
    keys(request.presentation, ["timezone", "locale"], "request.presentation");
    if (request.presentation.timezone !== undefined) {
      nonEmptyString(request.presentation.timezone, "request.presentation.timezone");
      query.timezone = request.presentation.timezone;
    }
    if (request.presentation.locale !== undefined) nonEmptyString(request.presentation.locale, "request.presentation.locale");
  }
  canonical.buildRemoteRequest(metadata.domain.fingerprint, query);
  return query;
}

export function toExplorerResult(envelope, request, metadata) {
  const query = toCanonicalQuery(request, metadata);
  canonical.assertQueryResult(envelope, metadata.domain.fingerprint, query);
  const byPath = new Map(metadata.fields.map((field) => [field.path, field]));
  const columns = envelope.data.columns.map((column) => {
    const field = byPath.get(column.field ?? column.id);
    if (!field) throw new CanonicalWireError("response.columns", "unresolved canonical field");
    return {id: field.id, label: column.label, type: column.type === "string" ? "text" : column.type === "binary" ? "text" : column.type, encoding: column.encoding};
  });
  if (columns.length !== query.select.length || columns.some((column, i) => column.id !== request.state.selected[i])) throw new CanonicalWireError("response.columns", "selection differs from requested fields");
  const rows = envelope.data.rows.map((row) => Object.fromEntries(envelope.data.columns.map((column, i) => [columns[i].id, Array.isArray(row) ? row[i] : row[column.id]])));
  return {schema: "selecto.spa.query-response/v1", columns, rows,
    page: {number: request.page.number, size: request.page.size},
    metadata: {canonical: {fingerprint: metadata.domain.fingerprint, publication: metadata.domain.publication, hasMore: envelope.data.page.has_more}},
  };
}

export function createExplorerClient(options = {}) {
  const client = canonical.createCanonicalClient(options);
  // Discovery is refreshed before every query. No authenticated publication is
  // reused across a changed cookie/session or across client instances.
  async function publication(id, signal) {
    const catalog = await client.catalog(signal);
    const entry = catalog.domains.find((domain) => domain.id === id);
    if (!entry) refuse("domainId", "domain is unavailable in the current publication", "operation_forbidden");
    const [manifest, value] = await Promise.all([client.manifest(entry.manifest, signal), client.metadata(entry.explorer_metadata, signal)]);
    const domain = await client.domain(manifest, signal);
    return {entry, manifest, canonicalDomain:domain, metadata: assertExplorerMetadata(value, manifest, entry, domain)};
  }
  async function rootPublication(id, signal) {
    const context = await publication(id,signal);
    const features = await client.rootPredicateFeatures(context.manifest,signal);
    canonical.assertRootPredicateFeatures(features,{...context,domain:context.metadata.domain});
    return {...context,features,binding:rootPredicateBinding(features)};
  }
  async function nestedPublication(id, signal) {
    try {
    const catalog = await client.catalog(signal);
    const entry = catalog.domains.find(domain => domain.id === id);
    if (!entry) refuse("domainId", "domain unavailable in current publication", "operation_forbidden");
    const manifest = await client.manifest(entry.manifest, signal);
    const canonicalDomain = await client.domain(manifest, signal);
    const features = await client.nestedDetailFeatures(manifest, signal);
    canonical.assertNestedDetailFeatures(features, {entry,manifest,canonicalDomain});
    return {entry,manifest,canonicalDomain,features,binding:nestedDetailBinding(features)};
    } catch (error) {
      if (error instanceof canonical.CanonicalHttpError && error.status === 401 && error.code === "authentication_required") throw canonical.markNestedDetailRefusal(error, "authentication-required");
      throw nestedValidationFailure(error, "nested-unavailable");
    }
  }
  return {
    async getNestedDetailContext(id, requestOptions = {}) { return nestedPublication(id, requestOptions.signal); },
    async executeNestedDetailIntent(intent, requestOptions = {}) {
      // Execution uses the 1MiB request bound; the 64KiB share cap is separate.
      const retained = canonical.parseStrictJSON(JSON.stringify(intent));
      nestedIntentShape(retained);
      const context = await nestedPublication(retained.binding.domain_id, requestOptions.signal);
      const query = toNestedDetailQuery(retained, context);
      const result = await client.queryNestedDetail(context.manifest, query, {...requestOptions,features:context.features,context:canonical.nestedDetailContext(context.features)});
      return toNestedDetailExplorerResult(result, retained, context);
    },
    async getRootPredicateContext(id, requestOptions = {}) {return rootPublication(id,requestOptions.signal);},
    async executeRootPredicateIntent(intent, requestOptions = {}) {
      const retained = canonical.parseStrictJSON(JSON.stringify(intent));
      const context = await rootPublication(retained.binding.domain_id,requestOptions.signal);
      const query = toRootPredicateQuery(retained,context);
      const result = await client.queryRootPredicate(context.manifest,query,{...requestOptions,features:context.features,fingerprint:retained.binding.fingerprint});
      return toRootPredicateExplorerResult(result,retained,context);
    },
    async listDomains() {
      const catalog = await client.catalog();
      return Promise.all(catalog.domains.map(async (entry) => {
        const [manifest, value] = await Promise.all([client.manifest(entry.manifest), client.metadata(entry.explorer_metadata)]);
        const domain = await client.domain(manifest);
        return toExplorerDescriptor(assertExplorerMetadata(value, manifest, entry, domain));
      }));
    },
    async getDomain(id) { return toExplorerDescriptor((await publication(id)).metadata); },
    async execute(request, requestOptions = {}) {
      const {manifest, metadata} = await publication(request.domainId, requestOptions.signal);
      const query = toCanonicalQuery(request, metadata);
      const result = await client.query(manifest, query, requestOptions);
      return toExplorerResult(result, request, metadata);
    },
  };
}

/**
 * Chooses a host transport before an explorer mounts. `mode` "spa" and
 * "canonical" are explicit choices. "auto" asks the host whether it publishes a
 * canonical domain catalog at `catalogPath` (default `<baseUrl>/catalog`):
 * "canonical" when it answers a valid `selecto.domain-catalog`, "spa" when the
 * route is absent (404, 405, 410) or answers something that is not a catalog
 * (an HTML fallback page). Any other failure (401, 403, 5xx, network, a
 * malformed catalog) is thrown: a refusing or broken canonical host is never
 * silently downgraded to the SPA routes.
 */
export async function selectHostTransport(options = {}) {
  const {mode = "auto", baseUrl = "/api/v1/selecto", catalogPath, signal} = options;
  if (mode === "spa" || mode === "canonical") return mode;
  if (mode !== "auto") throw new TypeError("transport mode must be \"spa\", \"canonical\" or \"auto\"");
  const path = canonical.safePath(catalogPath ?? `${String(baseUrl).replace(/\/+$/, "")}/catalog`);
  const headers = new Headers(typeof options.headers === "function" ? options.headers() : options.headers);
  headers.set("accept", "application/json");
  const response = await (options.fetch ?? globalThis.fetch)(path, {headers, credentials: "same-origin", redirect: "error", signal});
  if ([404, 405, 410].includes(response.status)) return "spa";
  if (!response.ok) throw new canonical.CanonicalHttpError(response.status, {error: {code: "transport_selection_failed", message: `canonical catalog probe failed (${response.status})`}});
  let body;
  try { body = JSON.parse(await response.text()); } catch { return "spa"; }
  if (!body || typeof body !== "object" || body.format !== "selecto.domain-catalog") return "spa";
  canonical.assertCatalog(body);
  return "canonical";
}

/** A result that a newer request on the same channel superseded. UIs treat it as cancellation. */
export class StaleResultError extends Error {
  constructor(message = "superseded by a newer request") {
    super(message);
    this.name = "AbortError";
    this.code = "stale_result";
    this.stale = true;
  }
}

/**
 * The Detail strategy: `remote_query.v1` plus `selecto.explorer-metadata` v1.
 * Profile strategies share this shape so a later `remote_query.explorer.v1`
 * strategy (features sidecar, explorer-query route) slots in ahead of it:
 * `accepts(discovery)`, `discover(discovery)` -> context with `binding`,
 * `describe(context)`, `translate(request, context)`, `run(client, context,
 * query, options)` and `toResponse(envelope, request, context)`.
 */
export const detailProfile = Object.freeze({
  id: "remote_query.v1",
  accepts({manifest, entry}) { return manifest.profiles.includes("remote_query.v1") && typeof entry.explorer_metadata === "string"; },
  async discover({client, entry, manifest, canonicalDomain, signal}) {
    const metadata = assertExplorerMetadata(await client.metadata(entry.explorer_metadata, signal), manifest, entry, canonicalDomain);
    return {profile: "remote_query.v1", entry, manifest, canonicalDomain, metadata,
      binding: {fingerprint: metadata.domain.fingerprint, publication: metadata.domain.publication}};
  },
  describe(context) { return toExplorerDescriptor(context.metadata); },
  translate(request, context) { return toCanonicalQuery(request, context.metadata); },
  run(client, context, query, options) { return client.query(context.manifest, query, options); },
  toResponse(envelope, request, context) { return toExplorerResult(envelope, request, context.metadata); },
});

// ---- remote_query.explorer.v1 strategy (harness docs/remote_query_explorer.md 6.6) ----

const explorerOperatorMap = {equals: "eq", not_equals: "ne", greater_than: "gt", greater_than_or_equal: "gte", less_than: "lt", less_than_or_equal: "lte", between: "between", in: "in", not_in: "not_in", contains: "text_contains", starts_with: "starts_with", ends_with: "ends_with", date_shortcut: "date_shortcut", is_null: "is_null", is_not_null: "not_null"};
const explorerReverseOperators = Object.fromEntries(Object.entries(explorerOperatorMap).map(([spa, op]) => [op, spa]));
const explorerFunctionLabel = {count: "Count", count_distinct: "Distinct count", sum: "Sum", avg: "Average", min: "Min", max: "Max", true_count: "True count", false_count: "False count", true_percentage: "True percentage"};
const explorerGroupFormatIds = new Set(["day", "day_hour", "week", "month", "quarter", "year", "month_of_year", "day_of_month", "day_of_week", "hour"]);
const explorerBucketFormats = {buckets: "numeric", age_buckets: "elapsed_days", custom_buckets: "relative_days", year_buckets: "year"};
const explorerBucketAggregates = {buckets: "numeric", age_buckets: "elapsed_days"};
const explorerServiceLabels = [["saved_views", "Saved views"], ["actions", "Actions"], ["canned_pages", "Canned pages"], ["record_editors", "Record editors"], ["row_refresh", "Row refresh"], ["diagnostics", "SQL debug"], ["localization", "Localized descriptors"]];

/**
 * The SPA field id of a published field: `source.<path>` for root fields and
 * the path for association fields (`customer.name`, `lines.sku`), the SPA
 * descriptor convention every transport uses, so saved and shared states
 * keep resolving when a host moves between the SPA routes, Detail and
 * explorer.v1. Wire paths are always taken from the features document.
 */
export function spaFieldId(field) {
  return field.path.includes(".") ? field.path : `source.${field.path}`;
}
function spaFieldType(type) {
  return type === "string" ? "text" : type === "naive_datetime" || type === "utc_datetime" ? "datetime" : type;
}
function explorerAliasFor(text, used) {
  let base = String(text).replace(/[^A-Za-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 56) || "c";
  if (!/^[A-Za-z_]/.test(base)) base = `c_${base}`.slice(0, 56);
  let alias = base, n = 1;
  while (used.has(alias)) alias = `${base}_${++n}`;
  used.add(alias);
  return alias;
}

/**
 * The SPA bucket text grammar (`bucketRanges`) as a section 5.3 bucket spec:
 * `a-b`, `a+`, `-b`, `n`, `*\/n` (steps for numeric and year buckets) and, for
 * relative day buckets, `today`, `yesterday`, `tomorrow`. Labels are the text
 * of each part. Hosts only ever see the structured form.
 */
export function parseBucketRanges(text, kind, options = {}) {
  if (typeof text !== "string" || !text.trim()) refuse("bucketRanges", "bucket ranges are required", "invalid_query");
  const value = text.trim();
  const step = /^\*\/([1-9]\d{0,8})$/.exec(value);
  if (step) {
    if (options.allowStep === false || !["numeric", "year"].includes(kind)) refuse("bucketRanges", "step buckets apply to numeric and year buckets only", "invalid_query");
    return {kind, step: Number(step[1])};
  }
  const ranges = value.split(",").map((part) => part.trim()).map((part) => {
    if (kind === "relative_days" && ["today", "yesterday", "tomorrow"].includes(part)) {
      const day = {today: 0, yesterday: -1, tomorrow: 1}[part];
      return {min: day, max: day, label: part};
    }
    let match;
    if ((match = /^(\d{1,15})$/.exec(part))) return {min: Number(match[1]), max: Number(match[1]), label: part};
    if ((match = /^(\d{1,15})-(\d{1,15})$/.exec(part))) {
      const [min, max] = [Number(match[1]), Number(match[2])];
      if (min > max) refuse("bucketRanges", `range ${part} is reversed`, "invalid_query");
      return {min, max, label: part};
    }
    if ((match = /^(\d{1,15})\+$/.exec(part))) return {min: Number(match[1]), label: part};
    if ((match = /^-(\d{1,15})$/.exec(part))) return {max: Number(match[1]), label: part};
    refuse("bucketRanges", `unrecognized bucket range ${JSON.stringify(part)}`, "invalid_query");
  });
  const labels = new Set(ranges.map((range) => range.label));
  if (labels.size !== ranges.length || labels.has("Other")) refuse("bucketRanges", "bucket labels must be unique and not Other", "invalid_query");
  if (options.maxBuckets !== undefined && ranges.length > options.maxBuckets) refuse("bucketRanges", `at most ${options.maxBuckets} ranges are allowed`, "invalid_query");
  return {kind, ranges};
}

/** Explorer features of the SPA protocol that this explorer.v1 host does not promise. */
export function unsupportedExplorerV1Features(features) {
  const supports = features.supports;
  const list = [];
  const flag = (on, id, label, reason = "not advertised by this host's explorer features") => { if (!on) list.push({id, label, reason}); };
  flag(supports.aggregate, "view.aggregate", "Aggregate view");
  flag(supports.graph, "view.graph", "Graph view");
  flag(supports.grid, "view.aggregate_grid", "Aggregate grid");
  flag(supports.rollup, "aggregate.rollup", "Rollup subtotals");
  flag(supports.recursive_filters, "filters.groups", "OR and nested filter groups");
  flag(supports.nested, "fields.collections", "Nested collection columns");
  flag(supports.group_formats, "group.formats", "Date group formats");
  flag(supports.buckets, "group.buckets", "Bucket groups and bucket measures");
  flag(supports.boolean_aggregates, "aggregate.boolean", "True/false counts and percentages");
  flag(supports.text_ops, "operator.text", "Text filter operators (contains, starts with, ends with)");
  flag(supports.date_shortcuts, "operator.date_shortcut", "Date shortcut filters");
  flag(supports.count_exact, "page.total_rows", "Total row count", "no exact count; paging uses has_more");
  flag(supports.export.length > 0, "service.export", "Export");
  list.push({id: "group.text_prefix", label: "Text prefix groups", reason: "not part of remote_query.explorer.v1"});
  list.push({id: "graph.series_planning", label: "Host-planned graph series and transforms", reason: "series are built in the browser from the aggregate rows"});
  for (const [id, label] of explorerServiceLabels) if (!Object.hasOwn(features.services ?? {}, id)) list.push({id: `service.${id}`, label, reason: "host service not advertised"});
  return list;
}

/** The SPA domain descriptor for an explorer.v1 features document (hook `describe`). */
export function toExplorerV1Descriptor(features) {
  canonical.assertExplorerFeatures(features);
  const supports = features.supports;
  const collections = new Map(features.collections.map((collection) => [collection.id, collection]));
  const fields = features.fields.filter((field) => field.collection === null || supports.nested).map((field) => {
    const aggregateFunctions = field.aggregates.filter((name) => name !== "bucket_count" && (supports.boolean_aggregates || !name.startsWith("true_") && name !== "false_count"));
    if (supports.buckets) for (const [spa, kind] of Object.entries(explorerBucketAggregates)) if (field.buckets.includes(kind)) aggregateFunctions.push(spa);
    const descriptor = {id: spaFieldId(field), label: field.label, type: spaFieldType(field.type), encoding: field.encoding,
      selectable: field.selectable, sortable: field.sortable, groupable: field.groupable, aggregatable: aggregateFunctions.length > 0,
      aggregateFunctions, filterOperators: field.operators.map((op) => explorerReverseOperators[op]).filter(Boolean)};
    if (field.description) descriptor.metadata = {description: field.description};
    if (Array.isArray(field.choices)) descriptor.choices = field.choices;
    if (field.picker_hidden === true) descriptor.pickerHidden = true;
    if (field.collection !== null) {
      const collection = collections.get(field.collection);
      descriptor.relationship = {path: [collection.path], cardinality: "many", collectionId: collection.id, collectionLabel: collection.label, targetSchema: collection.id, field: field.path.slice(collection.path.length + 1)};
    }
    return descriptor;
  });
  const byPath = new Map(features.fields.map((field) => [field.path, spaFieldId(field)]));
  const id = (path) => byPath.get(path) ?? path;
  const views = [];
  if (supports.detail) views.push({id: "detail", kind: "detail", label: "Detail"});
  if (supports.aggregate) views.push({id: "aggregate", kind: "aggregate", label: "Aggregate"});
  if (supports.graph) views.push({id: "graph", kind: "graph", label: "Graph"});
  const capabilities = views.map((view) => view.id);
  if (supports.grid) capabilities.push("aggregate_grid");
  if (supports.export.length) capabilities.push("export");
  const segments = features.query_library.segments ?? [];
  if (segments.length) capabilities.push("query_library");
  const protocolFeatures = ["column_occurrences", "null_handling_auto"];
  if (features.fields.some((field) => field.operators.includes("not_in"))) protocolFeatures.push("not_in");
  if (supports.boolean_aggregates) protocolFeatures.push("true_percentage");
  if (supports.grid) protocolFeatures.push("grid_colorize");
  if (supports.grid && supports.export.length) protocolFeatures.push("grid_export");
  if (features.links?.api_console) protocolFeatures.push("api_console");
  const defaults = features.default ?? {};
  const descriptor = {
    schema: "selecto.spa.domain-descriptor/v1", schemaVersion: 1,
    id: features.domain.id, name: features.label ?? features.domain.id, source: features.label ?? features.domain.id,
    capabilities, protocolFeatures, fields, views,
    defaults: {selected: (defaults.select ?? []).filter((path) => typeof path === "string").map(id), orderBy: (defaults.order_by ?? []).map((order) => ({field: id(order.field), direction: order.direction ?? "asc"})),
      groupBy: (defaults.group_by ?? []).filter((path) => typeof path === "string").map(id), aggregates: [], rollup: defaults.rollup !== false, preventDenormalization: true},
    release: {schema: "selecto.domain-publication/v1", id: features.domain.publication, version: features.domain.fingerprint, fingerprint: features.domain.fingerprint, status: "published"},
    metadata: {canonical: {transport: "canonical", profile: canonical.EXPLORER_PROFILE, fingerprint: features.domain.fingerprint, publication: features.domain.publication, revision: features.revision,
      supports: {...supports, export: [...supports.export]}, limits: {...features.limits}, services: {...features.services}, unsupported: unsupportedExplorerV1Features(features)}},
  };
  if (segments.length) descriptor.queryLibrary = {
    segments: segments.map((segment) => ({id: segment.name, label: segment.label ?? segment.name, parameters: (segment.parameters ?? []).map((parameter) => ({id: parameter.name, label: parameter.label ?? parameter.name, type: parameter.type ?? "string", required: parameter.required === true}))})),
    views: (features.query_library.views ?? []).map((view) => ({id: view.name, label: view.label ?? view.name, segments: [...(view.segments ?? [])], preset: {selected: descriptor.defaults.selected.slice(), orderBy: []}})),
  };
  if (features.links?.api_console) descriptor.artifacts = {apiConsole: features.links.api_console};
  return descriptor;
}

function explorerFilterValue(value, field, path) {
  if (field.type === "integer") {
    if (Number.isSafeInteger(value)) return value;
    if (typeof value === "string" && /^-?(0|[1-9]\d*)$/.test(value.trim()) && Number.isSafeInteger(Number(value.trim()))) return Number(value.trim());
    refuse(path, "expected an integer within the exact JSON number range", "invalid_query");
  }
  if (field.type === "decimal") {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && /^-?\d{1,30}(\.\d{1,30})?$/.test(value.trim())) return value.trim();
    refuse(path, "expected a decimal number", "invalid_query");
  }
  if (field.type === "boolean") {
    if (typeof value === "boolean") return value;
    if (value === "true" || value === "false") return value === "true";
    refuse(path, "expected true or false", "invalid_query");
  }
  if (typeof value !== "string" || (value === "" && field.type !== "string")) refuse(path, "expected a text value", "invalid_query");
  if (field.type === "naive_datetime" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return `${value}:00`;
  return value;
}

/**
 * The SPA query request as a section 3 query plus the column plan that maps the
 * explorer result back onto SPA column ids (hook `translate`). Everything the
 * features document does not promise is refused here, before any request.
 */
export function planExplorerV1Query(request, features, options = {}) {
  // Shape errors in the SPA request are the request's (invalid_query), not
  // wire errors of the host.
  try { return planExplorerV1(request, features, options); }
  catch (error) { throw error instanceof CanonicalWireError ? new ExplorerIntentError(error.path, error.message.replace(/^[^:]*: /, ""), "invalid_query") : error; }
}
function planExplorerV1(request, features, options) {
  keys(request, ["schema", "domainId", "view", "state", "filters", "page", "presentation", "publication", "exportShape"], "request");
  if (request.schema !== "selecto.spa.query-request/v1") refuse("request.schema", "unknown SPA request version", "invalid_query");
  if (request.domainId !== features.domain.id) refuse("request.domainId", "does not match publication", "invalid_query");
  if (request.publication !== undefined) {
    keys(request.publication, ["fingerprint", "publication"], "request.publication");
    if (request.publication.fingerprint !== features.domain.fingerprint || (request.publication.publication !== undefined && request.publication.publication !== features.domain.publication)) refuse("request.publication", "publication changed; reload the domain", "stale_domain_fingerprint");
  }
  const supports = features.supports, limits = features.limits;
  const view = request.view;
  if (!["detail", "aggregate", "graph"].includes(view) || !supports[view]) refuse("request.view", `the ${view} view is not available on this host`);
  const state = record(request.state, "request.state");
  keys(state, ["selected", "preventDenormalization", "rowClickAction", "fieldConfigs", "orderBy", "groupBy", "groupConfigs", "rollup", "aggregateGrid", "aggregateGridColorize", "aggregateGridColorScale", "columns", "aggregates", "graph", "queryLibrary"], "request.state");
  if (state.rowClickAction && state.rowClickAction !== "__default_modal__") refuse("request.state.rowClickAction", "configured row actions are unavailable");
  const byId = new Map(features.fields.map((field) => [spaFieldId(field), field]));
  const field = (id, path) => { const value = byId.get(id); if (!value) refuse(path, `unresolved field ${JSON.stringify(id)}`, "invalid_field"); return value; };
  const query = {select: [], row_format: "arrays"};
  const columns = [];
  const used = new Set();

  // Filters: the SPA tree as ANDed nodes; empty groups are dropped (Spa.pm).
  let leaves = 0;
  function node(item, depth, path) {
    if (item && typeof item === "object" && Object.hasOwn(item, "items")) {
      keys(item, ["conjunction", "items", "id"], path);
      // SPA nesting depth, before single-member groups collapse (Spa.pm _group).
      if (depth > limits.max_filter_depth) refuse(path, `filters nest deeper than ${limits.max_filter_depth} groups`, "invalid_query");
      if (!["and", "or"].includes(item.conjunction ?? "and") || !Array.isArray(item.items)) refuse(path, "invalid filter group", "invalid_query");
      const parts = item.items.map((child, i) => node(child, depth + 1, `${path}.items.${i}`)).filter(Boolean);
      if (!parts.length) return null;
      if (parts.length === 1) return parts[0];
      if (!supports.recursive_filters) refuse(path, "OR and nested filter groups are not available on this host");
      return {[(item.conjunction ?? "and") === "or" ? "any" : "all"]: parts};
    }
    keys(item, ["id", "field", "operator", "value", "valueTo", "promoted", "groupConfig"], path);
    if (++leaves > limits.max_filters) refuse("request.filters", `more than ${limits.max_filters} filters`, "invalid_query");
    const target = field(item.field, `${path}.field`);
    if (!target.filterable && !(item.groupConfig?.groupFormat)) refuse(`${path}.field`, "field is not filterable", "invalid_field");
    const config = item.groupConfig && !isEmpty(item.groupConfig) ? record(item.groupConfig, `${path}.groupConfig`) : null;
    if (config) {
      // A drilldown on a formatted group: the derived-group leaf (3.3).
      const extra = Object.keys(config).filter((key) => !["groupFormat", "alias", "format"].includes(key));
      if (extra.length || !explorerGroupFormatIds.has(config.groupFormat)) refuse(`${path}.groupConfig`, "only date group formats can be drilled into on this profile");
      if (!["equals", "is_null"].includes(item.operator)) refuse(`${path}.operator`, "a group drilldown compares with equals or is null", "invalid_query");
      if (item.operator === "is_null") return {field: target.path, format: config.groupFormat, op: "is_null"};
      if (typeof item.value !== "string") refuse(`${path}.value`, "a formatted group value is text", "invalid_query");
      return {field: target.path, format: config.groupFormat, op: "eq", value: item.value};
    }
    const op = explorerOperatorMap[item.operator];
    if (!op || !target.operators.includes(op)) refuse(`${path}.operator`, `operator ${item.operator} is not available for ${target.label}`);
    if (item.valueTo !== undefined && item.valueTo !== null && item.valueTo !== "" && op !== "between") refuse(`${path}.valueTo`, "only between carries an end value", "invalid_query");
    const leaf = {field: target.path, op};
    if (op === "between") {
      leaf.value = explorerFilterValue(item.value, target, `${path}.value`);
      leaf.end = explorerFilterValue(item.valueTo, target, `${path}.valueTo`);
    } else if (op === "in" || op === "not_in") {
      const values = Array.isArray(item.value) ? item.value : typeof item.value === "string" ? item.value.split(",").map((part) => part.trim()).filter(Boolean) : null;
      if (!values?.length) refuse(`${path}.value`, "a non-empty list is required", "invalid_query");
      if (values.length > limits.max_filter_values) refuse(`${path}.value`, `at most ${limits.max_filter_values} values`, "invalid_query");
      leaf.value = values.map((value, i) => explorerFilterValue(value, target, `${path}.value.${i}`));
    } else if (op === "date_shortcut") {
      if (!target.date_shortcuts.includes(item.value)) refuse(`${path}.value`, "unknown date shortcut", "invalid_query");
      leaf.value = item.value;
    } else if (op !== "is_null" && op !== "not_null") {
      leaf.value = explorerFilterValue(item.value, target, `${path}.value`);
    } else if (item.value !== undefined && item.value !== null && item.value !== "") refuse(`${path}.value`, "null test cannot carry a value", "invalid_query");
    return leaf;
  }
  const root = node(record(request.filters, "request.filters"), 0, "request.filters");
  query.filters = !root ? [] : Object.hasOwn(root, "all") ? root.all : [root];

  if (state.queryLibrary !== undefined && !isEmpty(state.queryLibrary)) {
    keys(state.queryLibrary, ["view", "segments", "parameters"], "request.state.queryLibrary");
    const known = new Set((features.query_library.segments ?? []).map((segment) => segment.name));
    const names = [...new Set([...(state.queryLibrary.segments ?? []), ...((features.query_library.views ?? []).find((item) => item.name === state.queryLibrary.view)?.segments ?? [])])];
    if (state.queryLibrary.view !== undefined && !(features.query_library.views ?? []).some((item) => item.name === state.queryLibrary.view)) refuse("request.state.queryLibrary.view", "unknown query library view", "invalid_query");
    names.forEach((name) => { if (!known.has(name)) refuse("request.state.queryLibrary.segments", `unknown segment ${JSON.stringify(name)}`, "invalid_query"); });
    if (names.length) query.segments = names;
    if (state.queryLibrary.parameters !== undefined && !isEmpty(state.queryLibrary.parameters)) query.parameters = {...record(state.queryLibrary.parameters, "request.state.queryLibrary.parameters")};
  }
  if (request.presentation !== undefined) {
    keys(request.presentation, ["timezone", "locale"], "request.presentation");
    if (request.presentation.timezone !== undefined) query.timezone = canonical.assertTimezone(request.presentation.timezone);
  }
  keys(request.page, ["number", "size"], "request.page");
  if (!Number.isSafeInteger(request.page.number) || request.page.number < 1) refuse("request.page.number", "expected a page number of at least 1", "invalid_query");
  if (!Number.isSafeInteger(request.page.size) || request.page.size < 1) refuse("request.page.size", "expected a page size of at least 1", "invalid_query");
  const pageLimit = request.page.size, pageOffset = (request.page.number - 1) * request.page.size;
  const zone = query.timezone ?? "UTC";
  const instant = (target, path) => { if (target.type === "utc_datetime" && supports.timezones === "utc" && zone !== "UTC") refuse(path, "this host converts instants to UTC only"); };

  let grid = false, rollup = false, groupIds = [], aggregateIds = [];
  if (view === "detail") {
    if (state.preventDenormalization === false && features.fields.some((item) => item.collection !== null)) refuse("request.state.preventDenormalization", "denormalized to-many rows are unavailable; collections are nested");
    if (!Array.isArray(state.selected) || !state.selected.length || new Set(state.selected).size !== state.selected.length) refuse("request.state.selected", "expected unique non-empty fields", "invalid_query");
    let occurrences = state.selected.map((id) => ({field: id}));
    if (state.columns !== undefined && !isEmpty(state.columns)) {
      if (!Array.isArray(state.columns)) refuse("request.state.columns", "expected an array", "invalid_query");
      const distinct = [...new Set(state.columns.map((column) => record(column, "request.state.columns").field))];
      if (distinct.length !== state.selected.length || distinct.some((id, i) => id !== state.selected[i])) refuse("request.state.columns", "columns must list the selected fields", "invalid_query");
      occurrences = state.columns;
    }
    const count = new Map();
    const nested = new Map();
    for (const occurrence of occurrences) {
      keys(occurrence, ["field", "alias", "format"], "request.state.columns");
      const target = field(occurrence.field, "request.state.selected");
      if (target.collection !== null && !supports.nested) refuse("request.state.selected", "nested collection columns are not available on this host");
      if (!target.selectable) refuse("request.state.selected", `${target.label} is not selectable`, "invalid_field");
      const label = typeof occurrence.alias === "string" && occurrence.alias.trim() ? occurrence.alias : target.label;
      if (target.collection !== null) {
        let slot = nested.get(target.collection);
        if (!slot) {
          const collection = features.collections.find((item) => item.id === target.collection);
          slot = {children: [], column: {kind: "collection", collection, wire: null, spa: {id: collection.id, label: collection.label, type: "nested", nestedFields: []}}};
          nested.set(target.collection, slot);
          query.select.push(slot.children);
          slot.column.wire = collection.path;
          columns.push(slot.column);
        }
        if (slot.children.includes(target.path)) continue;
        slot.children.push(target.path);
        slot.column.spa.nestedFields.push({id: spaFieldId(target), key: spaFieldId(target), label, type: spaFieldType(target.type), encoding: target.encoding, nullable: target.nullable});
        continue;
      }
      const n = (count.get(spaFieldId(target)) ?? 0) + 1;
      count.set(spaFieldId(target), n);
      const wire = n === 1 && !used.has(target.path) ? target.path : explorerAliasFor(`${target.path}_${n}`, used);
      used.add(wire);
      query.select.push(wire === target.path ? target.path : {field: target.path, alias: wire});
      const spa = {id: n === 1 ? spaFieldId(target) : `${spaFieldId(target)}~${n}`, label, type: spaFieldType(target.type), encoding: target.encoding};
      if (typeof occurrence.format === "string") spa.format = occurrence.format;
      if (n > 1) Object.assign(spa, {field: spaFieldId(target), occurrence: n});
      columns.push({kind: "field", field: target, wire, spa});
    }
    if (!Array.isArray(state.orderBy)) refuse("request.state.orderBy", "expected an array", "invalid_query");
    query.order_by = state.orderBy.map((order, i) => {
      keys(order, ["field", "direction"], `request.state.orderBy.${i}`);
      const target = field(order.field, `request.state.orderBy.${i}.field`);
      if (!target.sortable) refuse(`request.state.orderBy.${i}.field`, `${target.label} is not sortable`, "invalid_field");
      return {field: target.path, direction: sortDirection(order, `request.state.orderBy.${i}.direction`)};
    });
    query.limit = pageLimit; query.offset = pageOffset;
    if (supports.count_exact && !options.export) query.count = "exact";
  } else {
    const groupBy = state.groupBy ?? [];
    if (!Array.isArray(groupBy) || new Set(groupBy).size !== groupBy.length) refuse("request.state.groupBy", "expected unique group fields", "invalid_query");
    if (groupBy.length > limits.max_group_by) refuse("request.state.groupBy", `at most ${limits.max_group_by} groups`, "invalid_query");
    const aggregates = state.aggregates ?? [];
    if (!Array.isArray(aggregates)) refuse("request.state.aggregates", "expected an array", "invalid_query");
    if (!groupBy.length && !aggregates.length) refuse("request.state", "choose a group or an aggregate", "invalid_query");
    const groupConfigs = state.groupConfigs ?? {};
    groupIds = groupBy;
    const groupEntries = groupBy.map((id, i) => {
      const target = field(id, `request.state.groupBy.${i}`);
      if (!target.groupable) refuse(`request.state.groupBy.${i}`, `${target.label} cannot be grouped`, "invalid_field");
      const config = groupConfigs[id] ?? {};
      const spa = {id, label: typeof config.alias === "string" && config.alias.trim() ? config.alias : target.label, type: spaFieldType(target.type), encoding: target.encoding};
      if (typeof config.format === "string") spa.format = config.format;
      const format = config.groupFormat;
      if (!format) { used.add(target.path); return {entry: target.path, wire: target.path, column: {kind: "group", field: target, wire: target.path, spa}}; }
      const alias = explorerAliasFor(`${target.path}_${format}`, used);
      if (explorerGroupFormatIds.has(format)) {
        if (!supports.group_formats || !target.group_formats.includes(format)) refuse(`request.state.groupConfigs.${id}.groupFormat`, `grouping by ${format} is not available for ${target.label}`);
        instant(target, `request.state.groupConfigs.${id}`);
        Object.assign(spa, {type: "text", encoding: "string"}); delete spa.format;
        return {entry: {field: target.path, alias, format}, wire: alias, column: {kind: "group", field: target, wire: alias, format, spa}};
      }
      const kind = explorerBucketFormats[format];
      if (!kind) refuse(`request.state.groupConfigs.${id}.groupFormat`, `group format ${format} is not part of remote_query.explorer.v1`);
      if (!supports.buckets || !target.buckets.includes(kind)) refuse(`request.state.groupConfigs.${id}.groupFormat`, `${format} are not available for ${target.label}`);
      instant(target, `request.state.groupConfigs.${id}`);
      Object.assign(spa, {type: "text", encoding: "string"}); delete spa.format;
      return {entry: {field: target.path, alias, buckets: parseBucketRanges(config.bucketRanges, kind, {maxBuckets: limits.max_buckets})}, wire: alias, column: {kind: "group", field: target, wire: alias, bucket: true, spa}};
    });
    if (groupEntries.length) query.group_by = groupEntries.map((group) => group.entry);
    for (const group of groupEntries) { query.select.push(typeof group.entry === "string" ? group.entry : {group: group.wire}); columns.push(group.column); }
    if (aggregates.length > limits.max_aggregates) refuse("request.state.aggregates", `at most ${limits.max_aggregates} measures`, "invalid_query");
    const spaIds = new Set(groupBy);
    for (const [i, item] of aggregates.entries()) {
      keys(item, ["field", "function", "alias", "format", "ignoreNulls", "bucketRanges"], `request.state.aggregates.${i}`);
      const target = field(item.field, `request.state.aggregates.${i}.field`);
      const explicit = typeof item.alias === "string" && item.alias !== "";
      const id = explicit ? item.alias : `${item.function}_${item.field.replace(/\./g, "_")}`;
      if (spaIds.has(id) || byId.has(id)) refuse(`request.state.aggregates.${i}.alias`, "duplicate aggregate alias", "invalid_query");
      spaIds.add(id); aggregateIds.push({id, function: item.function});
      const bucketKind = explorerBucketAggregates[item.function];
      if (bucketKind) {
        if (!supports.buckets || !target.buckets.includes(bucketKind)) refuse(`request.state.aggregates.${i}.function`, `${item.function} are not available for ${target.label}`);
        instant(target, `request.state.aggregates.${i}`);
        const spec = parseBucketRanges(item.bucketRanges, bucketKind, {allowStep: false, maxBuckets: limits.max_buckets});
        const alias = explorerAliasFor(id, used);
        query.select.push({aggregate: "bucket_count", field: target.path, alias, buckets: spec});
        const prefix = explicit ? item.alias : target.label;
        spec.ranges.forEach((range, n) => {
          const text = item.function === "age_buckets" ? (range.label === "1" ? "1 day" : `${range.label} days`) : range.label;
          columns.push({kind: "aggregate", wire: `${alias}__bucket_${n + 1}`, spa: {id: `${id}__bucket_${n + 1}`, label: `${prefix}: ${text}`, type: "integer", encoding: "json"}});
        });
        continue;
      }
      const name = item.function;
      if (!explorerFunctionLabel[name] || !target.aggregates.includes(name)) refuse(`request.state.aggregates.${i}.function`, `${name} is not available for ${target.label}`);
      if (name.startsWith("true_") || name === "false_count") { if (!supports.boolean_aggregates) refuse(`request.state.aggregates.${i}.function`, "boolean aggregates are not available on this host"); }
      const alias = explorerAliasFor(id, used);
      const selection = {aggregate: name, field: target.path, alias};
      if (item.ignoreNulls !== undefined && item.ignoreNulls !== false) {
        if (name !== "sum" || (item.ignoreNulls !== true && item.ignoreNulls !== "auto")) refuse(`request.state.aggregates.${i}.ignoreNulls`, "null handling applies to sums only", "invalid_query");
        selection.ignore_nulls = "auto";
      }
      query.select.push(selection);
      const spa = {id, label: explicit ? item.alias : `${explorerFunctionLabel[name]} of ${target.label}`, type: ["count", "count_distinct", "true_count", "false_count"].includes(name) ? "integer" : ["avg", "true_percentage"].includes(name) ? "decimal" : spaFieldType(target.type)};
      if (typeof item.format === "string") spa.format = item.format;
      columns.push({kind: "aggregate", wire: alias, spa});
    }
    if (query.select.length > limits.max_select) refuse("request.state", `at most ${limits.max_select} result columns`, "invalid_query");
    grid = view === "aggregate" && state.aggregateGrid === true;
    if (grid) {
      if (!supports.grid) refuse("request.state.aggregateGrid", "the aggregate grid is not available on this host");
      if (groupBy.length !== 2 || aggregates.length !== 1 || explorerBucketAggregates[aggregates[0].function]) refuse("request.state.aggregateGrid", "the grid needs two groups and one measure", "invalid_query");
    }
    rollup = view === "aggregate" && !grid && groupBy.length > 0 && state.rollup !== false;
    if (rollup && !supports.rollup) rollup = false;
    // Sorts name a group or a measure; a rollup keeps group-path order (6.1).
    const orderBy = Array.isArray(state.orderBy) ? state.orderBy : [];
    orderBy.forEach((order, i) => sortDirection(order ?? {}, `request.state.orderBy.${i}.direction`));
    const wireFor = new Map([...columns.filter((column) => column.kind === "group").map((column) => [column.spa.id, column.wire]), ...columns.filter((column) => column.kind === "aggregate").map((column) => [column.spa.id, column.wire])]);
    query.order_by = rollup ? [] : orderBy.filter((order) => wireFor.has(order?.field)).slice(0, limits.max_orders).map((order) => ({field: wireFor.get(order.field), direction: order.direction === "desc" ? "desc" : "asc"}));
    if (groupBy.length) {
      if (rollup) query.rollup = true;
      if (grid) { query.complete = true; query.limit = Math.min(limits.max_groups, limits.max_limit); query.offset = 0; }
      else { query.limit = pageLimit; query.offset = pageOffset; if (!rollup && supports.count_exact && !options.export) query.count = "exact"; }
    } else { query.limit = pageLimit; query.offset = pageOffset; }
  }
  if (query.select.length > limits.max_select) refuse("request.state", `at most ${limits.max_select} result columns`, "invalid_query");
  if (!options.export && query.limit > limits.max_limit) refuse("request.page.size", `at most ${limits.max_limit} rows per page`, "invalid_query");
  if (!options.export && query.offset > limits.max_offset) refuse("request.page", `pages beyond row ${limits.max_offset} are unavailable`, "invalid_query");
  if (!query.filters.length) delete query.filters;
  if (!query.order_by?.length) delete query.order_by;
  if (options.export) {
    const shape = request.exportShape ?? "rows";
    if (!["rows", "grid"].includes(shape)) refuse("request.exportShape", "unknown export shape", "invalid_query");
    if (shape === "grid" && !grid) refuse("request.exportShape", "the grid shape exports the aggregate grid", "invalid_query");
    delete query.count; delete query.complete; delete query.limit; delete query.offset;
    if (shape === "grid") delete query.rollup;
    query.export = {all_rows: true, shape};
  } else if (request.exportShape !== undefined) refuse("request.exportShape", "export shapes apply to downloads only", "invalid_query");
  return {query, columns, view, grid, rollup, groupIds, aggregateIds, page: {number: request.page.number, size: request.page.size}};
}

/** `translate` for remote_query.explorer.v1: the query object only. */
export function toExplorerV1Query(request, features, options = {}) { return planExplorerV1Query(request, features, options).query; }

function sortDirection(order, path) {
  const direction = order.direction ?? "asc";
  if (direction !== "asc" && direction !== "desc") refuse(path, "sort direction must be asc or desc", "invalid_query");
  return direction;
}

function explorerGridColor(rows, measure, scale) {
  const values = rows.map((row) => row[measure]).map((value) => typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN).filter(Number.isFinite);
  const positive = values.filter((value) => value > 0);
  return {scale: scale === "log" ? "log" : "linear", measure, minimum: values.length ? Math.min(...values) : null, maximum: values.length ? Math.max(...values) : null, minimumPositive: positive.length ? Math.min(...positive) : null};
}

/** `toResponse`: the explorer result as a `selecto.spa.query-response/v1` (6.6). */
export function toExplorerV1Response(envelope, request, features) {
  const plan = planExplorerV1Query(request, features);
  canonical.assertExplorerResult(envelope, {features, query: plan.query});
  const data = envelope.data;
  if (data.columns.length !== plan.columns.length) throw new CanonicalWireError("response.columns", "result columns differ from the requested selection");
  const byPath = new Map(features.fields.map((field) => [field.path, field]));
  const spaColumnFor = new Map();
  const columns = plan.columns.map((column, i) => {
    const wire = data.columns[i];
    if (wire.id !== column.wire) throw new CanonicalWireError(`response.columns.${i}`, "column differs from the requested selection");
    const spa = {...column.spa};
    if (column.kind !== "collection") {
      if (!column.bucket && !column.format) spa.type = spaFieldType(wire.type);
      spa.encoding = wire.encoding;
    }
    spaColumnFor.set(wire.id, spa.id);
    return spa;
  });
  const rows = data.rows.map((row) => Object.fromEntries(plan.columns.map((column, i) => {
    const value = Array.isArray(row) ? row[i] : row[data.columns[i].id];
    if (column.kind !== "collection") return [columns[i].id, value];
    const children = data.subtables[data.columns[i].id].columns;
    return [columns[i].id, value.map((child) => Object.fromEntries(columns[i].nestedFields.map((nestedField, j) => [nestedField.id, Array.isArray(child) ? child[j] : child[children[j]]])))];
  })));
  const response = {schema: "selecto.spa.query-response/v1", columns, rows,
    page: {...plan.page, ...(data.total_count !== undefined ? {totalRows: data.total_count} : {})},
    metadata: {canonical: {profile: canonical.EXPLORER_PROFILE, fingerprint: features.domain.fingerprint, publication: features.domain.publication, revision: features.revision, hasMore: data.page.has_more, ...(data.complete ? {complete: true} : {})}}};
  if (Array.isArray(data.row_meta)) response.rowMeta = data.row_meta.map((meta) => ({rollupLevel: meta.level, rollupKind: meta.kind,
    drilldowns: meta.drilldown === null ? [] : [{columnId: spaColumnFor.get(meta.drilldown.column) ?? meta.drilldown.column,
      constraints: meta.drilldown.filters.map((leaf) => {
        const target = byPath.get(leaf.field);
        if (!target) throw new CanonicalWireError("response.row_meta", "drilldown names an unpublished field");
        return {field: spaFieldId(target), operator: leaf.op === "is_null" ? "is_null" : "equals", ...(leaf.op === "eq" ? {value: leaf.value} : {}), ...(leaf.format ? {groupConfig: {groupFormat: leaf.format}} : {})};
      })}]}));
  if (plan.grid && request.state.aggregateGridColorize === true) response.gridColor = explorerGridColor(rows, columns[2].id, request.state.aggregateGridColorScale);
  return response;
}

/**
 * The `remote_query.explorer.v1` strategy, ahead of `detailProfile`: features
 * are discovered (GET getExplorerFeatures) and bound to the manifest
 * fingerprint, the catalog publication and the features revision; every
 * explorer view runs through POST queryExplorer.
 */
export const explorerProfile = Object.freeze({
  id: canonical.EXPLORER_PROFILE,
  accepts({manifest}) {
    return manifest.profiles.includes(canonical.EXPLORER_PROFILE) && ["getExplorerFeatures", "queryExplorer"].every((operation) => manifest.routes.some((route) => route.operation_id === operation));
  },
  async discover({client, entry, manifest, canonicalDomain, signal}) {
    const features = await client.explorerFeatures(manifest, signal, entry);
    return {profile: canonical.EXPLORER_PROFILE, entry, manifest, canonicalDomain, features,
      binding: {fingerprint: features.domain.fingerprint, publication: features.domain.publication, revision: features.revision}};
  },
  describe(context) { return toExplorerV1Descriptor(context.features); },
  translate(request, context) { return toExplorerV1Query(request, context.features); },
  run(client, context, query, options) { return client.queryExplorer(context.manifest, context.features, query, options); },
  toResponse(envelope, request, context) { return toExplorerV1Response(envelope, request, context.features); },
  async export(client, context, request, format, options) {
    const query = toExplorerV1Query(request, context.features, {export: true});
    if (!context.features.supports.export.includes(format)) refuse("export", `${format} export is not available on this host`);
    return client.exportExplorer(context.manifest, context.features, query, format, options);
  },
});

/**
 * One `SelectoHostAdapter`-shaped object for every framework (Vue, React,
 * Angular, Svelte and their wrappers). Discovery (catalog -> manifest ->
 * domain -> profile metadata) is refreshed for every call and never cached
 * across requests. `getDomain`/`listDomains` bind each domain to the
 * publication the UI loaded; `execute` refuses drift from that binding (or from
 * the request's own `publication`) before any query, and the host refuses a
 * stale fingerprint with 409. With `supersede: "domain"` (single-explorer
 * pages) a new `execute` aborts the previous in-flight one on the same domain;
 * an older result that still arrives is suppressed with `StaleResultError`.
 * Unsupported explorer features are listed on the descriptor at
 * `metadata.canonical.unsupported`; unsupported intent is refused explicitly.
 */
export function createCanonicalHostAdapter(options = {}) {
  const {profiles = [explorerProfile, detailProfile], supersede = false, ...clientOptions} = options;
  if (!Array.isArray(profiles) || !profiles.length) throw new TypeError("At least one canonical profile strategy is required");
  if (![false, "domain", "adapter"].includes(supersede)) throw new TypeError("supersede must be false, \"domain\" or \"adapter\"");
  const client = canonical.createCanonicalClient(clientOptions);
  const explorer = createExplorerClient(clientOptions);
  const bindings = new Map();
  const sequences = new Map();
  const inflight = new Map();

  async function discover(id, signal) {
    const catalog = await client.catalog(signal);
    const entry = catalog.domains.find((domain) => domain.id === id);
    if (!entry) refuse("domainId", "domain is unavailable in the current publication", "operation_forbidden");
    const manifest = await client.manifest(entry.manifest, signal);
    const strategy = profiles.find((profile) => profile.accepts({entry, manifest}));
    if (!strategy) refuse("domainId", "the host advertises no supported canonical explorer profile", "operation_unsupported");
    const canonicalDomain = await client.domain(manifest, signal);
    return {strategy, context: await strategy.discover({client, entry, manifest, canonicalDomain, signal})};
  }
  function describe(id, {strategy, context}) {
    const descriptor = strategy.describe(context);
    bindings.set(id, {profile: context.profile, ...context.binding});
    return descriptor;
  }
  // The live discovery must match the publication, profile and features
  // revision the UI loaded; drift is refused before any query (visible re-bind).
  async function bound(request, signal) {
    const {strategy, context} = await discover(request.domainId, signal);
    const loaded = bindings.get(request.domainId);
    if (loaded && loaded.profile !== context.profile) refuse("request", "the host's explorer profile changed; reload the domain", "stale_domain_fingerprint");
    if (loaded && loaded.revision !== undefined && loaded.revision !== context.binding.revision) refuse("request", "the host's explorer features changed; reload the domain", "stale_explorer_features");
    const publication = request.publication ?? (loaded ? {fingerprint: loaded.fingerprint, publication: loaded.publication} : undefined);
    const effective = publication ? {...request, publication} : request;
    if (!loaded) bindings.set(request.domainId, {profile: context.profile, ...context.binding});
    return {strategy, context, effective};
  }
  function channel(request, requestOptions) {
    if (requestOptions.channel !== undefined) return String(requestOptions.channel);
    return supersede === "adapter" ? "*" : supersede === "domain" ? `domain:${request.domainId}` : null;
  }

  return {
    transport: "canonical",
    profiles: profiles.map((profile) => profile.id),
    /** The publication identity a domain is bound to, as loaded by the UI. */
    binding(id) { const value = bindings.get(id); return value ? {...value} : undefined; },
    async listDomains(requestOptions = {}) {
      const catalog = await client.catalog(requestOptions.signal);
      return Promise.all(catalog.domains.map(async (entry) => describe(entry.id, await discover(entry.id, requestOptions.signal))));
    },
    async getDomain(id, requestOptions = {}) { return describe(id, await discover(id, requestOptions.signal)); },
    async execute(request, requestOptions = {}) {
      const key = channel(request, requestOptions);
      const sequence = (sequences.get(key) ?? 0) + 1;
      if (key !== null) {
        sequences.set(key, sequence);
        inflight.get(key)?.abort(new StaleResultError());
      }
      const controller = new AbortController();
      const relay = () => controller.abort(requestOptions.signal.reason);
      if (requestOptions.signal?.aborted) relay();
      else requestOptions.signal?.addEventListener("abort", relay, {once: true});
      if (key !== null) inflight.set(key, controller);
      try {
        const {strategy, context, effective} = await bound(request, controller.signal);
        const query = strategy.translate(effective, context);
        const envelope = await strategy.run(client, context, query, {signal: controller.signal, requestId: requestOptions.requestId});
        if (key !== null && sequences.get(key) !== sequence) throw new StaleResultError();
        if (controller.signal.aborted) throw controller.signal.reason ?? new StaleResultError("request cancelled");
        return strategy.toResponse(envelope, effective, context);
      } finally {
        requestOptions.signal?.removeEventListener("abort", relay);
        if (key !== null && inflight.get(key) === controller) inflight.delete(key);
      }
    },
    /**
     * Full-result download through the bound profile (explorer.v1 `export`):
     * `{data: Blob, filename, contentType}`. Profiles without export refuse.
     */
    async export(request, format, requestOptions = {}) {
      const {strategy, context, effective} = await bound(request, requestOptions.signal);
      if (typeof strategy.export !== "function") refuse("export", "export requires the remote_query.explorer.v1 profile");
      const result = await strategy.export(client, context, effective, format, {signal: requestOptions.signal, requestId: requestOptions.requestId});
      return {data: new Blob([result.bytes], {type: result.contentType}), filename: result.filename ?? `${request.domainId}-export.${format}`, contentType: result.contentType};
    },
    getRootPredicateContext: explorer.getRootPredicateContext,
    executeRootPredicateIntent: explorer.executeRootPredicateIntent,
    getNestedDetailContext: explorer.getNestedDetailContext,
    executeNestedDetailIntent: explorer.executeNestedDetailIntent,
  };
}

function requiredKeys(value, required, path) {
  keys(value, required, path);
  if (required.some((key) => !Object.hasOwn(value,key))) refuse(path,"missing required member","invalid_query");
}
export function rootPredicateBinding(features) {
  canonical.assertRootPredicateFeatures(features);
  return {domain_id:features.domain.id, fingerprint:features.domain.fingerprint, publication:features.domain.publication,
    wire_profile:features.wire_profile, feature_profile:features.profile, feature_revision:features.revision};
}
function assertIntentShape(intent) {
  requiredKeys(intent,["format","format_version","mode","binding","select","predicate","order_by","limit","offset","presentation"],"intent");
  if (intent.format !== "selecto.root-predicate-ui-intent" || intent.format_version !== 1 || intent.mode !== "recursive") refuse("intent","unknown root intent format/version/mode","invalid_query");
  requiredKeys(intent.binding,["domain_id","fingerprint","publication","wire_profile","feature_profile","feature_revision"],"intent.binding");
  Object.values(intent.binding).forEach((value) => canonical.assertUnicode(nonEmptyString(value,"intent.binding"),"intent.binding",16384));
  if (intent.binding.wire_profile !== "remote_query.v2" || intent.binding.feature_profile !== "canonical_root_predicates.v1") refuse("intent.binding","unsupported bound profile","invalid_query");
  if (!Array.isArray(intent.select) || !intent.select.length || intent.select.length > 100 || new Set(intent.select).size !== intent.select.length) refuse("intent.select","unique nonempty selection required","invalid_query");
  intent.select.forEach((id) => canonical.assertUnicode(nonEmptyString(id,"intent.select"),"intent.select",16384));
  requiredKeys(intent.predicate,intent.predicate?.kind === "absent" ? ["kind"] : ["kind","tree"],"intent.predicate");
  if (!["absent","tree"].includes(intent.predicate.kind)) refuse("intent.predicate","unknown predicate kind","invalid_query");
  let count = 0;
  function visit(node,depth) {
    record(node,"intent.predicate.tree"); if (++count > 20 || depth > 4) refuse("intent.predicate.tree","node/depth bound exceeded","invalid_query");
    const groups = ["and","or"].filter((key) => Object.hasOwn(node,key));
    if (groups.length) {
      if (groups.length !== 1) refuse("intent.predicate.tree","mixed group kinds","invalid_query");
      requiredKeys(node,groups,"intent.predicate.tree");
      if (!Array.isArray(node[groups[0]]) || !node[groups[0]].length) refuse("intent.predicate.tree","empty executable group","invalid_query");
      node[groups[0]].forEach((child) => visit(child,depth+1)); return;
    }
    const nullTest = ["is_null","is_not_null"].includes(node.op);
    requiredKeys(node,nullTest ? ["field","op"] : ["field","op","value"],"intent.predicate.tree");
    if (!["eq","ne","gt","gte","lt","lte","is_null","is_not_null"].includes(node.op)) refuse("intent.predicate.tree.op","unsupported operator");
    canonical.assertUnicode(nonEmptyString(node.field,"intent.predicate.tree.field"),"intent.predicate.tree.field",16384);
    if (!nullTest && typeof node.value !== "string" && typeof node.value !== "boolean") refuse("intent.predicate.tree.value","typed text or boolean required","invalid_query");
    if (typeof node.value === "string") canonical.assertUnicode(node.value,"intent.predicate.tree.value",16384);
  }
  if (intent.predicate.kind === "tree") visit(intent.predicate.tree,1);
  if (!Array.isArray(intent.order_by) || intent.order_by.length > 10) refuse("intent.order_by","order bound exceeded","invalid_query");
  const ordered = new Set(); intent.order_by.forEach((order) => {
    requiredKeys(order,["field","direction"],"intent.order_by");
    canonical.assertUnicode(nonEmptyString(order.field,"intent.order_by.field"),"intent.order_by.field",16384);
    if (ordered.has(order.field) || !["asc","desc"].includes(order.direction)) refuse("intent.order_by","duplicate or invalid order","invalid_query"); ordered.add(order.field);
  });
  integer(intent.limit,"intent.limit",1); integer(intent.offset,"intent.offset");
  if (intent.limit > 100 || intent.offset > 100000) refuse("intent","paging bound exceeded","invalid_query");
  requiredKeys(intent.presentation,["timezone","locale"],"intent.presentation");
  canonical.assertTimezone(intent.presentation.timezone);
  canonical.assertUnicode(nonEmptyString(intent.presentation.locale,"intent.presentation.locale"),"intent.presentation.locale",16384);
  try {new Intl.NumberFormat(intent.presentation.locale);} catch {refuse("intent.presentation.locale","unknown locale","invalid_query");}
  return intent;
}
function rootContextFeatures(context) {
  const features = context?.features;
  if (!features) refuse("features","recursive mode unavailable");
  const trusted = context.canonical_fields ? context : {domain:context.metadata?.domain ?? features.domain, manifest:context.manifest, canonicalDomain:context.canonicalDomain};
  canonical.assertRootPredicateFeatures(features,trusted);
  return features;
}
export function assertRootPredicateIntent(intent, context) {
  assertIntentShape(intent);
  const features = rootContextFeatures(context);
  const binding = rootPredicateBinding(features);
  if (Object.keys(binding).some((key) => intent.binding[key] !== binding[key])) refuse("intent.binding","publication or feature revision changed; retain state and reload","stale_domain_fingerprint");
  const byId = new Map(features.fields.map((field) => [field.id,field]));
  const field = (id) => {const value = byId.get(id); if (!value) refuse("intent.field","unresolved opaque field ID","invalid_field"); return value;};
  intent.select.forEach(field); intent.order_by.forEach((order) => field(order.field));
  function visit(node) {
    if (Object.hasOwn(node,"and") || Object.hasOwn(node,"or")) { (node.and ?? node.or).forEach(visit); return; }
    const selected = field(node.field);
    if (!selected.operators.includes(node.op)) refuse("intent.predicate.tree.op","operator unavailable for field");
    if (!["is_null","is_not_null"].includes(node.op)) canonical.assertRootScalar(node.value,selected,"intent.predicate.tree.value",true);
  }
  if (intent.predicate.kind === "tree") visit(intent.predicate.tree);
  return intent;
}
export function toRootPredicateQuery(intent, context) {
  assertRootPredicateIntent(intent,context);
  const byId = new Map(context.features.fields.map((field) => [field.id,field]));
  function translate(node) {
    if (Object.hasOwn(node,"and")) return {and:node.and.map(translate)};
    if (Object.hasOwn(node,"or")) return {or:node.or.map(translate)};
    const result = {field:byId.get(node.field).path,op:node.op};
    if (Object.hasOwn(node,"value")) result.value = node.value;
    return result;
  }
  const query = {select:intent.select.map((id) => byId.get(id).path),order_by:intent.order_by.map((order) => ({field:byId.get(order.field).path,direction:order.direction})),limit:intent.limit,offset:intent.offset,timezone:intent.presentation.timezone};
  if (intent.predicate.kind === "tree") query.where = translate(intent.predicate.tree);
  canonical.assertRootPredicateQuery(query,context.features);
  return query;
}
export function parseRootPredicateState(text, context) {
  const {value,numberTokens} = canonical.parseStrictJSON(text,{tokens:true,maxBytes:65536});
  requiredKeys(value,["format","format_version","intent"],"state");
  if (value.format !== "selecto.root-predicate-state" || value.format_version !== 1 || numberTokens.get("/format_version") !== "1" || numberTokens.get("/intent/format_version") !== "1") refuse("state","unknown/noninteger root state version","invalid_query");
  assertIntentShape(value.intent);
  if (context) assertRootPredicateIntent(value.intent,context);
  return value;
}
export function encodeRootPredicateState(state) {
  const text = JSON.stringify(state); parseRootPredicateState(text);
  const encoded = encodeURIComponent(text);
  if (encoded.length > 65536) refuse("state","encoded state exceeds 64KiB","invalid_query");
  return encoded;
}
export function decodeRootPredicateState(encodedOrRaw, context) {
  if (typeof encodedOrRaw !== "string" || encodedOrRaw.length > 65536) refuse("state","encoded state exceeds 64KiB","invalid_query");
  let text = encodedOrRaw;
  if (!text.trimStart().startsWith("{")) {
    try {text = decodeURIComponent(text);} catch {refuse("state","invalid URI escaping","invalid_query");}
  }
  return parseRootPredicateState(text,context);
}
/** Transparent facade for independently supplied local validator inputs. */
export function validateRootPredicateFeaturesAndMap(features, context, authorSelect, authorTree) {
  const validated_features = canonical.assertRootPredicateFeatures(features,context);
  const intent = {format:"selecto.root-predicate-ui-intent",format_version:1,mode:"recursive",binding:rootPredicateBinding(features),select:authorSelect,predicate:{kind:"tree",tree:authorTree},order_by:[],limit:100,offset:0,presentation:{timezone:"UTC",locale:"en-US"}};
  const query = toRootPredicateQuery(intent,{...context,features});
  return {validated_features,translated_select:query.select,translated_where:query.where};
}
export function toRootPredicateExplorerResult(envelope,intent,context) {
  const query = toRootPredicateQuery(intent,context);
  canonical.assertRootPredicateResult(envelope,{fingerprint:intent.binding.fingerprint,query,features:context.features});
  const byPath = new Map(context.features.fields.map((field) => [field.path,field]));
  const columns = envelope.data.columns.map((column) => ({id:byPath.get(column.field).id,label:column.label,type:column.type === "string" ? "text" : column.type,encoding:column.encoding}));
  const rows = envelope.data.rows.map((row) => Object.fromEntries(envelope.data.columns.map((column,i) => [columns[i].id,Array.isArray(row) ? row[i] : row[column.id]])));
  return {schema:"selecto.spa.query-response/v1",columns,rows,page:{number:Math.floor(intent.offset/intent.limit)+1,size:intent.limit},metadata:{canonical:{fingerprint:intent.binding.fingerprint,publication:intent.binding.publication,hasMore:envelope.data.page.has_more}}};
}

/** Read the existing closed flat snapshot without upgrading its request profile. */
export function flatSnapshotToRequest(snapshot) {
  keys(snapshot,["version","domainId","view","state","filters","page","publication","presentation"],"snapshot");
  if (snapshot.version !== 2) refuse("snapshot.version","unknown flat snapshot version","invalid_query");
  for (const key of ["domainId","view","state","filters","page"]) if (!Object.hasOwn(snapshot,key)) refuse(`snapshot.${key}`,"missing required member","invalid_query");
  const {version,...request} = snapshot;
  return {schema:"selecto.spa.query-request/v1",...request};
}

/** Explicit complete nested mode: IDs are authoring keys, paths are wire keys. */
export function nestedDetailBinding(features) {
  canonical.assertNestedDetailFeatures(features);
  return {domain_id:features.domain.id,fingerprint:features.domain.fingerprint,publication:features.domain.publication,wire_profile:"remote_query.v1",feature_profile:"canonical_nested_detail.v1",feature_revision:features.revision};
}
function nestedID(value,path,max=256) {
  canonical.assertUnicode(nonEmptyString(value,path),path,max);
  if (/[\r\n]/.test(value)) refuse(path,"line breaks unavailable","invalid_query");return value;
}
function nestedIntentShape(intent) {
  try {
    requiredKeys(intent,["format","format_version","mode","binding","collection_id","select","filters","order_by","limit","offset","row_format","presentation"],"nested.intent");
  } catch (error) {
    if (intent && typeof intent === "object" && !Array.isArray(intent) && ["where", "child_order_by", "formatter"].some(key => Object.hasOwn(intent, key))) throw nestedValidationFailure(error, "closed-intent-violation");
    throw error;
  }
  if(intent.format!=="selecto.nested-detail-ui-intent"||intent.format_version!==1||intent.mode!=="nested")refuse("nested.intent","unknown nested mode/version","invalid_query");
  requiredKeys(intent.binding,["domain_id","fingerprint","publication","wire_profile","feature_profile","feature_revision"],"nested.intent.binding");
  for(const value of Object.values(intent.binding))nestedID(value,"nested.intent.binding",1024);
  if(intent.binding.wire_profile!=="remote_query.v1"||intent.binding.feature_profile!=="canonical_nested_detail.v1")refuse("nested.intent.binding","unsupported bound profile");
  nestedID(intent.collection_id,"nested.intent.collection_id");
  if(!Array.isArray(intent.select)||intent.select.length<2||intent.select.length>21)refuse("nested.intent.select","selection bound","invalid_query");
  const rootIDs=new Set();let children=0;
  intent.select.forEach(slot=>{if(Array.isArray(slot)){children++;if(!slot.length||slot.length>20||new Set(slot).size!==slot.length)refuse("nested.intent.select","child selection bound/duplicate","invalid_query");slot.forEach(id=>nestedID(id,"nested.intent.child"));}else{nestedID(slot,"nested.intent.select");if(rootIDs.has(slot))refuse("nested.intent.select","duplicate root ID","invalid_query");rootIDs.add(slot);}});
  if(children!==1||!rootIDs.size||rootIDs.size>20)refuse("nested.intent.select","one collection and root selection required","invalid_query");
  if(!Array.isArray(intent.filters)||intent.filters.length>20)refuse("nested.intent.filters","filter bound","invalid_query");const filterIDs=new Set();
  intent.filters.forEach(f=>{const nullOp=["is_null","is_not_null"].includes(f?.op);requiredKeys(f,nullOp?["id","field","op"]:["id","field","op","value"],"nested.intent.filter");nestedID(f.id,"nested.intent.filter.id",128);if(/[\u0000-\u001f\u007f]/.test(f.id)||filterIDs.has(f.id))refuse("nested.intent.filter.id","control/duplicate filter ID","invalid_query");filterIDs.add(f.id);nestedID(f.field,"nested.intent.filter.field");if(!["eq","ne","gt","gte","lt","lte","is_null","is_not_null"].includes(f.op))refuse("nested.intent.filter.op","unknown operator");if(!nullOp){if(typeof f.value!=="string"&&typeof f.value!=="boolean")refuse("nested.intent.filter.value","typed text/boolean required","invalid_query");if(typeof f.value==="string")canonical.assertUnicode(f.value,"nested.intent.filter.value",16384);}});
  if(!Array.isArray(intent.order_by)||intent.order_by.length>10)refuse("nested.intent.order_by","order bound","invalid_query");const seen=new Set();intent.order_by.forEach(o=>{requiredKeys(o,["field","direction"],"nested.intent.order");nestedID(o.field,"nested.intent.order.field");if(seen.has(o.field)||!["asc","desc"].includes(o.direction))refuse("nested.intent.order","duplicate/direction","invalid_query");seen.add(o.field);});
  integer(intent.limit,"nested.intent.limit",1);integer(intent.offset,"nested.intent.offset");if(intent.limit>25||intent.offset>100000)refuse("nested.intent.page","page bound","invalid_query");if(!["arrays","objects"].includes(intent.row_format))refuse("nested.intent.row_format","unknown format","invalid_query");requiredKeys(intent.presentation,["timezone","locale"],"nested.intent.presentation");if(intent.presentation.timezone!=="UTC"||intent.presentation.locale!=="en-US")refuse("nested.intent.presentation","first browser presentation is UTC/en-US");return intent;
}
export function createNestedDetailIntent(features) {
  const binding=nestedDetailBinding(features),collection=features.collections[0],roots=new Map(features.root_fields.map(f=>[f.path,f.id])),children=new Map(collection.fields.map(f=>[f.path,f.id]));
  return {format:"selecto.nested-detail-ui-intent",format_version:1,mode:"nested",binding,collection_id:collection.id,select:features.defaults.select.map(s=>Array.isArray(s)?s.map(p=>children.get(p)):roots.get(s)),filters:[],order_by:[],limit:25,offset:0,row_format:"arrays",presentation:{timezone:"UTC",locale:"en-US"}};
}
export function assertNestedDetailIntent(intent,context,options={}) {
  try { return validateNestedDetailIntent(intent, context); }
  catch (error) { throw nestedValidationFailure(error, options.origin === "state" ? "invalid-nested-state" : "invalid-nested-intent"); }
}
function validateNestedDetailIntent(intent,context) {
  nestedIntentShape(intent);const features=context?.features;if(!features)nestedRefuse("nested.features","nested detail unavailable","operation_unsupported","nested-unavailable");
  try { canonical.assertNestedDetailFeatures(features,context); }
  catch (error) { throw nestedValidationFailure(error, "nested-unavailable"); }
  const binding=nestedDetailBinding(features);
  if(Object.keys(binding).some(k=>intent.binding[k]!==binding[k]))nestedRefuse("nested.intent.binding","publication/revision changed; retain state","stale_nested_detail_context","stale-nested-context");
  const collection=features.collections[0],roots=new Map(features.root_fields.map(f=>[f.id,f])),children=new Map(collection.fields.map(f=>[f.id,f]));
  if(intent.collection_id!==collection.id)nestedRefuse("nested.intent.collection_id","unpublished collection","invalid_field","unpublished-field-id");
  const field=(id,map)=>{const f=map.get(id);if(!f)nestedRefuse("nested.intent.field","unpublished opaque ID","invalid_field","unpublished-field-id");return f;};
  intent.select.forEach(s=>Array.isArray(s)?s.forEach(id=>field(id,children)):field(s,roots));
  intent.order_by.forEach(o=>field(o.field,roots));intent.filters.forEach(f=>{const descriptor=field(f.field,roots);if(!descriptor.operators.includes(f.op))refuse("nested.intent.filter.op","unavailable operator");if(Object.hasOwn(f,"value"))canonical.assertNestedDetailScalar(f.value,descriptor,"nested.intent.filter.value",{author:true});});return intent;
}
export function toNestedDetailQuery(intent,context) {
  assertNestedDetailIntent(intent,context);const collection=context.features.collections[0],roots=new Map(context.features.root_fields.map(f=>[f.id,f])),children=new Map(collection.fields.map(f=>[f.id,f]));
  const query={select:intent.select.map(s=>Array.isArray(s)?s.map(id=>children.get(id).path):roots.get(s).path),filters:intent.filters.map(f=>({field:roots.get(f.field).path,op:f.op,...(Object.hasOwn(f,"value")?{value:f.value}:{})})),order_by:intent.order_by.map(o=>({field:roots.get(o.field).path,direction:o.direction})),limit:intent.limit,offset:intent.offset,row_format:intent.row_format,timezone:intent.presentation.timezone};canonical.assertNestedDetailQuery(query,context.features);return query;
}
export function parseNestedDetailState(raw,context) {
  try {
  const {value,numberTokens}=canonical.parseStrictJSON(raw,{tokens:true,maxBytes:65536});requiredKeys(value,["format","format_version","intent"],"nested.state");
  if(value.format!=="selecto.nested-detail-state"||value.format_version!==1||numberTokens.get("/format_version")!=="1"||numberTokens.get("/intent/format_version")!=="1")refuse("nested.state","unknown/noninteger version","invalid_query");
  for(const key of ["limit","offset"])if(!/^(?:0|[1-9]\d*)$/.test(numberTokens.get(`/intent/${key}`)??""))refuse("nested.state","noninteger page token","invalid_query");
  nestedIntentShape(value.intent);if(context)assertNestedDetailIntent(value.intent,context,{origin:"state"});return value;
  } catch (error) { throw nestedValidationFailure(error, error instanceof CanonicalWireError && error.path === "JSON" && error.validationReason === "utf8-byte-limit" ? "state-limit" : "invalid-nested-state"); }
}
export function encodeNestedDetailState(state) {
  const raw=JSON.stringify(state);parseNestedDetailState(raw);const encoded=encodeURIComponent(raw);if(encoded.length>65536)nestedRefuse("nested.state","encoded state exceeds64KiB","invalid_query","state-limit");return encoded;
}
export function decodeNestedDetailState(rawOrEncoded,context) {
  if(typeof rawOrEncoded!=="string")nestedRefuse("nested.state","state exceeds64KiB","invalid_query","invalid-nested-state");
  if(rawOrEncoded.length>65536)nestedRefuse("nested.state","state exceeds64KiB","invalid_query","state-limit");let raw=rawOrEncoded;
  if(!raw.trimStart().startsWith("{")){try{raw=decodeURIComponent(raw);}catch{nestedRefuse("nested.state","invalid URI layer","invalid_query","invalid-nested-state");}}return parseNestedDetailState(raw,context);
}
export function nestedDetailConsoleHref(path,state) {
  nonEmptyString(path,"nested.console.path");if(path.includes("#"))refuse("nested.console.path","fragment reserved for nested handoff");safePath(path.split("?")[0]);
  const fragment=new URLSearchParams();fragment.set("nested_request",encodeNestedDetailState(state));return `${path}#${fragment}`;
}
export function toNestedDetailExplorerResult(envelope,intent,context) {
  const query=toNestedDetailQuery(intent,context),features=context.features;canonical.assertNestedDetailResult(envelope,{query,features,context:canonical.nestedDetailContext(features)});
  const collection=features.collections[0],roots=new Map(features.root_fields.map(f=>[f.path,f])),children=new Map(collection.fields.map(f=>[f.path,f]));
  const scalar=f=>({id:f.id,key:f.id,path:f.path,label:f.label,type:f.type==="string"?"text":f.type,encoding:f.encoding,nullable:f.nullable});
  const childPaths=query.select.find(Array.isArray),childFields=childPaths.map(p=>children.get(p));
  const columns=query.select.map(s=>Array.isArray(s)?{id:collection.id,path:collection.path,label:collection.label,type:"nested",encoding:"json",nullable:false,nestedFields:childFields.map(scalar),complete:true,limit:20}:scalar(roots.get(s)));
  const rows=envelope.data.rows.map(row=>Object.fromEntries(columns.map((column,i)=>{const wire=envelope.data.columns[i],value=Array.isArray(row)?row[i]:row[wire.id];return[column.id,column.type==="nested"?value.map(child=>Object.fromEntries(childFields.map((f,j)=>[f.id,Array.isArray(child)?child[j]:child[f.path]]))):value];})));
  return {schema:"selecto.spa.query-response/v1",columns,rows,page:{number:Math.floor(intent.offset/intent.limit)+1,size:intent.limit},metadata:{canonical:{profile:"canonical_nested_detail.v1",fingerprint:intent.binding.fingerprint,publication:intent.binding.publication,hasMore:envelope.data.page.has_more,nestedContext:canonical.nestedDetailContext(features),completeChildren:true}}};
}
