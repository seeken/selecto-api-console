/** Strict transport validation; host authorization and query policy stay on the host. */
export class CanonicalWireError extends Error {
  constructor(path, message) {
    super(`${path}: ${message}`);
    this.name = "CanonicalWireError";
    this.code = "invalid_response";
    this.path = path;
  }
}

export class CanonicalHttpError extends Error {
  constructor(status, envelope) {
    super(envelope.error.message);
    this.name = "CanonicalHttpError";
    this.status = status;
    this.code = envelope.error.code;
    this.details = envelope.error.details;
    this.requestId = envelope.meta?.request_id;
    this.envelope = envelope;
  }
}

export function safePath(value) {
  if (typeof value !== "string" || !/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(value) || value.includes("//")) {
    throw new CanonicalWireError("path", "expected an absolute same-origin path");
  }
  for (const segment of value.split("/")) {
    let decoded;
    try { decoded = decodeURIComponent(segment); } catch { throw new CanonicalWireError("path", "invalid escaping"); }
    // Encoded separators can be interpreted differently by a proxy or host.
    if (decoded === "." || decoded === ".." || /[\\/\u0000-\u0020]/.test(decoded)) {
      throw new CanonicalWireError("path", "unsafe path segment");
    }
  }
  return value;
}

export function record(value, path) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CanonicalWireError(path, "expected an object");
  return value;
}
export function nonEmptyString(value, path) {
  if (typeof value !== "string" || !value.length) throw new CanonicalWireError(path, "expected a non-empty string");
  return value;
}
export function integer(value, path, minimum = 0) {
  if (!Number.isSafeInteger(value) || value < minimum) throw new CanonicalWireError(path, `expected an integer >= ${minimum}`);
  return value;
}
function bool(value, path) {
  if (typeof value !== "boolean") throw new CanonicalWireError(path, "expected a boolean");
}
function oneOf(value, allowed, path) {
  if (!allowed.includes(value)) throw new CanonicalWireError(path, `expected one of ${allowed.join(", ")}`);
}
export function keys(value, allowed, path) {
  record(value, path);
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length) throw new CanonicalWireError(path, `unsupported members: ${extra.join(", ")}`);
}
function array(value, path) {
  if (!Array.isArray(value)) throw new CanonicalWireError(path, "expected an array");
  return value;
}
function format(value, expected, path) {
  record(value, path);
  if (value.format !== expected || value.format_version !== 1) throw new CanonicalWireError(path, `expected ${expected} version 1`);
}

export function assertCatalog(value) {
  format(value, "selecto.domain-catalog", "catalog");
  const ids = new Set();
  array(value.domains, "catalog.domains").forEach((entry, i) => {
    record(entry, `catalog.domains.${i}`);
    nonEmptyString(entry.id, "catalog.domain.id");
    nonEmptyString(entry.label, "catalog.domain.label");
    nonEmptyString(entry.publication, "catalog.domain.publication");
    safePath(entry.manifest);
    safePath(entry.explorer_metadata);
    if (ids.has(entry.id)) throw new CanonicalWireError("catalog.domains", "duplicate domain id");
    ids.add(entry.id);
  });
  return value;
}

export function assertManifest(value) {
  format(value, "selecto.canonical-domain-api", "manifest");
  record(value.domain, "manifest.domain");
  nonEmptyString(value.domain.fingerprint, "manifest.domain.fingerprint");
  const operations = new Set();
  array(value.routes, "manifest.routes").forEach((route) => {
    record(route, "manifest.route");
    nonEmptyString(route.operation_id, "manifest.route.operation_id");
    nonEmptyString(route.method, "manifest.route.method");
    // Parameterized write/action routes are outside the read client.
    if (["queryDomain", "getDomain", "getOpenApi", "getExplorerMetadata", "getDomainCatalog"].includes(route.operation_id)) safePath(route.path);
    if (operations.has(route.operation_id)) throw new CanonicalWireError("manifest.routes", "duplicate operation id");
    operations.add(route.operation_id);
  });
  array(value.profiles, "manifest.profiles").forEach((profile) => nonEmptyString(profile, "manifest.profile"));
  if (!value.profiles.includes("remote_query.v1")) throw new CanonicalWireError("manifest.profiles", "remote_query.v1 is required");
  routePath(value, "queryDomain", "POST");
  return value;
}

