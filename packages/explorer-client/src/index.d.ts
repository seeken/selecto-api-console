import type {CanonicalClient, CatalogEntry, ClientOptions, Column, ExplorerFeatures, ExplorerQuery, ExplorerResult, Manifest, RemoteQuery, RemoteResult} from "@selecto/canonical-client";
export type {ClientOptions} from "@selecto/canonical-client";
export interface ExplorerMetadata {format: "selecto.explorer-metadata"; format_version: 1; domain: {id: string; fingerprint: string; publication: string}; label: string; fields: Array<Column & {path: string}>; default_select: string[]; query: {profile: "remote_query.v1"; operators: string[]; limits: {max_limit: number; max_offset: number; max_filters: number}; supports: {detail: boolean; nested: boolean; recursive_filters: boolean; aggregates: boolean}}; services: Record<string, unknown>; links?: {api_console?: string};}
export interface ExplorerQueryRequest {schema: "selecto.spa.query-request/v1"; domainId: string; view: string; state: {selected: string[]; orderBy: Array<{field: string; direction: "asc" | "desc"}>; groupBy: string[]; aggregates: unknown[]; preventDenormalization?: boolean; rowClickAction?: string; fieldConfigs?: unknown; groupConfigs?: unknown; rollup?: boolean; aggregateGrid?: boolean; aggregateGridColorize?: boolean; aggregateGridColorScale?: string; columns?: unknown[]; graph?: unknown; queryLibrary?: unknown}; filters: {conjunction: "and" | "or"; items: unknown[]}; page: {number: number; size: number}; presentation?: {timezone?: string; locale?: string}; publication?: {fingerprint: string; publication?: string}; exportShape?: string;}
export interface ExplorerDescriptor {schema: "selecto.spa.domain-descriptor/v1"; schemaVersion: 1; id: string; name: string; source: string; capabilities: "detail"[]; protocolFeatures: "api_console"[]; fields: Array<{id: string; label: string; encoding?: Column["encoding"]; type: "boolean" | "date" | "datetime" | "decimal" | "integer" | "json" | "text" | "time" | "uuid" | "unknown"; selectable: boolean; sortable: boolean; groupable: boolean; aggregatable: boolean; filterOperators: Array<"equals" | "not_equals" | "greater_than" | "greater_than_or_equal" | "less_than" | "less_than_or_equal" | "is_null" | "is_not_null" | "between" | "in" | "not_in">}>; views: Array<{id: string; kind: string; label: string}>; defaults: {selected: string[]; orderBy: never[]; groupBy: never[]; aggregates: never[]; rollup: boolean; preventDenormalization: boolean}; release: {schema: string; id: string; version: string; fingerprint: string; status: string}; artifacts?: Record<string, string>; metadata: {canonical: {transport: "canonical"; profile: string; fingerprint: string; publication: string; supports: ExplorerMetadata["query"]["supports"]; limits: ExplorerMetadata["query"]["limits"]; unsupported: UnsupportedExplorerFeature[]}};}
export interface ExplorerQueryResponse {schema: "selecto.spa.query-response/v1"; columns: Array<{id: string; label: string; encoding?: Column["encoding"]; type: ExplorerDescriptor["fields"][number]["type"]}>; rows: Array<Record<string, unknown>>; page: {number: number; size: number}; metadata: {canonical: {fingerprint: string; publication: string; hasMore: boolean}};}
export interface ExplorerClient {getRootPredicateContext(id:string,options?:{signal?:AbortSignal}):Promise<RootPredicateContext>;executeRootPredicateIntent(intent:RootPredicateIntent,options?:{signal?:AbortSignal;requestId?:string}):Promise<ExplorerQueryResponse>;listDomains(): Promise<ExplorerDescriptor[]>; getDomain(id: string): Promise<ExplorerDescriptor>; execute(request: ExplorerQueryRequest, options?: {signal?: AbortSignal; requestId?: string}): Promise<ExplorerQueryResponse>;}
export class ExplorerIntentError extends Error {code: string; path: string; details: {path: string}; constructor(path: string, message: string, code?: string);}
export function createExplorerClient(options?: ClientOptions): ExplorerClient;
export function assertExplorerMetadata(value: unknown, manifest?: Manifest, entry?: CatalogEntry, domain?: Record<string, unknown>): ExplorerMetadata;
export function toExplorerDescriptor(metadata: ExplorerMetadata): ExplorerDescriptor;
export function toCanonicalQuery(request: ExplorerQueryRequest, metadata: ExplorerMetadata): RemoteQuery;
export function toExplorerResult(envelope: RemoteResult, request: ExplorerQueryRequest, metadata: ExplorerMetadata): ExplorerQueryResponse;

