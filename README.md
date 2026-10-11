# Selecto shared JavaScript workspace

This repository is the local-first home for Selecto browser packages:

- `@selecto/api-console` at the repository root;
- `@selecto/web-assets` under `packages/web-assets`, containing the
  Perl-derived native theme, shared dialog behavior, and pinned htmx assets.

Both packages build without publication:

```sh
npm install
npm run build:all
npm test
```

Sibling Selecto repositories resolve this checkout through
`SELECTO_LIVE_SELECTO_WEB` or `../selecto-api-console`. The same resolvers fall
back to installed `@selecto/*` packages when these packages are later
published.

## API Console

`@selecto/api-console` is the dependency-free browser console for every Selecto
canonical domain API. It discovers the API manifest, canonical domain, OpenAPI
3.1 document, public fields, types, query-library definitions, and versioned
query route at runtime. It contains no adapter, database, table, raw-SQL, or
application-domain knowledge.

Field and filter selection use the same searchable semantic catalog pattern.
Temporal fields also offer operational quick periods such as Today, This Week,
Month to Date, Month/Quarter/Year to Date across all years, and Last 30 Days.
The console sends the selected semantic value,
for example `{ "op": "date_shortcut", "value": "this_week" }`; the API host
resolves its half-open date boundaries when it executes the query (Selecto Perl
measures them from the database's current date, so the session time zone
decides when a day begins).

Fields follow their published roles: a field with `filterable: false` (or
`query_filterable: false`) is not offered as a filter, and one with
`sortable: false` is not offered for sorting, since the API refuses both.
Pasted JSON that uses such a field is reported instead of loaded. Choice
filters offer only the operators their field type accepts, so a boolean
Yes/No choice uses equals rather than one of.

When a query response reports `has_more`, the response shows which rows the
page holds and offers Next and Previous page, which change the offset by the
limit and run the query again.

The GET resource mode offers the resource route's `date_format` values, read
from its OpenAPI parameter, and adds the chosen one to the request path.
When selected fields belong to a to-many relationship and the API advertises
subtable selections, the console offers an explicit subtable control. Enabling
it groups those fields into a nested selection array, preserving one root row;
ordinary ungrouped fields remain flat and may produce multiple root rows.
The Result row shape control chooses ordered arrays or JSON objects for both
the main result and every subtable.

The Response control is populated from the query operation's OpenAPI media
types. JSON renders in the console; CSV, TSV, and XLSX responses download with
the chosen safe filename. The filename is required for a downloadable response
and must end in the matching `.csv`, `.tsv`, or `.xlsx` extension. Generated
cURL commands send the matching `Accept` header and filename query parameter,
then add the same name to `--output`. The request JSON remains the same
regardless of its response representation.

Pasted request JSON can be loaded back into the visual controls with **Load
into chooser**. The console only applies the conversion when it can represent
the full request; otherwise it preserves the pasted JSON and clearly marks it
as manual JSON mode.

Hosts can launch the console with a preconfigured query by adding a
percent-encoded canonical request as `#request=<JSON>`. Because the handoff is
in the URL fragment it is not sent to the server or included in HTTP access
logs. The console loads representable requests into the chooser and reports a
clear error instead of silently changing an unsupported request.

The **Writes** tab is contract-driven. It appears for every domain, but only
offers operations and assignment fields enabled by `writes.operations` and
`writes.fields`. Update and delete requests require explicit root-field
filters, expected affected-row counts are checked before sending, and upserts
expose their conflict and update field sets. The generated JSON is always
visible and copyable, and Send remains disabled until the request is locally
consistent with the published contract. The server repeats all validation and
applies its trusted tenant scope.

Write controls follow canonical field types: dates and date-times use native
temporal inputs, numeric and epoch fields use numeric inputs, booleans and
enumerations use choices, and structured JSON values use multiline editors.
Fields published with `required: true` are selected automatically for inserts,
marked **Required for insert**, and cannot be unchecked. Missing required
assignments are named in the local correctness errors before Send is enabled.
An included date field must contain an ISO `YYYY-MM-DD` value; leave an optional
date unchecked instead of sending an empty string.
Writable one-to-one relationships published in `writes.relationships` appear
as optional nested forms and produce a governed `relationships` request
object; the host remains responsible for implementing its advertised atomic
relationship semantics.

