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
export interface CanonicalClient {rootPredicateFeatures(manifest:Manifest,signal?:AbortSignal):Promise<RootPredicateFeatures>;queryRootPredicate(manifest:Manifest,query:RootPredicateQuery,options:QueryOptions & {features:RootPredicateFeatures}):Promise<RemoteResult>;queryText(manifest:Manifest,text:string,options?:QueryOptions & {features?:RootPredicateFeatures}):Promise<RemoteResult>;baseUrl: string; catalog(signal?: AbortSignal): Promise<DomainCatalog>; manifest(path?: string, signal?: AbortSignal): Promise<Manifest>; domain(manifest: Manifest, signal?: AbortSignal): Promise<Record<string, unknown>>; metadata(path: string, signal?: AbortSignal): Promise<unknown>; query(manifest: Manifest, query: RemoteQuery, options?: QueryOptions): Promise<RemoteResult>; request(path: string, init?: RequestInit): Promise<{payload: unknown; status: number; statusText: string; headers: Headers}>;}
export class CanonicalWireError extends Error {code: string; path: string; validationReason?: "utf8-byte-limit"; constructor(path: string, message: string, validationReason?: "utf8-byte-limit");}
export class CanonicalHttpError extends Error {status: number; code: string; details: Record<string, unknown>; requestId?: string; envelope: ErrorEnvelope; constructor(status: number, envelope: ErrorEnvelope);}
export type NestedDetailRefusalReason = "nested-unavailable" | "authentication-required" | "stale-nested-context" | "invalid-nested-intent" | "unpublished-field-id" | "closed-intent-violation" | "duplicate-state-slot" | "invalid-nested-state" | "state-limit" | "invalid-selected-raw";
export interface NestedDetailRefusal {reason: NestedDetailRefusalReason; family: NestedDetailRefusalReason;}
export function nestedDetailRefusal(error: unknown): NestedDetailRefusal | null;
export function markNestedDetailRefusal<T>(error: T, reason: NestedDetailRefusalReason): T;
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

export type RootPredicateOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "is_null" | "is_not_null";
export interface RootPredicateField {id:string; path:string; label:string; type:"integer"|"decimal"|"string"|"boolean"|"date"; encoding:"json"|"string"|"decimal-string"; nullable:boolean; operators:RootPredicateOperator[];}
export interface RootPredicateFeatures {format:"selecto.root-predicate-features";format_version:1;domain:{id:string;fingerprint:string;publication:string};profile:"canonical_root_predicates.v1";revision:string;wire_profile:"remote_query.v2";request_format_version:2;result:{format:"selecto.remote-query-result";format_version:1};fields:RootPredicateField[];default_select:string[];limits:{max_limit:100;default_limit:100;max_offset:100000;default_offset:0;max_nodes:20;max_depth:4;root_depth:1;max_select:100;max_orders:10;max_string_utf8_bytes:16384;max_raw_request_bytes:1048576};supports:{where:true;and:true;or:true;flat_filters:false;nested:false;not:false;ranges:false;named_definitions:false;analytics:false};}
export type RootPredicateWireNode = {and:RootPredicateWireNode[]} | {or:RootPredicateWireNode[]} | {field:string;op:"eq"|"ne"|"gt"|"gte"|"lt"|"lte";value:string|number|boolean} | {field:string;op:"is_null"|"is_not_null"};
export interface RootPredicateQuery {select:string[];where?:RootPredicateWireNode;order_by?:Array<{field:string;direction:"asc"|"desc"}>;limit?:number;offset?:number;timezone?:string;row_format?:"arrays"|"objects";}
export interface RootPredicateRequest {format:"selecto.remote-query";format_version:2;domain:{fingerprint:string};query:RootPredicateQuery;request_id?:string;}
export interface RootFeatureValidationContext {domain?:RootPredicateFeatures["domain"];profile?:string;revision?:string;manifest?:Manifest;metadata?:{domain:RootPredicateFeatures["domain"]};canonicalDomain?:Record<string,unknown>;canonical_fields?:Array<Pick<RootPredicateField,"path"|"type"|"encoding"|"nullable">>;}
export function assertUnicode(value:unknown,path?:string,maximum?:number,allowNul?:boolean):string;
export function parseStrictJSON(text:string,options?:{maxBytes?:number;tokens?:false}):unknown;
export function parseStrictJSON(text:string,options:{maxBytes?:number;tokens:true}):{value:any;numberTokens:Map<string,string>};
export function canonicalRootFields(domain:Record<string,unknown>):RootFeatureValidationContext["canonical_fields"];
export function assertRootPredicateFeatures(value:unknown,context?:RootFeatureValidationContext):RootPredicateFeatures;
export function assertRootScalar(value:unknown,field:Pick<RootPredicateField,"type"|"encoding"|"nullable">,path?:string,author?:boolean):unknown;
export function assertRootPredicateQuery(query:unknown,features:RootPredicateFeatures,options?:{numberTokens?:Map<string,string>}):RootPredicateQuery;
export function assertTimezone(value:unknown):string;
export function buildRootPredicateRequest(fingerprint:string,query:RootPredicateQuery,options:{features:RootPredicateFeatures;requestId?:string}):RootPredicateRequest;
export function parseCanonicalRequestText(text:string,context:{manifest:Manifest;features?:RootPredicateFeatures}):{request:RootPredicateRequest|RemoteRequest;raw:string};
export function assertRootPredicateResult(value:unknown,context:{fingerprint:string;query:RootPredicateQuery;features:RootPredicateFeatures}):RemoteResult;

