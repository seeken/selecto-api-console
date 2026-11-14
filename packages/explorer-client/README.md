# Explorer client

`@selecto/explorer-client` maps the rendered Explorer's bounded Detail request
to `remote_query.v1` using a separately published `selecto.explorer-metadata`
version 1 descriptor. It uses `@selecto/canonical-client` for all HTTP transport
and exact wire validation. Neither package depends on a UI framework.

```js
import {createExplorerClient} from "@selecto/explorer-client";
const adapter = createExplorerClient({baseUrl: "/api", catalogPath: "/api/catalog"});
const domains = await adapter.listDomains();
```

The adapter implements `listDomains`, `getDomain`, and `execute`. Other services
are absent until implemented and advertised. It supports root fields, flat AND
filters with advertised basic operators, sorting, positive offset paging, exact
typed results and execution timezone. Recursive filters, analytics, formatted or
repeated columns, denormalization and service requests produce explicit errors.
Metadata IDs map to canonical field paths explicitly; there is no prefix rule.

Discovery refreshes before every query. The request's optional `publication`
contains `fingerprint` and the opaque authenticated `publication` identity;
changes are refused rather than silently rebound. No authenticated catalog or
metadata is persisted. Saved/shared state must carry this identity and preserve
its presentation timezone. Pagination exposes `metadata.canonical.hasMore`
without manufacturing a total-count query.

Recursive root authoring is explicit and separate from the flat request and
snapshot. `getRootPredicateContext(domainId, {signal})` freshly discovers the
catalog, manifest, complete Domain, old metadata and declared root sidecar.
`executeRootPredicateIntent(intent, {signal, requestId})` clones the bound intent
before discovery, compares every binding member and translates opaque IDs only
through the validated sidecar's `path`. Every group and leaf counts toward the
20-node, depth-four bounds; leaf, singleton and repeated groups are preserved.
An explicit absent predicate omits `where`; executable empty groups refuse.
Integer/decimal/date author values are exact text and booleans are primitives.
No flat query is implicitly wrapped or upgraded.

The public closed `RootPredicateIntent`, `RootPredicateState`,
`RootPredicateNode` and `RootPredicateContext` types are shared with UI consumers.
Use `assertRootPredicateIntent` / `toRootPredicateQuery` for validation/translation,
`parseRootPredicateState` for strict raw JSON, and `encodeRootPredicateState` /
`decodeRootPredicateState` for the separate URI state namespace (64KiB encoded
limit). Restore against a fresh context; retain and visibly block invalid/stale
input, without rebinding. `flatSnapshotToRequest` reads existing flat version-two
snapshots as the same v1 author request. Root results expose native
`metadata.canonical.hasMore` and exact wire values without inventing totals.

`validateRootPredicateFeaturesAndMap` is a transparent pure facade returning the
actual validated sidecar and translated selection/tree for a supplied context.
Synthetic caller contexts prove local validation only, not a native publication
fingerprint or rendered/backend conformance. Applications use discovery context.

`getNestedDetailContext` and `executeNestedDetailIntent` provide a separate
explicit nested mode. They refresh catalog/manifest/full domain/sidecar before
each execution, compare every saved binding token and map opaque root/child IDs
only through that palette. `createNestedDetailIntent`, `toNestedDetailQuery` and
`assertNestedDetailIntent` expose the ordered mixed selection with exactly one
collection, flat root filters, exact typed text, root sort, page, arrays/objects
and the first browser candidate's UTC/en-US presentation. Richer members refuse.

`parseNestedDetailState` / `encodeNestedDetailState` / `decodeNestedDetailState`
use the isolated `selecto.nested-detail-state` namespace and one declared URI
layer. Their64KiB save/share cap is independent of the1MiB execution body cap.
`nestedDetailConsoleHref` preserves a discovered safe Console path/query and
uses `nested_request`; existing basic/root state remains separate. A UI must
retain invalid/stale restore input, show refusal and require explicit later Run.

`toNestedDetailExplorerResult` validates the complete wire envelope before
mapping parent/child records to opaque own-property keys. All child columns
retain canonical path, encoding and nullable slots even with zero parent rows.
Only this validated result exposes `metadata.canonical.profile` equal to
`canonical_nested_detail.v1`, exact `nestedContext` and `completeChildren`.
These markers permit a dedicated renderer; an arbitrary `type:nested` does not.
Mappings preserve exact values and native hasMore, without native/API/SPA
admission or inferred total counts.

Nested validation preserves typed local-refusal metadata from the canonical
client. Saved-state restoration should call
`assertNestedDetailIntent(intent, context, {origin: "state"})`; direct builder
validation uses the default intent origin. This distinguishes invalid state
from invalid authored intent while preserving specific stale-context,
unpublished-field and recognized unsupported-facility reasons. State syntax,
Unicode and actual byte-cap failures remain distinct. Discovery classifies an
actual authentication HTTP401 or an invalid published capability; arbitrary
transport exceptions are not classified by their wording. Original exception
classes, codes and messages remain available.