import type {RootPredicateFeatures, RootPredicateQuery, RootFeatureValidationContext} from "@selecto/canonical-client";
export interface RootPredicateBinding {domain_id:string;fingerprint:string;publication:string;wire_profile:"remote_query.v2";feature_profile:"canonical_root_predicates.v1";feature_revision:string;}
export type RootPredicateNode = {and:RootPredicateNode[]} | {or:RootPredicateNode[]} | {field:string;op:"eq"|"ne"|"gt"|"gte"|"lt"|"lte";value:string|boolean} | {field:string;op:"is_null"|"is_not_null"};
export interface RootPredicateIntent {format:"selecto.root-predicate-ui-intent";format_version:1;mode:"recursive";binding:RootPredicateBinding;select:string[];predicate:{kind:"absent"}|{kind:"tree";tree:RootPredicateNode};order_by:Array<{field:string;direction:"asc"|"desc"}>;limit:number;offset:number;presentation:{timezone:string;locale:string};}
export interface RootPredicateState {format:"selecto.root-predicate-state";format_version:1;intent:RootPredicateIntent;}
export interface RootPredicateContext {entry:CatalogEntry;manifest:Manifest;canonicalDomain:Record<string,unknown>;metadata:ExplorerMetadata;features:RootPredicateFeatures;binding:RootPredicateBinding;}
export type RootPredicateValidationContext = RootPredicateContext | (RootFeatureValidationContext & {features:RootPredicateFeatures});
export function rootPredicateBinding(features:RootPredicateFeatures):RootPredicateBinding;
export function assertRootPredicateIntent(value:unknown,context:RootPredicateValidationContext):RootPredicateIntent;
export function toRootPredicateQuery(intent:RootPredicateIntent,context:RootPredicateValidationContext):RootPredicateQuery;
export function parseRootPredicateState(rawJson:string,context?:RootPredicateValidationContext):RootPredicateState;
export function encodeRootPredicateState(state:RootPredicateState):string;
export function decodeRootPredicateState(rawOrEncoded:string,context?:RootPredicateValidationContext):RootPredicateState;
export function validateRootPredicateFeaturesAndMap(features:RootPredicateFeatures,context:RootFeatureValidationContext,authorSelect:string[],authorTree:RootPredicateNode):{validated_features:RootPredicateFeatures;translated_select:string[];translated_where:RootPredicateQuery["where"]};
export function toRootPredicateExplorerResult(envelope:RemoteResult,intent:RootPredicateIntent,context:RootPredicateValidationContext):ExplorerQueryResponse;
export function flatSnapshotToRequest(snapshot:{version:2;domainId:string;view:string;state:ExplorerQueryRequest["state"];filters:ExplorerQueryRequest["filters"];page:ExplorerQueryRequest["page"];publication?:ExplorerQueryRequest["publication"];presentation?:ExplorerQueryRequest["presentation"]}):ExplorerQueryRequest;

