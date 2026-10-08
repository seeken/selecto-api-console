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

The separate root API supports hosts explicitly advertising `remote_query.v2`
and the declared `getRootPredicateFeatures` operation. Validate the sidecar with
`assertRootPredicateFeatures(features, context)` against the complete published
Domain, authenticated catalog/metadata identity and current opaque revision.
The validator enforces the declared type/codec pairs and fixed bounded root
capabilities. It never derives or changes a Domain fingerprint.

`queryRootPredicate(manifest, query, {features, signal, requestId})` builds the v2
envelope. `queryText(manifest, originalText, {features, signal})` retains entered
bytes after strict decoded duplicate-key, Unicode, shape and numeric-token
validation. Fraction/exponent integer tokens are never normalized into an
accepted request. Exact decimal and unsafe integer values stay strings.
Transport refuses redirects and recursively escaped traversal. Results bind
column order, paths, type, encoding, nullability and pagination to the requested
selection and sidecar; native errors stay native. The existing `query` v1 API
retains its format and flat request behavior.