export function routePath(manifest, operation, method) {
  const route = manifest.routes.find((entry) => entry.operation_id === operation && entry.method.toUpperCase() === method);
  if (!route) throw new CanonicalWireError("manifest.routes", `missing ${method} ${operation}`);
  return safePath(route.path);
}

export function assertDomain(value, fingerprint) {
  record(value, "domain");
  if (value.domain_fingerprint !== fingerprint) throw new CanonicalWireError("domain.domain_fingerprint", "differs from manifest fingerprint");
  record(value.source, "domain.source");
  record(value.source.columns, "domain.source.columns");
  array(value.source.fields, "domain.source.fields").forEach((field) => nonEmptyString(field, "domain.source.field"));
  return value;
}

export function assertError(value) {
  record(value, "error response");
  if (value.ok !== false) throw new CanonicalWireError("error response.ok", "expected false");
  record(value.error, "error response.error");
  nonEmptyString(value.error.code, "error.code");
  nonEmptyString(value.error.message, "error.message");
  record(value.error.details, "error.details");
  if (value.meta !== undefined) {
    record(value.meta, "error.meta");
    if (value.meta.request_id !== undefined) nonEmptyString(value.meta.request_id, "error.meta.request_id");
  }
  return value;
}

const columnTypes = ["integer", "decimal", "string", "boolean", "date", "time", "datetime", "uuid", "binary", "json", "unknown"];
const encodings = ["json", "string", "decimal-string", "rfc3339", "base64"];
export function assertColumn(value, path = "column") {
  record(value, path);
  nonEmptyString(value.id, `${path}.id`);
  nonEmptyString(value.label, `${path}.label`);
  oneOf(value.type, columnTypes, `${path}.type`);
  oneOf(value.encoding, encodings, `${path}.encoding`);
  bool(value.nullable, `${path}.nullable`);
  return value;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function jsonScalar(value) {
  if (typeof value === "number") return Number.isFinite(value) && (!Number.isInteger(value) || Number.isSafeInteger(value));
  if (value === null || ["string", "boolean"].includes(typeof value)) return true;
  if (Array.isArray(value)) return value.every(jsonScalar);
  return value && typeof value === "object" && Object.values(value).every(jsonScalar);
}
export function assertScalar(value, column, path) {
  if (value === null) {
    if (!column.nullable) throw new CanonicalWireError(path, "null in non-nullable column");
    return;
  }
  let valid = false;
  if (column.encoding === "decimal-string") {
    valid = typeof value === "string" && (column.type === "integer" ? /^-?(0|[1-9]\d*)$/ : /^-?(0|[1-9]\d*)(\.\d+)?$/).test(value);
  } else if (column.type === "integer") valid = Number.isSafeInteger(value);
  else if (column.type === "decimal") valid = typeof value === "number" && Number.isFinite(value);
  else if (column.type === "boolean") valid = typeof value === "boolean";
  else if (column.type === "date") valid = typeof value === "string" && validDate(value);
  else if (column.type === "time") valid = typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?$/.test(value);
  else if (column.type === "datetime") valid = typeof value === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value) && validDate(value.slice(0, 10));
  else if (column.type === "uuid") valid = typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
  else if (column.type === "binary") valid = typeof value === "string" && column.encoding === "base64" && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value);
  else if (["json", "unknown"].includes(column.type)) valid = jsonScalar(value);
  else valid = typeof value === "string";
  if (!valid) throw new CanonicalWireError(path, `invalid ${column.type}/${column.encoding} value`);
}

