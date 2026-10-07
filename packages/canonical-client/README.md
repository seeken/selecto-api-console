# Canonical client

`@selecto/canonical-client` is a dependency-free ESM client for the existing
`remote_query.v1` profile. It discovers safe same-origin routes, binds requests
to the published domain fingerprint, preserves native safe HTTP errors, forwards
AbortSignals, and validates exact scalar types and result shapes. It does not
authorize fields or decide host query policy.

```js
import {createCanonicalClient} from "@selecto/canonical-client";
const client = createCanonicalClient({baseUrl: "/api/items"});
const manifest = await client.manifest();
const result = await client.query(manifest, {
  select: ["id", "name"], limit: 30, offset: 0, row_format: "objects"
});
```

Headers may be supplied as a function so request-scoped authentication and CSRF
values are current. A browser abort proves only that this client stopped waiting;
it does not prove database cancellation. Requests are never retried implicitly.
The baseline validates flat typed results; richer Explorer intent must use a
separately implemented profile rather than discarding intent.
