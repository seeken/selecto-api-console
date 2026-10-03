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
`native-blazor`, `perl-components`, `rails-components`, `blazor-components`,
`django-components`, and `spring-components`.

`perl-components`, `rails-components`, `blazor-components`,
`django-components`, and `spring-components` ship the same Perl reference stylesheet (`perl.css`) as
`selecto-components.css`. The Perl
profile adds the pinned htmx and WebSocket bundles; the Rails/Hotwire profile
ships the stylesheet alone because Turbo and Stimulus come from the host
importmap; the Blazor Server profile (`selecto-blazor-components`) adds only
the shared dialog focus helper as `selecto-dialogs.js`, because Blazor's
SignalR circuit replaces htmx and the WebSocket bundle. The Django profile
(`selecto-django-components`) adds the dialog helper as `selecto-dialogs.js`
and htmx 4 as `htmx.min.js`, but not the WebSocket bundle, because the Django
Explorer keeps htmx over plain HTTP. The Spring profile
(`selecto-spring-components`) ships the same three files as the Django
profile, for the same reason: the Spring Explorer keeps Thymeleaf and htmx
over plain HTTP.

`perl.css` works under a strict `style-src 'self'` Content-Security-Policy:
the Perl Explorer renders aggregate-grid heat as `sc-heat-0`..`sc-heat-9`
classes, rollup indentation as `sc-rollup-level-2`/`-3`, and its no-script
chart fallback through `@media (scripting: none)`, so it needs no inline
`style` attribute or `<style>` element.