export function assertQueryResult(value, fingerprint, query = {}) {
  record(value, "response");
  if (value.ok !== true) throw new CanonicalWireError("response.ok", "expected true");
  const data = record(value.data, "response.data");
  format(data, "selecto.remote-query-result", "response.data");
  if (record(data.domain, "response.data.domain").fingerprint !== fingerprint) throw new CanonicalWireError("response.data.domain", "Domain fingerprint drift");
  const columns = array(data.columns, "response.data.columns");
  const ids = new Set();
  columns.forEach((column, i) => {
    assertColumn(column, `columns.${i}`);
    if (ids.has(column.id)) throw new CanonicalWireError("columns", "duplicate column id");
    ids.add(column.id);
  });
  const rowFormat = data.row_format ?? "arrays";
  oneOf(rowFormat, ["arrays", "objects"], "response.data.row_format");
  if (rowFormat !== (query.row_format ?? "arrays")) throw new CanonicalWireError("response.data.row_format", "does not match request");
  const rows = array(data.rows, "response.data.rows");
  rows.forEach((row, i) => {
    if (rowFormat === "arrays") {
      if (!Array.isArray(row) || row.length !== columns.length) throw new CanonicalWireError(`rows.${i}`, "row width differs from columns");
    } else {
      record(row, `rows.${i}`);
      if (Object.keys(row).length !== ids.size || Object.keys(row).some((key) => !ids.has(key))) throw new CanonicalWireError(`rows.${i}`, "row keys differ from columns");
    }
    columns.forEach((column, j) => assertScalar(rowFormat === "arrays" ? row[j] : row[column.id], column, `rows.${i}.${column.id}`));
  });
  if (integer(data.row_count, "response.data.row_count") !== rows.length) throw new CanonicalWireError("row_count", "differs from returned rows");
  record(data.page, "response.data.page");
  integer(data.page.limit, "page.limit", 1);
  integer(data.page.offset, "page.offset");
  bool(data.page.has_more, "page.has_more");
  if (rows.length > data.page.limit || (query.limit !== undefined && query.limit !== data.page.limit) || (query.offset !== undefined && query.offset !== data.page.offset)) throw new CanonicalWireError("page", "does not match requested page");
  return value;
}

export function buildRemoteRequest(fingerprint, query, requestId) {
  nonEmptyString(fingerprint, "domain.fingerprint");
  keys(query, ["select", "projection", "view", "filters", "group_by", "segments", "parameters", "order_by", "ordering", "limit", "offset", "timezone", "row_format"], "query");
  if (["select", "projection", "view"].filter((key) => Object.hasOwn(query, key)).length !== 1) throw new CanonicalWireError("query", "exactly one authoring mode is required");
  if (query.select !== undefined) {
    const selected = array(query.select, "query.select");
    if (!selected.length) throw new CanonicalWireError("query.select", "selection cannot be empty");
  }
  if (query.limit !== undefined) { integer(query.limit, "query.limit", 1); if (query.limit > 10000) throw new CanonicalWireError("query.limit", "exceeds protocol maximum"); }
  if (query.offset !== undefined) integer(query.offset, "query.offset");
  if (query.row_format !== undefined) oneOf(query.row_format, ["arrays", "objects"], "query.row_format");
  if (query.timezone !== undefined) nonEmptyString(query.timezone, "query.timezone");
  if (!jsonScalar(query)) throw new CanonicalWireError("query", "must contain finite JSON values");
  const result = {format: "selecto.remote-query", format_version: 1, domain: {fingerprint}, query};
  if (requestId !== undefined) { nonEmptyString(requestId, "request_id"); if (requestId.length > 128) throw new CanonicalWireError("request_id", "too long"); result.request_id = requestId; }
  return result;
}

export function createCanonicalClient(options = {}) {
  const baseUrl = safePath((options.baseUrl ?? "/api/v1/selecto").replace(/\/+$/, ""));
  const transport = options.fetch ?? globalThis.fetch;
  async function request(path, init = {}) {
    const headers = new Headers(typeof options.headers === "function" ? options.headers() : options.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const response = await transport(safePath(path), {...init, headers, credentials: "same-origin"});
    const payload = await response.json().catch((error) => {
      if (error?.name === "AbortError") throw error;
      throw new CanonicalWireError("response", "server did not return JSON");
    });
    if (!response.ok) throw new CanonicalHttpError(response.status, assertError(payload));
    return {payload, status: response.status, statusText: response.statusText, headers: response.headers};
  }
  return {
    baseUrl,
    async catalog(signal) { return assertCatalog((await request(options.catalogPath ?? `${baseUrl}/catalog`, {signal})).payload); },
    async manifest(path = `${baseUrl}/`, signal) { return assertManifest((await request(path, {signal})).payload); },
    async domain(manifest, signal) { return assertDomain((await request(routePath(manifest, "getDomain", "GET"), {signal})).payload, manifest.domain.fingerprint); },
    async metadata(path, signal) { return (await request(path, {signal})).payload; },
    async query(manifest, query, requestOptions = {}) {
      assertManifest(manifest);
      const envelope = buildRemoteRequest(requestOptions.fingerprint ?? manifest.domain.fingerprint, query, requestOptions.requestId);
      const result = await request(routePath(manifest, "queryDomain", "POST"), {method: "POST", body: JSON.stringify(envelope), signal: requestOptions.signal});
      assertQueryResult(result.payload, envelope.domain.fingerprint, query);
      return result.payload;
    },
    request,
  };
}
