import * as canonical from "@selecto/canonical-client";

const operatorMap = {equals: "eq", not_equals: "ne", greater_than: "gt", greater_than_or_equal: "gte", less_than: "lt", less_than_or_equal: "lte", is_null: "is_null", is_not_null: "is_not_null"};
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
    metadata: {canonical: {profile: metadata.query.profile, fingerprint: metadata.domain.fingerprint, publication: metadata.domain.publication, supports: {...metadata.query.supports}, limits: {...metadata.query.limits}}},
  };
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
  for (const key of ["groupBy", "groupConfigs", "aggregates", "graph", "queryLibrary", "aggregateGrid", "aggregateGridColorize", "aggregateGridColorScale"]) if (!isEmpty(state[key])) refuse(`request.state.${key}`, "requires a richer profile");
  if (state.preventDenormalization !== undefined && state.preventDenormalization !== true) refuse("request.state.preventDenormalization", "denormalization is unavailable");
  if (state.rowClickAction && state.rowClickAction !== "__default_modal__") refuse("request.state.rowClickAction", "configured row actions are unavailable");
  if (state.columns !== undefined && !isEmpty(state.columns)) refuse("request.state.columns", "repeated/formatted columns require a richer profile");
  if (!isEmpty(state.fieldConfigs)) refuse("request.state.fieldConfigs", "formatted columns require a richer profile");
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
    if (filter.valueTo !== undefined || !isEmpty(filter.groupConfig)) refuse(path, "range/grouping semantics require a richer profile");
    const op = operatorMap[filter.operator];
    if (!op || !metadata.query.operators.includes(op)) refuse(`${path}.operator`, "operator not supported by this profile");
    const result = {field: field(filter.field, `${path}.field`).path, op};
    if (!["is_null", "is_not_null"].includes(op)) {
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
    return {manifest, metadata: assertExplorerMetadata(value, manifest, entry, domain)};
  }
  return {
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
