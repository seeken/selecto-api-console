/** Strict transport validation; host authorization and query policy stay on the host. */
export class CanonicalWireError extends Error {
  constructor(path, message, validationReason) {
    super(`${path}: ${message}`);
    this.name = "CanonicalWireError";
    this.code = "invalid_response";
    this.path = path;
    if (validationReason !== undefined) this.validationReason = validationReason;
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

// Public local-refusal metadata is independent of wire error codes/messages.
// Only duplicate slots have a broader family; the remaining pairs are exact.
const nestedRefusalFamilies = Object.freeze(Object.assign(Object.create(null), {
  "nested-unavailable": "nested-unavailable",
  "authentication-required": "authentication-required",
  "stale-nested-context": "stale-nested-context",
  "invalid-nested-intent": "invalid-nested-intent",
  "unpublished-field-id": "unpublished-field-id",
  "closed-intent-violation": "closed-intent-violation",
  "duplicate-state-slot": "invalid-nested-state",
  "invalid-nested-state": "invalid-nested-state",
  "state-limit": "state-limit",
  "invalid-selected-raw": "invalid-selected-raw"
}));

export function nestedDetailRefusal(error) {
  try {
    const reason = error?.nestedDetailRefusalReason, family = error?.nestedDetailRefusalFamily;
    return typeof reason === "string" && Object.hasOwn(nestedRefusalFamilies, reason) && family === nestedRefusalFamilies[reason] ? {reason, family} : null;
  } catch { return null; }
}

/** Trusted validation branches attach scalar metadata without replacing errors. */
export function markNestedDetailRefusal(error, reason) {
  if (!Object.hasOwn(nestedRefusalFamilies, reason)) throw new TypeError("Unknown nested refusal reason");
  if (!(error instanceof Error) || nestedDetailRefusal(error) || !Object.isExtensible(error) || Object.hasOwn(error, "nestedDetailRefusalReason") || Object.hasOwn(error, "nestedDetailRefusalFamily")) return error;
  Object.defineProperties(error, {
    nestedDetailRefusalReason: {value: reason},
    nestedDetailRefusalFamily: {value: nestedRefusalFamilies[reason]}
  });
  return error;
}

export function safePath(value) {
  if (typeof value !== "string" || !/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(value) || value.includes("//")) {
    throw new CanonicalWireError("path", "expected an absolute same-origin path");
  }
  for (const segment of value.split("/")) {
    let decoded;
    try { decoded = segment; for (let pass = 0; pass < 16; pass++) { const next = decodeURIComponent(decoded); if (next === decoded) break; decoded = next; if (pass === 15) throw new Error("escaping depth"); } } catch { throw new CanonicalWireError("path", "invalid escaping"); }
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
    if (["queryDomain", "getDomain", "getOpenApi", "getExplorerMetadata", "getDomainCatalog", "getRootPredicateFeatures", "getNestedDetailFeatures"].includes(route.operation_id)) safePath(route.path);
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
  async function request(path, init = {}, selected = undefined) {
    const headers = new Headers(typeof options.headers === "function" ? options.headers() : options.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) headers.set("content-type", "application/json");
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    const response = await transport(safePath(path), {...init, headers, credentials: "same-origin", redirect: "error"});
    const payload = await response.arrayBuffer().then((bytes) => parseStrictJSON(new TextDecoder("utf-8", {fatal:true,ignoreBOM:!!selected}).decode(bytes), {maxBytes: selected ? (response.ok ? 262144 : 8192) : Number.POSITIVE_INFINITY, tokens: !!selected})).catch((error) => {
      if (error?.name === "AbortError") throw error;
      throw new CanonicalWireError("response", "server did not return JSON");
    });
    const decoded = selected ? payload.value : payload;
    if (!response.ok) {
      if (selected?.context) assertNestedDetailError(decoded, selected.context, response.status);
      throw new CanonicalHttpError(response.status, assertError(decoded));
    }
    return {payload:decoded, ...(selected ? {numberTokens:payload.numberTokens} : {}), status: response.status, statusText: response.statusText, headers: response.headers};
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
    async nestedDetailFeatures(manifest, signal) {
      assertManifest(manifest);
      if (!manifest.profiles.includes("remote_query.v1")) throw new CanonicalWireError("manifest.profiles", "nested detail unavailable");
      const result = await request(routePath(manifest, "getNestedDetailFeatures", "GET"), {signal}, {featuresOnly:true});
      for (const path of ["/format_version","/request_format_version","/result/format_version"]) if (result.numberTokens.get(path) !== "1") throw new CanonicalWireError("nested.features", "lexical version1 required");
      return assertNestedDetailFeatures(result.payload);
    },
    async queryNestedDetail(manifest, query, requestOptions = {}) {
      const envelope = buildNestedDetailRequest(requestOptions.context?.fingerprint, query, requestOptions);
      return this.queryNestedDetailText(manifest, JSON.stringify(envelope), requestOptions);
    },
    async queryNestedDetailText(manifest, text, requestOptions = {}) {
      assertManifest(manifest);
      if (!manifest.profiles.includes("remote_query.v1") || manifest.domain.fingerprint !== requestOptions.context?.fingerprint) throw new CanonicalWireError("manifest", "nested profile/binding unavailable");
      routePath(manifest, "getNestedDetailFeatures", "GET");
      const parsed = parseNestedDetailRequestText(text, requestOptions);
      const context = nestedDetailContext(requestOptions.features);
      const result = await request(routePath(manifest, "queryDomain", "POST"), {method:"POST",body:parsed.raw,signal:requestOptions.signal,headers:{"Selecto-Nested-Detail-Context":encodeNestedDetailContext(context)}}, {context});
      assertNestedDetailResult(result.payload, {features:requestOptions.features,context,query:parsed.request.query,numberTokens:result.numberTokens});
      if (result.payload.meta.request_id !== parsed.request.request_id) throw new CanonicalWireError("nested.meta.request_id", "request ID echo mismatch");
      return result.payload;
    },
    async rootPredicateFeatures(manifest, signal) {
      if (!manifest.profiles.includes("remote_query.v2")) throw new CanonicalWireError("manifest.profiles", "remote_query.v2 unavailable");
      return assertRootPredicateFeatures((await request(routePath(manifest,"getRootPredicateFeatures","GET"), {signal})).payload);
    },
    async queryRootPredicate(manifest, query, requestOptions = {}) {
      const envelope = buildRootPredicateRequest(requestOptions.fingerprint ?? manifest.domain.fingerprint,query,requestOptions);
      return this.queryText(manifest,JSON.stringify(envelope),requestOptions);
    },
    async queryText(manifest, text, requestOptions = {}) {
      const parsed = parseCanonicalRequestText(text,{manifest,features:requestOptions.features});
      const result = await request(routePath(manifest,"queryDomain","POST"),{method:"POST",body:parsed.raw,signal:requestOptions.signal});
      if (parsed.request.format_version === 2) assertRootPredicateResult(result.payload,{fingerprint:parsed.request.domain.fingerprint,query:parsed.request.query,features:requestOptions.features});
      else assertQueryResult(result.payload,parsed.request.domain.fingerprint,parsed.request.query);
      return result.payload;
    },
    request,
  };
}

/** Unicode scalar validation, without replacing malformed UTF-16. */
export function assertUnicode(value, path = "string", maximum = Infinity, allowNul = false) {
  if (typeof value !== "string") throw new CanonicalWireError(path, "expected a string");
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new CanonicalWireError(path, "unpaired UTF-16 surrogate");
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new CanonicalWireError(path, "unpaired UTF-16 surrogate");
  }
  if (!allowNul && value.includes("\0")) throw new CanonicalWireError(path, "NUL is unavailable");
  if (new TextEncoder().encode(value).length > maximum) throw new CanonicalWireError(path, "UTF-8 byte limit exceeded", "utf8-byte-limit");
  return value;
}

/** Parse structure once, reject decoded duplicate keys, and retain numeric lexemes. */
export function parseStrictJSON(text, options = {}) {
  assertUnicode(text, "JSON", options.maxBytes ?? 1048576, true);
  let at = 0;
  const numberTokens = new Map();
  const fail = (message) => { throw new CanonicalWireError("JSON", `${message} at character ${at}`); };
  const space = () => { while (/[\t\n\r ]/.test(text[at] ?? "x")) at++; };
  function string() {
    const start = at++;
    while (at < text.length) {
      const c = text[at++];
      if (c === '"') {
        let value;
        try { value = JSON.parse(text.slice(start, at)); } catch { fail("invalid string"); }
        assertUnicode(value, "JSON string", Infinity, true);
        return value;
      }
      if (c === "\\") at++;
    }
    fail("unterminated string");
  }
  function value(path, depth) {
    if (depth > 128) fail("JSON nesting limit exceeded");
    space(); const c = text[at];
    if (c === '"') return string();
    if (c === "{") {
      at++; space(); const result = {}; const seen = new Set();
      if (text[at] === "}") {at++; return result;}
      while (true) {
        space(); if (text[at] !== '"') fail("object key required");
        const key = string(); if (seen.has(key)) fail(`duplicate key ${JSON.stringify(key)}`); seen.add(key);
        space(); if (text[at++] !== ":") fail("colon required");
        Object.defineProperty(result, key, {value: value(`${path}/${key.replace(/~/g,"~0").replace(/\//g,"~1")}`, depth + 1), enumerable:true, writable:true, configurable:true});
        space(); const next = text[at++]; if (next === "}") return result; if (next !== ",") fail("comma required");
      }
    }
    if (c === "[") {
      at++; space(); const result = []; if (text[at] === "]") {at++; return result;}
      while (true) {
        result.push(value(`${path}/${result.length}`, depth + 1)); space(); const next = text[at++];
        if (next === "]") return result; if (next !== ",") fail("comma required");
      }
    }
    for (const [literal, decoded] of [["true",true],["false",false],["null",null]]) if (text.startsWith(literal, at)) {at += literal.length; return decoded;}
    const token = text.slice(at).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);
    if (!token) fail("value required");
    at += token[0].length; numberTokens.set(path, token[0]);
    const decoded = Number(token[0]); if (!Number.isFinite(decoded)) fail("non-finite number"); return decoded;
  }
  const decoded = value("", 0); space(); if (at !== text.length) fail("unexpected trailing input");
  return options.tokens ? {value: decoded, numberTokens} : decoded;
}

const rootOps = ["eq", "ne", "gt", "gte", "lt", "lte", "is_null", "is_not_null"];
const rootLimits = {max_limit:100, default_limit:100, max_offset:100000, default_offset:0, max_nodes:20, max_depth:4, root_depth:1, max_select:100, max_orders:10, max_string_utf8_bytes:16384, max_raw_request_bytes:1048576};
const rootSupports = {where:true, and:true, or:true, flat_filters:false, nested:false, not:false, ranges:false, named_definitions:false, analytics:false};
function exactKeys(value, required, path) {
  keys(value, required, path);
  if (required.some((key) => !Object.hasOwn(value, key))) throw new CanonicalWireError(path, "missing required member");
}
function rootPair(field, path) {
  const allowed = {integer:["json","decimal-string"],decimal:["decimal-string"],string:["string"],boolean:["json"],date:["string"]};
  if (!allowed[field.type]?.includes(field.encoding)) throw new CanonicalWireError(path, "unsupported type/encoding pair");
  if (typeof field.nullable !== "boolean") throw new CanonicalWireError(path, "nullable must be boolean");
}
export function canonicalRootFields(domain) {
  record(domain?.source?.columns, "domain.source.columns");
  return array(domain.source.fields, "domain.source.fields").map((path) => {
    const column = record(domain.source.columns[path], `domain.source.columns.${path}`);
    const type = ({int:"integer",bigint:"integer",text:"string",varchar:"string",numeric:"decimal",bool:"boolean"})[column.type] ?? column.type;
    return {path, type, encoding: column.encoding ?? ({integer:"json",decimal:"decimal-string",boolean:"json",string:"string",date:"string"})[type], nullable: column.nullable ?? false};
  });
}

export function assertRootPredicateFeatures(value, context) {
  exactKeys(value, ["format","format_version","domain","profile","revision","wire_profile","request_format_version","result","fields","default_select","limits","supports"], "features");
  format(value, "selecto.root-predicate-features", "features");
  if (value.profile !== "canonical_root_predicates.v1" || value.wire_profile !== "remote_query.v2" || value.request_format_version !== 2) throw new CanonicalWireError("features.profile", "unsupported root predicate profile");
  assertUnicode(nonEmptyString(value.revision, "features.revision"), "features.revision");
  exactKeys(value.domain, ["id","fingerprint","publication"], "features.domain");
  Object.values(value.domain).forEach((item) => assertUnicode(nonEmptyString(item,"features.domain"),"features.domain"));
  exactKeys(value.result, ["format","format_version"], "features.result"); format(value.result,"selecto.remote-query-result","features.result");
  for (const [name, expected] of [["limits",rootLimits],["supports",rootSupports]]) {
    exactKeys(value[name],Object.keys(expected),`features.${name}`);
    for (const [key, wanted] of Object.entries(expected)) if (value[name][key] !== wanted) throw new CanonicalWireError(`features.${name}.${key}`, "unsupported capability or bound");
  }
  const ids = new Set(), paths = new Set();
  const fields = array(value.fields,"features.fields"); if (!fields.length) throw new CanonicalWireError("features.fields","empty fields");
  fields.forEach((field, i) => {
    const path = `features.fields.${i}`;
    exactKeys(field,["id","path","label","type","encoding","nullable","operators"],path);
    assertUnicode(nonEmptyString(field.id,`${path}.id`),`${path}.id`,16384);
    assertUnicode(nonEmptyString(field.label,`${path}.label`),`${path}.label`,16384);
    if (typeof field.path !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(field.path)) throw new CanonicalWireError(`${path}.path`,"expected public root path");
    rootPair(field,path);
    const ops = array(field.operators,`${path}.operators`);
    const supported = field.type === "boolean" ? ["eq","ne","is_null","is_not_null"] : rootOps;
    if (!ops.length || new Set(ops).size !== ops.length || ops.some((op) => !supported.includes(op))) throw new CanonicalWireError(`${path}.operators`,"unsupported operators");
    if (ids.has(field.id) || paths.has(field.path)) throw new CanonicalWireError(path,"duplicate field ID or path"); ids.add(field.id); paths.add(field.path);
  });
  const selected = array(value.default_select,"features.default_select");
  if (!selected.length || selected.length > 100 || new Set(selected).size !== selected.length || selected.some((id) => !ids.has(id))) throw new CanonicalWireError("features.default_select","unresolved or duplicate default selection");
  if (context) {
    const expected = context.domain ?? context.metadata?.domain;
    if (!expected || ["id","fingerprint","publication"].some((key) => expected[key] !== value.domain[key])) throw new CanonicalWireError("features.domain","publication binding mismatch");
    if ((context.profile !== undefined && context.profile !== value.profile) || (context.revision !== undefined && context.revision !== value.revision)) throw new CanonicalWireError("features.revision","active feature binding mismatch");
    if (context.manifest && (!context.manifest.profiles.includes("remote_query.v2") || context.manifest.domain.fingerprint !== value.domain.fingerprint)) throw new CanonicalWireError("features.domain","manifest binding mismatch");
    const published = context.canonical_fields ?? (context.canonicalDomain ? canonicalRootFields(context.canonicalDomain) : undefined);
    if (!published) throw new CanonicalWireError("features.fields","canonical field context required");
    const byPath = new Map(published.map((field) => [field.path,field]));
    fields.forEach((field) => {
      const actual = byPath.get(field.path);
      if (!actual || ["type","encoding","nullable"].some((key) => actual[key] !== field[key])) throw new CanonicalWireError("features.fields","canonical path/type/codec binding mismatch");
    });
  }
  return value;
}

export function assertRootScalar(value, field, path = "value", author = false) {
  rootPair(field,path);
  if (typeof value === "string") assertUnicode(value,path,16384);
  if (author && typeof value !== "string" && typeof value !== "boolean") throw new CanonicalWireError(path,"author scalar must be typed text or boolean");
  let valid = false;
  if (field.type === "integer") {
    if (typeof value === "number") valid = Number.isSafeInteger(value);
    else if (typeof value === "string" && /^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(value)) {
      const exact = BigInt(value); valid = exact >= -9223372036854775808n && exact <= 9223372036854775807n;
    }
  } else if (field.type === "decimal") valid = typeof value === "number" ? Number.isSafeInteger(value) : typeof value === "string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value);
  else if (field.type === "boolean") valid = typeof value === "boolean";
  else if (field.type === "string") valid = typeof value === "string";
  else if (field.type === "date") valid = typeof value === "string" && !value.startsWith("0000-") && validDate(value);
  if (!valid) throw new CanonicalWireError(path,`invalid exact ${field.type} scalar`);
  return value;
}

export function assertRootPredicateQuery(query, features, options = {}) {
  assertRootPredicateFeatures(features);
  keys(query,["select","where","order_by","limit","offset","timezone","row_format"],"query");
  const byPath = new Map(features.fields.map((field) => [field.path,field]));
  const selected = array(query.select,"query.select");
  if (!selected.length || selected.length > 100 || new Set(selected).size !== selected.length || selected.some((path) => !byPath.has(path))) throw new CanonicalWireError("query.select","unresolved, duplicate or excessive root selection");
  let count = 0;
  function node(value, depth, path) {
    record(value,path); if (++count > 20 || depth > 4) throw new CanonicalWireError(path,"predicate node/depth bound exceeded");
    const group = ["and","or"].filter((key) => Object.hasOwn(value,key));
    if (group.length) {
      exactKeys(value,group.length === 1 ? group : [],path);
      const children = array(value[group[0]],path); if (!children.length) throw new CanonicalWireError(path,"empty executable group");
      children.forEach((child,i) => node(child,depth+1,`${path}/${group[0]}/${i}`)); return;
    }
    const nullOp = ["is_null","is_not_null"].includes(value.op);
    exactKeys(value,nullOp ? ["field","op"] : ["field","op","value"],path);
    const field = byPath.get(value.field); if (!field) throw new CanonicalWireError(path,"unresolved root field");
    if (!field.operators.includes(value.op)) throw new CanonicalWireError(path,"operator unavailable for field");
    if (!nullOp) {
      assertRootScalar(value.value,field,`${path}/value`);
      const token = options.numberTokens?.get(`${path}/value`);
      if (token && !/^-?(?:0|[1-9]\d*)$/.test(token)) throw new CanonicalWireError(path,"fraction/exponent numeric token unavailable");
    }
  }
  if (Object.hasOwn(query,"where")) node(query.where,1,"/query/where");
  if (Object.hasOwn(query,"order_by")) {
    const orders = array(query.order_by,"query.order_by"); if (orders.length > 10) throw new CanonicalWireError("query.order_by","order bound exceeded");
    const seen = new Set(); orders.forEach((order) => {exactKeys(order,["field","direction"],"order"); if (!byPath.has(order.field) || seen.has(order.field) || !["asc","desc"].includes(order.direction)) throw new CanonicalWireError("order","invalid or duplicate root order"); seen.add(order.field);});
  }
  for (const [key,max,min] of [["limit",100,1],["offset",100000,0]]) if (Object.hasOwn(query,key)) {
    integer(query[key],`query.${key}`,min); if (query[key] > max) throw new CanonicalWireError(`query.${key}`,"paging bound exceeded");
    const token = options.numberTokens?.get(`/query/${key}`); if (token && !/^(?:0|[1-9]\d*)$/.test(token)) throw new CanonicalWireError(`query.${key}`,"integer token required");
  }
  if (Object.hasOwn(query,"row_format")) oneOf(query.row_format,["arrays","objects"],"query.row_format");
  if (Object.hasOwn(query,"timezone")) assertTimezone(query.timezone);
  return query;
}
export function assertTimezone(value) {
  assertUnicode(nonEmptyString(value,"timezone"),"timezone",16384);
  try { new Intl.DateTimeFormat("en-US",{timeZone:value}); } catch { throw new CanonicalWireError("timezone","unknown IANA timezone"); }
  return value;
}
function assertRootRequestId(value) {
  assertUnicode(nonEmptyString(value,"request_id"),"request_id",128);
  if (/[\r\n]/.test(value)) throw new CanonicalWireError("request_id","line breaks unavailable");
}
export function buildRootPredicateRequest(fingerprint, query, options = {}) {
  assertUnicode(nonEmptyString(fingerprint,"domain.fingerprint"),"domain.fingerprint");
  if (!options.features) throw new CanonicalWireError("features","root feature context required");
  assertRootPredicateQuery(query,options.features);
  const request = {format:"selecto.remote-query",format_version:2,domain:{fingerprint},query};
  if (options.requestId !== undefined) {assertRootRequestId(options.requestId); request.request_id = options.requestId;}
  parseStrictJSON(JSON.stringify(request));
  return request;
}
export function parseCanonicalRequestText(text, context) {
  const {value,numberTokens} = parseStrictJSON(text,{tokens:true});
  exactKeys(value,Object.hasOwn(value,"request_id") ? ["format","format_version","domain","query","request_id"] : ["format","format_version","domain","query"],"request");
  if (value.format !== "selecto.remote-query") throw new CanonicalWireError("request.format","remote envelope required");
  exactKeys(value.domain,["fingerprint"],"request.domain"); assertUnicode(nonEmptyString(value.domain.fingerprint,"request.domain.fingerprint"),"request.domain.fingerprint");
  if (value.request_id !== undefined) assertRootRequestId(value.request_id);
  if (value.format_version === 2) {
    if (numberTokens.get("/format_version") !== "2" || !context.manifest?.profiles.includes("remote_query.v2")) throw new CanonicalWireError("request.format_version","root v2 unavailable or noninteger token");
    if (!context.features) throw new CanonicalWireError("features","root features unavailable");
    assertRootPredicateQuery(value.query,context.features,{numberTokens});
  } else if (value.format_version === 1) buildRemoteRequest(value.domain.fingerprint,value.query,value.request_id);
  else throw new CanonicalWireError("request.format_version","unsupported protocol version");
  return {request:value,raw:text};
}
export function assertRootPredicateResult(value, context) {
  const {fingerprint,query,features} = context;
  assertQueryResult(value,fingerprint,query);
  const byPath = new Map(features.fields.map((field) => [field.path,field]));
  if (value.data.columns.length !== query.select.length) throw new CanonicalWireError("response.columns","selection width mismatch");
  value.data.columns.forEach((column,i) => {
    const field = byPath.get(query.select[i]);
    if (!field || column.id !== field.path || column.field !== field.path || column.label !== field.label || column.type !== field.type || column.nullable !== field.nullable || !(column.encoding === field.encoding || (field.type === "integer" && field.encoding === "json" && column.encoding === "decimal-string"))) throw new CanonicalWireError("response.columns","selection/type/codec binding mismatch");

  });
  if (value.data.page.limit !== (query.limit ?? 100) || value.data.page.offset !== (query.offset ?? 0)) throw new CanonicalWireError("response.page","effective page mismatch");
  return value;
}

// Selected complete typed nested detail is separate from generic v1 and root v2.
const nestedLimits = {max_request_bytes:1048576,max_header_ascii_bytes:8192,max_context_token_utf8_bytes:1024,max_field_id_path_label_utf8_bytes:256,max_request_id_utf8_bytes:128,default_parent_limit:25,min_parent_limit:1,max_parent_limit:25,max_offset:100000,max_root_fields:20,max_child_fields:20,max_filters:20,max_orders:10,max_collections:1,max_children_per_parent:20,max_returned_children:500,max_scalar_utf8_bytes:16384,max_preaggregate_projected_json_bytes:1048576,max_response_entity_bytes:262144};
const nestedSupports = {row_formats:["arrays","objects"],complete_children:true,root_filters:"flat-and",child_filtering:false,child_ordering:"fixed-public-pk-asc",root_required_order:false,root_boolean:false,partial_children:false};
function nestedText(value, path, max = 1024) {
  assertUnicode(nonEmptyString(value,path),path,max);
  if (/[\r\n]/.test(value)) throw new CanonicalWireError(path,"line breaks unavailable");
  return value;
}
function nestedField(field,path,child=false) {
  exactKeys(field,child ? ["id","path","label","type","encoding","nullable"] : ["id","path","label","type","encoding","nullable","operators"],path);
  for (const key of ["id","path","label"]) nestedText(field[key],`${path}.${key}`,256);
  if (!(child ? /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/ : /^[A-Za-z_][A-Za-z0-9_]*$/).test(field.path)) throw new CanonicalWireError(path,"invalid public path");
  rootPair(field,path);
  if (!child) {
    const expected = field.type === "boolean" ? ["eq","ne","is_null","is_not_null"] : rootOps;
    if (JSON.stringify(field.operators) !== JSON.stringify(expected)) throw new CanonicalWireError(path,"unsupported operator inventory");
  }
}
export function assertNestedDetailFeatures(value, discovered) {
  exactKeys(value,["format","format_version","profile","revision","wire_profile","request_format_version","result","domain","root_primary_key","root_fields","collections","defaults","limits","supports"],"nested.features");
  format(value,"selecto.nested-detail-features","nested.features");
  if (value.profile !== "canonical_nested_detail.v1" || value.wire_profile !== "remote_query.v1" || value.request_format_version !== 1) throw new CanonicalWireError("nested.features","unsupported selected profile");
  nestedText(value.revision,"nested.features.revision");
  exactKeys(value.domain,["id","fingerprint","publication"],"nested.features.domain");
  for (const key of Object.keys(value.domain)) nestedText(value.domain[key],`nested.features.domain.${key}`);
  exactKeys(value.result,["format","format_version"],"nested.features.result");format(value.result,"selecto.remote-query-result","nested.features.result");
  for (const [key,expected] of [["limits",nestedLimits],["supports",nestedSupports]]) {
    exactKeys(value[key],Object.keys(expected),`nested.features.${key}`);
    for (const [name,wanted] of Object.entries(expected)) if (Array.isArray(wanted) ? JSON.stringify(value[key][name])!==JSON.stringify(wanted) : value[key][name]!==wanted) throw new CanonicalWireError(`nested.features.${key}.${name}`,"unsupported bound/capability");
  }
  const roots=array(value.root_fields,"nested.root_fields"), collections=array(value.collections,"nested.collections");
  if (!roots.length || roots.length>20 || collections.length!==1) throw new CanonicalWireError("nested.features","root/collection bounds");
  const ids=new Set(),paths=new Set();
  const add=(field,path,child=false)=> {nestedField(field,path,child); if(ids.has(field.id)||paths.has(field.path)) throw new CanonicalWireError(path,"duplicate ID/path");ids.add(field.id);paths.add(field.path);};
  roots.forEach((f,i)=>add(f,`nested.root_fields.${i}`));
  const rootPK=roots.find(f=>f.path===value.root_primary_key);
  if (!rootPK || rootPK.type!=="integer" || rootPK.nullable) throw new CanonicalWireError("nested.root_primary_key","published nonnull integer PK required");
  const collection=collections[0];exactKeys(collection,["id","path","result_id","label","primary_key","order_by","fields","default_select","limit","complete"],"nested.collection");
  for (const key of ["id","path","result_id","label","primary_key"]) nestedText(collection[key],`nested.collection.${key}`,256);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(collection.path)||collection.result_id!==collection.path||paths.has(collection.path)||ids.has(collection.id)||collection.limit!==20||collection.complete!==true) throw new CanonicalWireError("nested.collection","invalid complete collection");
  ids.add(collection.id);paths.add(collection.path);
  const children=array(collection.fields,"nested.collection.fields");if(!children.length||children.length>20) throw new CanonicalWireError("nested.collection.fields","child field bound");
  children.forEach((f,i)=>{add(f,`nested.collection.fields.${i}`,true);if(f.path.split(".")[0]!==collection.path) throw new CanonicalWireError("nested.collection.fields","foreign child scope");});
  const childPK=children.find(f=>f.path===collection.primary_key);
  const fixedOrder=array(collection.order_by,"nested.collection.order_by");
  if(fixedOrder.length!==1) throw new CanonicalWireError("nested.collection.order_by","one fixed child order required");
  exactKeys(fixedOrder[0],["field","direction"],"nested.collection.order_by.0");
  if(!childPK||childPK.type!=="integer"||childPK.nullable||fixedOrder[0].field!==collection.primary_key||fixedOrder[0].direction!=="asc") throw new CanonicalWireError("nested.collection.primary_key","published nonnull integer PK/fixed order required");
  const childPaths=new Set(children.map(f=>f.path));const defaults=array(collection.default_select,"nested.collection.default_select");
  if(!defaults.length||defaults.length>20||new Set(defaults).size!==defaults.length||defaults.some(p=>!childPaths.has(p))) throw new CanonicalWireError("nested.collection.default_select","unpublished/duplicate default");
  exactKeys(value.defaults,["select","limit","offset","row_format"],"nested.defaults");
  if(value.defaults.limit!==25||value.defaults.offset!==0||value.defaults.row_format!=="arrays") throw new CanonicalWireError("nested.defaults","unsupported default page/format");
  nestedSelection(value.defaults.select,value);
  // A valid sidecar must be selectable within the whole context-header bound.
  encodeNestedDetailContext({profile:value.profile,fingerprint:value.domain.fingerprint,publication:value.domain.publication,revision:value.revision});
  if (discovered) {
    const domain=discovered.domain ?? (discovered.entry && {id:discovered.entry.id,publication:discovered.entry.publication,fingerprint:discovered.manifest?.domain.fingerprint});
    if (!domain || ["id","publication","fingerprint"].some(k=>domain[k]!==value.domain[k])) throw new CanonicalWireError("nested.features.domain","current publication mismatch");
    const manifest=discovered.manifest;
    if (!manifest || !manifest.profiles.includes("remote_query.v1") || manifest.domain.fingerprint!==value.domain.fingerprint) throw new CanonicalWireError("nested.features","manifest binding required");
    assertManifest(manifest);routePath(manifest,"getNestedDetailFeatures","GET");
    const canonicalDomain=discovered.canonicalDomain;assertDomain(canonicalDomain,value.domain.fingerprint);
    const published=canonicalRootFields(canonicalDomain);const map=new Map(published.map(f=>[f.path,f]));
    for(const field of roots){const actual=map.get(field.path);if(!actual||["type","encoding","nullable"].some(k=>actual[k]!==field[k])) throw new CanonicalWireError("nested.root_fields","canonical path/type/codec mismatch");}
  }
  return value;
}
function nestedSelection(selected,features) {
  array(selected,"nested.select");const rootPaths=new Set(features.root_fields.map(f=>f.path));const childPaths=new Set(features.collections[0].fields.map(f=>f.path));const roots=new Set();let child=null;
  for(const slot of selected){
    if(Array.isArray(slot)) {if(child!==null||!slot.length||slot.length>20||new Set(slot).size!==slot.length||slot.some(p=>!childPaths.has(p))) throw new CanonicalWireError("nested.select","invalid child selection");child=slot;}
    else {if(!rootPaths.has(slot)||roots.has(slot)) throw new CanonicalWireError("nested.select","unpublished/duplicate root selection");roots.add(slot);}
  }
  if(!roots.size||roots.size>20||child===null) throw new CanonicalWireError("nested.select","root and exactly one collection required");
  return child;
}
export function nestedDetailContext(features) {
  assertNestedDetailFeatures(features);
  return {profile:features.profile,fingerprint:features.domain.fingerprint,publication:features.domain.publication,revision:features.revision};
}
function assertNestedContext(context,features) {
  exactKeys(context,["profile","fingerprint","publication","revision"],"nested.context");for(const key of Object.keys(context))nestedText(context[key],`nested.context.${key}`);
  const expected=nestedDetailContext(features);if(Object.keys(expected).some(k=>context[k]!==expected[k])) throw new CanonicalWireError("nested.context","stale nested detail context");
}
export function encodeNestedDetailContext(context) {
  exactKeys(context,["profile","fingerprint","publication","revision"],"nested.context");
  if(context.profile!=="canonical_nested_detail.v1") throw new CanonicalWireError("nested.context","unknown profile");
  for(const key of Object.keys(context))nestedText(context[key],`nested.context.${key}`);
  const bytes=new TextEncoder().encode(JSON.stringify(context));let binary="";for(const byte of bytes)binary+=String.fromCharCode(byte);
  const encoded=btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/,"");if(encoded.length>8192)throw new CanonicalWireError("nested.context","header limit");return encoded;
}
function nestedIntegerText(value) {return typeof value==="string"&&/^(?:0|[1-9]\d*|-[1-9]\d*)$/.test(value)&&value.length<=20&&BigInt(value)>=-9223372036854775808n&&BigInt(value)<=9223372036854775807n;}
export function assertNestedDetailScalar(value,field,path="nested.scalar",options={}) {
  rootPair(field,path);
  if(value===null){if(options.author||!field.nullable)throw new CanonicalWireError(path,"unexpected null");return value;}
  if(typeof value==="string")assertUnicode(value,path,16384);
  let valid=false;
  if(field.type==="integer") {
    valid=options.author ? nestedIntegerText(value) : field.encoding==="json" ? Number.isSafeInteger(value) : nestedIntegerText(value);
    if(typeof value==="number"&&options.numberToken!==undefined&&!/^-?(?:0|[1-9]\d*)$/.test(options.numberToken))valid=false;
  } else if(field.type==="decimal") {
    const pattern=options.author ? /^-?(?:0|[1-9]\d{0,31})(?:\.\d{1,6})?$/ : /^-?(?:0|[1-9]\d{0,31})\.\d{6}$/;
    valid=typeof value==="string"&&pattern.test(value);
  } else if(field.type==="boolean")valid=typeof value==="boolean";
  else if(field.type==="date")valid=typeof value==="string"&&!value.startsWith("0000-")&&validDate(value);
  else if(field.type==="string")valid=typeof value==="string";
  if(!valid)throw new CanonicalWireError(path,`invalid nested ${field.type}/${field.encoding}`);return value;
}
export function assertNestedDetailQuery(query,features,options={}) {
  assertNestedDetailFeatures(features);keys(query,["select","filters","order_by","limit","offset","row_format","timezone"],"nested.query");nestedSelection(query.select,features);
  const byPath=new Map(features.root_fields.map(f=>[f.path,f]));
  if(Object.hasOwn(query,"filters")) {
    const filters=array(query.filters,"nested.filters");if(filters.length>20)throw new CanonicalWireError("nested.filters","filter bound");
    filters.forEach((f,i)=>{const nullOp=["is_null","is_not_null"].includes(f?.op);exactKeys(f,nullOp?["field","op"]:["field","op","value"],`nested.filters.${i}`);const field=byPath.get(f.field);if(!field||!field.operators.includes(f.op))throw new CanonicalWireError("nested.filters","unpublished field/operator");
      if(!nullOp){if(typeof f.value==="number"){if(!["integer","decimal"].includes(field.type)||!Number.isSafeInteger(f.value))throw new CanonicalWireError("nested.filters","unsafe/nonnumeric integer");const token=options.numberTokens?.get(`/query/filters/${i}/value`);if(token!==undefined&&!/^-?(?:0|[1-9]\d*)$/.test(token))throw new CanonicalWireError("nested.filters","noninteger numeric token");}else assertNestedDetailScalar(f.value,field,`nested.filters.${i}.value`,{author:true});}});
  }
  if(Object.hasOwn(query,"order_by")) {const orders=array(query.order_by,"nested.order_by"),seen=new Set();if(orders.length>10)throw new CanonicalWireError("nested.order_by","order bound");orders.forEach(o=>{exactKeys(o,["field","direction"],"nested.order");if(!byPath.has(o.field)||seen.has(o.field)||!["asc","desc"].includes(o.direction))throw new CanonicalWireError("nested.order","invalid/duplicate root order");seen.add(o.field);});}
  for(const [key,min,max] of [["limit",1,25],["offset",0,100000]])if(Object.hasOwn(query,key)){integer(query[key],`nested.query.${key}`,min);if(query[key]>max)throw new CanonicalWireError(key,"page bound");const token=options.numberTokens?.get(`/query/${key}`);if(token!==undefined&&!/^(?:0|[1-9]\d*)$/.test(token))throw new CanonicalWireError(key,"noninteger page token");}
  if(Object.hasOwn(query,"row_format"))oneOf(query.row_format,["arrays","objects"],"nested.row_format");if(Object.hasOwn(query,"timezone"))assertTimezone(query.timezone);return query;
}
function nestedRequestId(value){nestedText(value,"nested.request_id",128);if(/[\u0000-\u001f\u007f]/.test(value))throw new CanonicalWireError("nested.request_id","control unavailable");}
export function buildNestedDetailRequest(fingerprint,query,options={}) {
  assertNestedContext(options.context,options.features);if(fingerprint!==options.context.fingerprint)throw new CanonicalWireError("nested.fingerprint","context/body mismatch");assertNestedDetailQuery(query,options.features);
  const request={format:"selecto.remote-query",format_version:1,domain:{fingerprint},query};if(options.requestId!==undefined){nestedRequestId(options.requestId);request.request_id=options.requestId;}parseStrictJSON(JSON.stringify(request));return request;
}
export function parseNestedDetailRequestText(text,options) {
  const {value,numberTokens}=parseStrictJSON(text,{tokens:true,maxBytes:1048576});
  exactKeys(value,Object.hasOwn(value,"request_id")?["format","format_version","domain","query","request_id"]:["format","format_version","domain","query"],"nested.request");
  if(value.format!=="selecto.remote-query"||value.format_version!==1||numberTokens.get("/format_version")!=="1")throw new CanonicalWireError("nested.request","lexical version1 required");
  exactKeys(value.domain,["fingerprint"],"nested.request.domain");assertNestedContext(options.context,options.features);
  if(value.domain.fingerprint!==options.context.fingerprint)throw new CanonicalWireError("nested.request.domain","stale context/body binding");if(Object.hasOwn(value,"request_id"))nestedRequestId(value.request_id);
  assertNestedDetailQuery(value.query,options.features,{numberTokens});return {request:value,raw:text,numberTokens};
}
function nestedEcho(meta,context,required) {
  if(meta===undefined){if(required)throw new CanonicalWireError("nested.meta","context required");return;}
  keys(meta,["selecto_nested_detail","request_id"],"nested.meta");if(Object.hasOwn(meta,"request_id"))nestedRequestId(meta.request_id);
  if(Object.hasOwn(meta,"selecto_nested_detail")){exactKeys(meta.selecto_nested_detail,["profile","fingerprint","publication","revision"],"nested.meta.context");if(Object.keys(context).some(k=>meta.selecto_nested_detail[k]!==context[k]))throw new CanonicalWireError("nested.meta.context","context drift");}
  else if(required)throw new CanonicalWireError("nested.meta.context","missing admitted context");
}
function assertNestedDetailError(value,context,status) {
  exactKeys(value,Object.hasOwn(value,"meta")?["ok","error","meta"]:["ok","error"],"nested.error");assertError(value);exactKeys(value.error,["code","message","details"],"nested.error.error");exactKeys(value.error.details,[],"nested.error.details");oneOf(value.error.code,["malformed_request","operation_unsupported","stale_domain_fingerprint","stale_nested_detail_context","invalid_query","internal_failure","authentication_required","hidden_field"],"nested.error.code");assertUnicode(value.error.message,"nested.error.message",512);
  const codeStatus={malformed_request:400,operation_unsupported:501,stale_domain_fingerprint:409,stale_nested_detail_context:409,invalid_query:422,internal_failure:500,authentication_required:401,hidden_field:403};if(status!==codeStatus[value.error.code])throw new CanonicalWireError("nested.error.status","code/status mismatch");nestedEcho(value.meta,context,false);
}
export function assertNestedDetailResult(value,{query,features,context,numberTokens}={}) {
  assertNestedDetailQuery(query,features);assertNestedContext(context,features);exactKeys(value,["ok","data","meta"],"nested.response");if(value.ok!==true)throw new CanonicalWireError("nested.response","success required");nestedEcho(value.meta,context,true);
  const d=value.data;exactKeys(d,["format","format_version","domain","columns","rows","row_count","page","row_format","subtables"],"nested.data");format(d,"selecto.remote-query-result","nested.data");exactKeys(d.domain,["fingerprint"],"nested.data.domain");if(d.domain.fingerprint!==context.fingerprint)throw new CanonicalWireError("nested.data.domain","fingerprint drift");
  const lexical=(path)=>{const t=numberTokens?.get(path);if(t!==undefined&&!/^(?:0|[1-9]\d*)$/.test(t))throw new CanonicalWireError(path,"lexical integer required");};
  for(const path of ["/data/format_version","/data/row_count","/data/page/limit","/data/page/offset","/data/subtables/"+features.collections[0].result_id+"/limit"])lexical(path);
  const collection=features.collections[0],children=nestedSelection(query.select,features);const roots=new Map(features.root_fields.map(f=>[f.path,f]));
  const cols=array(d.columns,"nested.columns");if(cols.length!==query.select.length)throw new CanonicalWireError("nested.columns","selection width");
  const childFields=children.map(p=>collection.fields.find(f=>f.path===p));
  cols.forEach((c,i)=>{exactKeys(c,["id","field","label","type","encoding","nullable"],`nested.columns.${i}`);const f=Array.isArray(query.select[i])?{path:collection.result_id,label:collection.label,type:"json",encoding:"json",nullable:false}:roots.get(query.select[i]);if(c.id!==f.path||c.field!==f.path||["label","type","encoding","nullable"].some(k=>c[k]!==f[k]))throw new CanonicalWireError("nested.columns","descriptor binding drift");});
  exactKeys(d.subtables,[collection.result_id],"nested.subtables");const sub=d.subtables[collection.result_id];exactKeys(sub,["columns","limit","complete"],"nested.subtable");if(JSON.stringify(sub.columns)!==JSON.stringify(children)||sub.limit!==20||sub.complete!==true)throw new CanonicalWireError("nested.subtable","selection/completeness drift");
  if(d.row_format!==(query.row_format??"arrays"))throw new CanonicalWireError("nested.row_format","request mismatch");
  const rows=array(d.rows,"nested.rows");integer(d.row_count,"nested.row_count");if(d.row_count!==rows.length)throw new CanonicalWireError("nested.row_count","row count mismatch");exactKeys(d.page,["limit","offset","has_more"],"nested.page");integer(d.page.limit,"nested.page.limit",1);integer(d.page.offset,"nested.page.offset");bool(d.page.has_more,"nested.page.has_more");if(d.page.limit!==(query.limit??25)||d.page.offset!==(query.offset??0)||rows.length>d.page.limit||rows.length>25)throw new CanonicalWireError("nested.page","request/page mismatch");
  const rowShape=(r,descs,path)=>{if(d.row_format==="arrays"){if(!Array.isArray(r)||r.length!==descs.length)throw new CanonicalWireError(path,"row width");}else exactKeys(r,descs.map(f=>f.path),path);};
  let total=0;
  rows.forEach((r,i)=>{rowShape(r,cols.map(c=>({path:c.id})),`nested.rows.${i}`);cols.forEach((c,j)=>{const v=d.row_format==="arrays"?r[j]:r[c.id],pointer=`/data/rows/${i}/${d.row_format==="arrays"?j:c.id}`;
    if(Array.isArray(query.select[j])){const childRows=array(v,"nested.children");if(childRows.length>20||(total+=childRows.length)>500)throw new CanonicalWireError("nested.children","complete child bound");childRows.forEach((cr,k)=>{rowShape(cr,childFields,`nested.children.${k}`);childFields.forEach((f,l)=>assertNestedDetailScalar(d.row_format==="arrays"?cr[l]:cr[f.path],f,`nested.children.${k}.${f.path}`,{numberToken:numberTokens?.get(`${pointer}/${k}/${d.row_format==="arrays"?l:f.path}`)}));});}
    else assertNestedDetailScalar(v,roots.get(c.field),`nested.rows.${i}.${c.id}`,{numberToken:numberTokens?.get(pointer)});
  });});return value;
}