export interface NestedDetailContext {profile:"canonical_nested_detail.v1";fingerprint:string;publication:string;revision:string;}
export interface NestedDetailField {id:string;path:string;label:string;type:"integer"|"decimal"|"string"|"boolean"|"date";encoding:"json"|"string"|"decimal-string";nullable:boolean;}
export interface NestedDetailCollection {id:string;path:string;result_id:string;label:string;primary_key:string;order_by:Array<{field:string;direction:"asc"}>;fields:NestedDetailField[];default_select:string[];limit:20;complete:true;}
export interface NestedDetailFeatures {format:"selecto.nested-detail-features";format_version:1;profile:"canonical_nested_detail.v1";revision:string;wire_profile:"remote_query.v1";request_format_version:1;result:{format:"selecto.remote-query-result";format_version:1};domain:{id:string;fingerprint:string;publication:string};root_primary_key:string;root_fields:Array<NestedDetailField & {operators:RootPredicateOperator[]}>;collections:NestedDetailCollection[];defaults:{select:Array<string|string[]>;limit:25;offset:0;row_format:"arrays"};limits:{max_request_bytes:1048576;max_header_ascii_bytes:8192;max_context_token_utf8_bytes:1024;max_field_id_path_label_utf8_bytes:256;max_request_id_utf8_bytes:128;default_parent_limit:25;min_parent_limit:1;max_parent_limit:25;max_offset:100000;max_root_fields:20;max_child_fields:20;max_filters:20;max_orders:10;max_collections:1;max_children_per_parent:20;max_returned_children:500;max_scalar_utf8_bytes:16384;max_preaggregate_projected_json_bytes:1048576;max_response_entity_bytes:262144};supports:{row_formats:["arrays","objects"];complete_children:true;root_filters:"flat-and";child_filtering:false;child_ordering:"fixed-public-pk-asc";root_required_order:false;root_boolean:false;partial_children:false};}
export interface NestedFeatureValidationContext {entry?:CatalogEntry;domain?:NestedDetailFeatures["domain"];manifest:Manifest;canonicalDomain:Record<string,unknown>;}
export interface NestedDetailQuery {select:Array<string|string[]>;filters?:Array<{field:string;op:RootPredicateOperator;value?:string|number|boolean}>;order_by?:Array<{field:string;direction:"asc"|"desc"}>;limit?:number;offset?:number;row_format?:"arrays"|"objects";timezone?:string;}
export interface NestedDetailResult extends RemoteResult {data:RemoteResult["data"] & {row_format:"arrays"|"objects";subtables:Record<string,{columns:string[];limit:20;complete:true}>};meta:{selecto_nested_detail:NestedDetailContext;request_id?:string};}
export interface NestedDetailOptions {features:NestedDetailFeatures;context:NestedDetailContext;signal?:AbortSignal;requestId?:string;}
export interface CanonicalClient {nestedDetailFeatures(manifest:Manifest,signal?:AbortSignal):Promise<NestedDetailFeatures>;queryNestedDetail(manifest:Manifest,query:NestedDetailQuery,options:NestedDetailOptions):Promise<NestedDetailResult>;queryNestedDetailText(manifest:Manifest,rawText:string,options:NestedDetailOptions):Promise<NestedDetailResult>;}
export function assertNestedDetailFeatures(value:unknown,context?:NestedFeatureValidationContext):NestedDetailFeatures;
export function nestedDetailContext(features:NestedDetailFeatures):NestedDetailContext;
export function encodeNestedDetailContext(context:NestedDetailContext):string;
export function assertNestedDetailScalar(value:unknown,field:NestedDetailField,path?:string,options?:{author?:boolean;numberToken?:string}):unknown;
export function assertNestedDetailQuery(query:unknown,features:NestedDetailFeatures,options?:{numberTokens?:Map<string,string>}):NestedDetailQuery;
export function buildNestedDetailRequest(fingerprint:string,query:NestedDetailQuery,options:NestedDetailOptions):RemoteRequest & {query:NestedDetailQuery};
export function parseNestedDetailRequestText(rawText:string,options:NestedDetailOptions):{request:RemoteRequest & {query:NestedDetailQuery};raw:string;numberTokens:Map<string,string>};
export function assertNestedDetailResult(value:unknown,options:{query:NestedDetailQuery;features:NestedDetailFeatures;context:NestedDetailContext;numberTokens?:Map<string,string>}):NestedDetailResult;
