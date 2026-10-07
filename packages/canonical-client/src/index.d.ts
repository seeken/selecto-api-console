export interface ClientOptions { baseUrl?: string; catalogPath?: string; fetch?: typeof fetch; headers?: HeadersInit | (() => HeadersInit); }
export interface CatalogEntry { id: string; label: string; publication: string; manifest: string; explorer_metadata: string; }
export interface DomainCatalog { format: "selecto.domain-catalog"; format_version: 1; domains: CatalogEntry[]; }
export interface Manifest { format: "selecto.canonical-domain-api"; format_version: 1; domain: {fingerprint: string; name?: string; version?: string; schema_version?: number}; profiles: string[]; routes: Array<{method: string; operation_id: string; path: string}>; [key: string]: unknown; }
export type ColumnType = "integer" | "decimal" | "string" | "boolean" | "date" | "time" | "datetime" | "uuid" | "binary" | "json" | "unknown";
export interface Column {id: string; label: string; type: ColumnType; encoding: "json" | "string" | "decimal-string" | "rfc3339" | "base64"; nullable: boolean; field?: string;}
export interface RemoteQuery {select?: unknown[]; projection?: string | string[]; view?: string; filters?: Array<{field: string; op: string; value?: unknown; end?: unknown}>; order_by?: Array<{field: string; direction: "asc" | "desc"}>; row_format?: "arrays" | "objects"; limit?: number; offset?: number; timezone?: string; [key: string]: unknown;}
export interface RemoteRequest {format: "selecto.remote-query"; format_version: 1; domain: {fingerprint: string}; query: RemoteQuery; request_id?: string;}
export interface RemoteResult {ok: true; data: {format: "selecto.remote-query-result"; format_version: 1; domain: {fingerprint: string}; columns: Column[]; rows: unknown[][] | Array<Record<string, unknown>>; row_count: number; row_format?: "arrays" | "objects"; page: {limit: number; offset: number; has_more: boolean}; [key: string]: unknown}; meta?: {request_id?: string; [key: string]: unknown};}
export interface ErrorEnvelope {ok: false; error: {code: string; message: string; details: Record<string, unknown>}; meta?: {request_id?: string};}
export interface QueryOptions {signal?: AbortSignal; requestId?: string; fingerprint?: string;}
export interface CanonicalClient {baseUrl: string; catalog(signal?: AbortSignal): Promise<DomainCatalog>; manifest(path?: string, signal?: AbortSignal): Promise<Manifest>; domain(manifest: Manifest, signal?: AbortSignal): Promise<Record<string, unknown>>; metadata(path: string, signal?: AbortSignal): Promise<unknown>; query(manifest: Manifest, query: RemoteQuery, options?: QueryOptions): Promise<RemoteResult>; request(path: string, init?: RequestInit): Promise<{payload: unknown; status: number; statusText: string; headers: Headers}>;}
export class CanonicalWireError extends Error {code: string; path: string; constructor(path: string, message: string);}
export class CanonicalHttpError extends Error {status: number; code: string; details: Record<string, unknown>; requestId?: string; envelope: ErrorEnvelope; constructor(status: number, envelope: ErrorEnvelope);}
export function createCanonicalClient(options?: ClientOptions): CanonicalClient;
export function safePath(value: string): string;
export function record(value: unknown, path: string): Record<string, unknown>;
export function nonEmptyString(value: unknown, path: string): string;
export function integer(value: unknown, path: string, minimum?: number): number;
export function keys(value: unknown, allowed: string[], path: string): void;
export function assertCatalog(value: unknown): DomainCatalog;
export function assertManifest(value: unknown): Manifest;
export function assertError(value: unknown): ErrorEnvelope;
export function assertColumn(value: unknown, path?: string): Column;
export function assertScalar(value: unknown, column: Column, path: string): void;
export function assertQueryResult(value: unknown, fingerprint: string, query?: RemoteQuery): RemoteResult;
export function routePath(manifest: Manifest, operation: string, method: string): string;
export function buildRemoteRequest(fingerprint: string, query: RemoteQuery, requestId?: string): RemoteRequest;

export function assertDomain(value: unknown, fingerprint: string): Record<string, unknown>;