import type {NestedDetailFeatures,NestedDetailQuery,NestedDetailResult,NestedFeatureValidationContext,NestedDetailContext,NestedDetailField} from "@selecto/canonical-client";
export interface NestedDetailBinding {domain_id:string;fingerprint:string;publication:string;wire_profile:"remote_query.v1";feature_profile:"canonical_nested_detail.v1";feature_revision:string;}
export type NestedDetailIntentFilter = {id:string;field:string;op:"eq"|"ne"|"gt"|"gte"|"lt"|"lte";value:string|boolean} | {id:string;field:string;op:"is_null"|"is_not_null"};
export interface NestedDetailIntent {format:"selecto.nested-detail-ui-intent";format_version:1;mode:"nested";binding:NestedDetailBinding;collection_id:string;select:Array<string|string[]>;filters:NestedDetailIntentFilter[];order_by:Array<{field:string;direction:"asc"|"desc"}>;limit:number;offset:number;row_format:"arrays"|"objects";presentation:{timezone:"UTC";locale:"en-US"};}
export interface NestedDetailState {format:"selecto.nested-detail-state";format_version:1;intent:NestedDetailIntent;}
export interface NestedExplorerContext extends NestedFeatureValidationContext {entry:CatalogEntry;features:NestedDetailFeatures;binding:NestedDetailBinding;}
export type NestedDetailValidationContext = NestedFeatureValidationContext & {features:NestedDetailFeatures};
export interface NestedExplorerScalarColumn {id:string;key:string;path:string;label:string;type:"integer"|"decimal"|"text"|"boolean"|"date";encoding:NestedDetailField["encoding"];nullable:boolean;}
export interface NestedExplorerCollectionColumn {id:string;path:string;label:string;type:"nested";encoding:"json";nullable:false;nestedFields:NestedExplorerScalarColumn[];complete:true;limit:20;}
export interface NestedExplorerResult {schema:"selecto.spa.query-response/v1";columns:Array<NestedExplorerScalarColumn|NestedExplorerCollectionColumn>;rows:Array<Record<string,unknown>>;page:{number:number;size:number};metadata:{canonical:{profile:"canonical_nested_detail.v1";fingerprint:string;publication:string;hasMore:boolean;nestedContext:NestedDetailContext;completeChildren:true}};}
export interface ExplorerClient {getNestedDetailContext(id:string,options?:{signal?:AbortSignal}):Promise<NestedExplorerContext>;executeNestedDetailIntent(intent:NestedDetailIntent,options?:{signal?:AbortSignal;requestId?:string}):Promise<NestedExplorerResult>;}
export function nestedDetailBinding(features:NestedDetailFeatures):NestedDetailBinding;
export function createNestedDetailIntent(features:NestedDetailFeatures):NestedDetailIntent;
export function assertNestedDetailIntent(value:unknown,context:NestedDetailValidationContext,options?:{origin?:"intent"|"state"}):NestedDetailIntent;
export function toNestedDetailQuery(intent:NestedDetailIntent,context:NestedDetailValidationContext):NestedDetailQuery;
export function parseNestedDetailState(rawJSON:string,context?:NestedDetailValidationContext):NestedDetailState;
export function encodeNestedDetailState(state:NestedDetailState):string;
export function decodeNestedDetailState(rawOrEncoded:string,context?:NestedDetailValidationContext):NestedDetailState;
export function nestedDetailConsoleHref(path:string,state:NestedDetailState):string;
export function toNestedDetailExplorerResult(envelope:NestedDetailResult,intent:NestedDetailIntent,context:NestedDetailValidationContext):NestedExplorerResult;