The **Actions** tab uses the governed action catalog published in OpenAPI.
Input types, required values, choices, bounds, and target IDs become form
controls. Group-selection actions get repeatable target groups with their own
declared inputs. The console shows the generated JSON, its local correctness,
and the exact action path before allowing the request to be sent. Server-side
capability, target-scope, eligibility, and execution checks remain
authoritative.

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

The standalone console uses a light operational theme by default and also
supports `data-sac-color-scheme="dark"` on the document root. Hosts can map
their tenant brand into `--sac-accent`, `--sac-teal`, and
`--sac-on-accent`; the console keeps all application and menu integration
outside this backend-neutral package.

The host remains responsible for authentication, authorization, CSRF policy,
rate limits, and serving the assets. The console cannot make a field or
operation public; it can only use the canonical contracts returned to the
current principal.

## Development

The workspace also builds `@selecto/canonical-client` and
`@selecto/explorer-client`, dependency-free ESM packages with TypeScript
declarations. Their built sources are included in the existing standalone
Console script so vendoring hosts do not need an additional script tag.

When a host advertises `remote_query.v1`, the Console sends fingerprint-bound
query envelopes through the shared canonical client and validates exact result
codecs. Published `getExplorerMetadata` and `getDomainCatalog` routes bind
Explorer handoff to the same authenticated publication. An Explorer fragment
retains its execution timezone and publication; unsupported intent is refused
explicitly. Hosts without the profile retain the existing bare read mode;
write, action, resource and importer surfaces retain their existing contracts.

`Cancel query` stops waiting in this browser. A sequence guard prevents a late
response from replacing a newer result. The UI does not claim database query
cancellation.

```sh
npm test
npm run pack:check
```

`src/` is the source of truth. `dist/` is deterministic generated output and
includes `manifest.json` with byte counts and SHA-256 digests for consumers
that vendor the package into another distribution.

Hosts advertising the separately bound root predicate sidecar expose an explicit
Recursive root predicates (v2) option in Console. The raw query editor preserves
entered JSON bytes after strict validation. Complete trees stay in that editor;
Load into chooser visibly refuses conversion where the flat form cannot retain
all intent. Root predicate state controls restore the separate closed state,
copy a complete state URL, or save/restore private browser state. URL handoff uses
the existing `#request=` key with the full root-state envelope. Discovery and
publication binding refresh before execution; changed identity blocks retained
state instead of silently rebinding. The ordinary flat v1 chooser, snapshots,
writes, actions and legacy bare query behavior remain separate.

## Complete nested Detail

Canonical hosts can advertise `getNestedDetailFeatures` for the explicit
`canonical_nested_detail.v1` sidecar over `remote_query.v1`. Select **Complete
nested Detail (v1)** in Query profile to use a separate bound draft. The builder
retains ordered parent columns and one collection, ordered child columns, flat
parent filters, parent ordering, page and row shape. It uses only published
opaque field IDs and UTC/en-US exact scalar display. Child tables are complete;
empty pages retain child schema headers and empty collections show `No children`.

Every Run refreshes authenticated catalog, manifest, full domain and sidecar.
Publication or revision drift blocks submission and retains the draft. The raw
query editor uses strict selected-profile validation and sends valid pasted
bytes unchanged. This first browser mode requires explicit `timezone: "UTC"`
in manual JSON too; the wider HTTP timezone contract is unchanged. Unsupported members, duplicate keys or invalid numeric tokens
refuse locally; **Reset JSON** returns to the retained complete builder draft.
Omitted limit and offset use the published defaults when mapping the response;
the transmitted raw request remains unchanged.
Basic, recursive and nested drafts remain separate when modes change, and a
cancelled or stale result cannot render into another mode.

Nested state uses the isolated `nested_request` fragment slot. Restore fills the
controls without running; Run is a separate action. Editing the state text
cancels pending work and blocks Run until an explicit successful restore or a
new current-publication draft. Save/Copy require a complete matching state and
query editor. Private state uses a separate local-storage key and removes the
nested share payload from the current URL. The 64KiB encoded
state bound applies to persistence; execution retains the selected HTTP 1MiB
request bound. These consumer checks do not certify a native API or rendered
browser cohort.
