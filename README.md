# Selecto API Console

`@selecto/api-console` is the dependency-free browser console for every Selecto
canonical domain API. It discovers the API manifest, canonical domain, OpenAPI
3.1 document, public fields, types, query-library definitions, and versioned
query route at runtime. It contains no adapter, database, table, raw-SQL, or
application-domain knowledge.

## Run it against any backend

Serve `dist/` from the same origin as a canonical API, then open:

```text
/selecto-api-console/index.html?api=/api/v1/orders&title=Orders%20API%20Console
```

The `api` value must be an absolute same-origin path. If omitted it defaults to
`/api/v1/selecto`. The console sends same-origin credentials and follows routes
advertised by the base manifest, so the same build works with the Elixir, Go,
Rails/Ruby, TypeScript/Node, Perl, Rust, Python, R, Java/Kotlin/Scala, .NET/F#,
and PostgreSQL-extension canonical API implementations.

Hosts can also embed the console in their own shell:

```html
<link rel="stylesheet" href="/selecto-api-console/selecto-api-console.css">
<script defer src="/selecto-api-console/selecto-api-console.js"></script>
<main data-selecto-api-console
      data-api-base="/api/v1/orders"
      data-title="Orders API Console"></main>
```

The host remains responsible for authentication, authorization, CSRF policy,
rate limits, and serving the assets. The console cannot make a field or
operation public; it can only use the canonical contracts returned to the
current principal.

## Development

```sh
npm test
npm run pack:check
```

`src/` is the source of truth. `dist/` is deterministic generated output and
includes `manifest.json` with byte counts and SHA-256 digests for consumers
that vendor the package into another distribution.
