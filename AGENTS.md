# selecto-api-console

- This repository owns the dependency-free JavaScript and CSS source for the
  Selecto canonical API console. Language implementations and web hosts may
  vendor generated `dist/` artifacts, but must not fork the browser source.
- Keep the console domain-driven and backend-neutral. Discover routes from the
  canonical manifest and controls from public canonical domain documents.
- Never add raw SQL, arbitrary table/identifier input, credentials, embedded
  application domains, or backend-specific request formats.
- API paths must remain absolute same-origin paths. Authentication,
  authorization, CSRF, and rate limiting remain host responsibilities.
- Run `npm test` and `npm run pack:check` before handoff.
