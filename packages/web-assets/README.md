# Selecto Web Assets

`@selecto/web-assets` owns the shared browser presentation used by native
Selecto explorer frontends. The Perl explorer is the visual reference; Django,
Spring/Thymeleaf, Laravel/Livewire, and Blazor keep native templates and
lifecycle behavior while consuming the same generated CSS and dialog helper.

## Local-first build

From the repository root:

```sh
npm run build:all
```

Consumers can then sync a profile directly from the sibling checkout:

```sh
node ../selecto-api-console/packages/web-assets/bin/selecto-web-assets.mjs \
  sync --profile native-htmx --target public/selecto-web
```

The same command is exposed as `selecto-web-assets` when the package is later
installed from npm. Every sync validates `dist/manifest.json` before changing
the target directory.

Available profiles are `native-htmx`, `native-spring`, `native-livewire`,
`native-blazor`, and `perl-components`.
