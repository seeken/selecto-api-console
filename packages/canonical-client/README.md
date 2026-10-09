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

The optional selected nested branch uses `remote_query.v1`, the declared safe
GET `getNestedDetailFeatures`, and sidecar profile `canonical_nested_detail.v1`.
No extra manifest wire version or generic nested flag selects it. Validate
`assertNestedDetailFeatures(features, {entry, manifest, canonicalDomain})`, then
use `nestedDetailContext` and `queryNestedDetail` or `queryNestedDetailText` with
that exact current context. The raw method preserves submitted bytes and number
lexemes; unsupported shape, duplicate keys, malformed Unicode, fraction/exponent
integer tokens, stale binding and unsafe scalars refuse locally.

Selected results bind root descriptors and ordered `subtables.columns` to the
same palette, including empty parent pages. Every child width/keyset, fixed
codec/nullability and complete20-child bound validates before return. Decimal
output has six fractional digits, int64 decimal strings remain strings, DATE
stays ISO, and JSON integers must be safe lexical integers. No malformed/null
collection is repaired. Errors retain native codes/status with exact admitted
context when present. The selected byte caps are1MiB request,256KiB success and
8KiB error; old headerless v1/root behavior remains separate. These are client
integrity checks; they do not attest native source/privacy, SQL work/serialization
barriers, runtime enrollment, or rendered behavior.

`nestedDetailRefusal(error)` reads optional local-refusal metadata as
`{reason, family}`. Trusted validation branches use `markNestedDetailRefusal`
without replacing the exception or changing its code, message, status or envelope.
The ten public reasons are unavailable, authentication, stale context, invalid
intent, unpublished field, closed intent, duplicate state slot, invalid state,
state limit and invalid selected raw input (see the exported TypeScript union
for their exact names). Only `duplicate-state-slot` belongs to the broader
`invalid-nested-state` family; every other family equals its reason. Unknown
errors stay unclassified. Products can expose these scalar values beside the
visible message; neither message wording nor an expected test result supplies them.