export interface UnsupportedExplorerFeature {id: string; label: string; reason: string;}
export function unsupportedExplorerFeatures(metadata: ExplorerMetadata): UnsupportedExplorerFeature[];
export class StaleResultError extends Error {name: "AbortError"; code: "stale_result"; stale: true; constructor(message?: string);}
export interface ExplorerProfileBinding {fingerprint: string; publication: string; revision?: string;}
export interface ExplorerProfileContext {profile: string; entry: CatalogEntry; manifest: Manifest; canonicalDomain: Record<string, unknown>; binding: ExplorerProfileBinding; [key: string]: unknown;}
/** A canonical profile strategy; `remote_query.explorer.v1` adds a second implementation. */
export interface ExplorerProfileStrategy<Context extends ExplorerProfileContext = ExplorerProfileContext> {
  id: string;
  accepts(discovery: {manifest: Manifest; entry: CatalogEntry}): boolean;
  discover(discovery: {client: CanonicalClient; entry: CatalogEntry; manifest: Manifest; canonicalDomain: Record<string, unknown>; signal?: AbortSignal}): Promise<Context>;
  describe(context: Context): ExplorerDescriptor;
  translate(request: ExplorerQueryRequest, context: Context): RemoteQuery | ExplorerQuery;
  run(client: CanonicalClient, context: Context, query: any, options: {signal?: AbortSignal; requestId?: string}): Promise<RemoteResult | ExplorerResult>;
  toResponse(envelope: any, request: ExplorerQueryRequest, context: Context): ExplorerQueryResponse;
  /** Optional full-result download (explorer.v1). */
  export?(client: CanonicalClient, context: Context, request: ExplorerQueryRequest, format: ExplorerExportFormat, options: {signal?: AbortSignal; requestId?: string}): Promise<ExplorerExportBytes>;
}
export const detailProfile: ExplorerProfileStrategy<ExplorerProfileContext & {metadata: ExplorerMetadata}>;
export interface CanonicalHostAdapterOptions extends ClientOptions {profiles?: ExplorerProfileStrategy<any>[]; supersede?: false | "domain" | "adapter";}
export interface CanonicalHostAdapter extends Omit<ExplorerClient, "listDomains" | "getDomain" | "execute"> {
  transport: "canonical";
  profiles: string[];
  binding(domainId: string): (ExplorerProfileBinding & {profile: string}) | undefined;
  listDomains(options?: {signal?: AbortSignal}): Promise<ExplorerDescriptor[]>;
  getDomain(id: string, options?: {signal?: AbortSignal}): Promise<ExplorerDescriptor>;
  execute(request: ExplorerQueryRequest, options?: {signal?: AbortSignal; requestId?: string; channel?: string}): Promise<ExplorerQueryResponse>;
  /** Full-result download through the bound profile; refused unless it is remote_query.explorer.v1. */
  export(request: ExplorerQueryRequest, format: ExplorerExportFormat, options?: {signal?: AbortSignal; requestId?: string}): Promise<{data: Blob; filename: string; contentType: string}>;
}
export function createCanonicalHostAdapter(options?: CanonicalHostAdapterOptions): CanonicalHostAdapter;

/** Transport choice before an explorer mounts: "auto" probes the canonical catalog (absent -> "spa"; refusals and broken catalogs throw). */
export type HostTransportMode = "spa" | "canonical" | "auto";
export function selectHostTransport(options?: ClientOptions & {mode?: HostTransportMode; signal?: AbortSignal}): Promise<"spa" | "canonical">;

// ---- remote_query.explorer.v1 ----
export type ExplorerExportFormat = "csv" | "tsv" | "json" | "xlsx";
export interface ExplorerExportBytes {bytes: ArrayBuffer; contentType: string; filename?: string;}
export interface ExplorerV1Context extends ExplorerProfileContext {features: ExplorerFeatures; binding: ExplorerProfileBinding & {revision: string};}
/** The explorer.v1 strategy; the adapter's default profiles are `[explorerProfile, detailProfile]`. */
export const explorerProfile: ExplorerProfileStrategy<ExplorerV1Context>;
export interface BucketSpec {kind: "numeric" | "year" | "elapsed_days" | "relative_days"; ranges?: Array<{min?: number; max?: number; label: string}>; step?: number;}
/** The SPA `bucketRanges` text grammar as a structured bucket spec (section 5.3). */
export function parseBucketRanges(text: string, kind: BucketSpec["kind"], options?: {allowStep?: boolean; maxBuckets?: number}): BucketSpec;
export function unsupportedExplorerV1Features(features: ExplorerFeatures): UnsupportedExplorerFeature[];
export function toExplorerV1Descriptor(features: ExplorerFeatures): ExplorerDescriptor;
export interface ExplorerV1Plan {query: ExplorerQuery; columns: Array<{kind: "field" | "group" | "aggregate" | "collection"; wire: string; spa: Record<string, unknown>; [key: string]: unknown}>; view: string; grid: boolean; rollup: boolean; page: {number: number; size: number};}
export function planExplorerV1Query(request: ExplorerQueryRequest, features: ExplorerFeatures, options?: {export?: boolean}): ExplorerV1Plan;
export function toExplorerV1Query(request: ExplorerQueryRequest, features: ExplorerFeatures, options?: {export?: boolean}): ExplorerQuery;
export function toExplorerV1Response(envelope: ExplorerResult, request: ExplorerQueryRequest, features: ExplorerFeatures): ExplorerQueryResponse;
export function spaFieldId(field: {path: string}): string;