## Shared host adapter

`createCanonicalHostAdapter(options)` returns one `SelectoHostAdapter`-shaped
object for every framework explorer. Frameworks keep only a thin wrapper that
validates their own view models.

```js
import {createCanonicalHostAdapter} from "@selecto/explorer-client";
const adapter = createCanonicalHostAdapter({
  baseUrl: "/api/selecto/canonical", catalogPath: "/api/selecto/canonical/catalog",
  headers: () => ({"X-CSRF-Token": csrfToken()}), supersede: "domain",
});
```

- `listDomains` and `getDomain` refresh discovery (catalog, manifest, domain,
  profile metadata) and bind each domain to the publication the UI loaded;
  `binding(domainId)` returns it.
- `execute(request, {signal, requestId, channel})` refreshes discovery again,
  refuses drift from that binding (or from `request.publication`) with
  `stale_domain_fingerprint` before any query, and leaves the host's 409 for a
  changed fingerprint intact.
- The caller's `signal` aborts the HTTP request. With `supersede: "domain"`
  (single-explorer pages) or `"adapter"`, or an explicit `channel`, a newer call
  aborts the older one; a late older result is rejected with
  `StaleResultError` (`name` `"AbortError"`, `code` `"stale_result"`).
- Descriptors carry `metadata.canonical.transport: "canonical"` and
  `metadata.canonical.unsupported`, a stable list of `{id, label, reason}` for
  every SPA feature the publication does not provide (views, filter groups,
  joined/nested fields, unadvertised operators, totals and host services), so
  UIs show absence instead of dropping intent.
- Profiles are strategies (`detailProfile` today). A later
  `remote_query.explorer.v1` strategy implements the same `accepts`,
  `discover`, `describe`, `translate`, `run` and `toResponse` members and is
  passed ahead of Detail in `profiles`.

Display-only `fieldConfigs`/`groupConfigs` members (`alias`, `format`) are
accepted and never sent. `between`, `in` and `not_in` are translated only when
the publication advertises them. Integer and decimal columns encoded as JSON
numbers must carry lossless lexemes (`assertExactResultNumbers` in
`@selecto/canonical-client`); larger values must use `decimal-string`.

### Choosing the transport

`selectHostTransport({mode, baseUrl, catalogPath, fetch, headers})` resolves
`"spa"`, `"canonical"` or `"auto"` before an explorer mounts. `"auto"` probes the
canonical catalog: a valid `selecto.domain-catalog` selects the canonical
adapter; an absent route (404, 405, 410) or a non-catalog answer (an HTML
fallback page) selects the host's SPA routes. Refusals (401, 403), server
errors, network failures and malformed catalogs are thrown, so a canonical host
that refuses or breaks is never silently downgraded. Builder images use it so a
frontend talks canonical to every backend that publishes the mount.

## `remote_query.explorer.v1`

`createCanonicalHostAdapter` tries `explorerProfile` ahead of `detailProfile`
(the default `profiles`). A host whose manifest lists
`remote_query.explorer.v1` with `getExplorerFeatures` and `queryExplorer` is
discovered through the `selecto.explorer-features` sidecar, bound to the
manifest fingerprint, the catalog publication and the features `revision`;
any drift after the UI loaded the domain is refused before a query
(`stale_domain_fingerprint`, `stale_explorer_features`). Hosts without the
profile stay Detail-only and list what they lack at
`metadata.canonical.unsupported`.

The descriptor (`toExplorerV1Descriptor`) offers the Detail, Aggregate and
Graph views, the aggregate grid and export only as the host's `supports`
promise them. `planExplorerV1Query` translates the SPA request: field and
aggregate selections (aliases follow the SPA column ids, for example
`sum_amount`), `all`/`any` filter groups (empty groups dropped), the ten date
group formats, buckets (`parseBucketRanges` turns the SPA `bucketRanges` text
into the structured inclusive ranges or steps), rollup (sorts dropped, group
path order), the grid as `complete: true`, an exact count when
`supports.count_exact`, segments, the time zone and exports. Anything the
features document does not promise is refused locally. `toExplorerV1Response`
returns SPA columns and rows by id, `rowMeta` drilldowns from `row_meta`
(formatted keys keep their `groupFormat`, so a drilldown runs as the host's
derived-group leaf), `totalRows` from `total_count` and client-side grid colour
bounds. Decimals stay decimal strings; JSON numbers must be exact lexemes.

`adapter.export(request, format)` downloads the full result through
`queryExplorer` with the format's `Accept` media type and returns
`{data: Blob, filename, contentType}`; the Detail profile refuses it.
