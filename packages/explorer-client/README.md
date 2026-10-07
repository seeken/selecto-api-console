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
