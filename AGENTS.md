# Selecto shared JavaScript workspace

- This repository is the single JavaScript workspace for shared Selecto web
  packages. The root package is `@selecto/api-console`; workspace packages live
  under `packages/`.
- `packages/web-assets` owns the shared Perl-derived visual assets, native
  dialog accessibility helper, and pinned htmx distribution. Native hosts may
  vendor generated artifacts, but must not fork their browser source.
- Every package must build from this sibling checkout before it is published.
  Consumers must also support the same npm package name without source changes.
- Keep the console domain-driven and backend-neutral. Discover routes from the
  canonical manifest and controls from public canonical domain documents.
- Never add raw SQL, arbitrary table/identifier input, credentials, embedded
  application domains, or backend-specific request formats.
- API paths must remain absolute same-origin paths. Authentication,
  authorization, CSRF, and rate limiting remain host responsibilities.
- Run `npm test` and `npm run pack:check` before handoff.
