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
