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
`django-components`, `spring-components`, `laravel-components`,
`typescript-components`, and `demo-theme`.

## Demo appearance

All profiles include `demo-theme.js` and `demo-theme.css`. These assets are
opt-in: add `data-selecto-demo-theme` to the demo's `<html>` element, load the
script in the head, and load the stylesheet after the host/explorer styles.
The Appearance control offers System, Light, and Dark; it remembers the
selection locally and keeps newly rendered explorer fragments and dialogs in
the same scheme. An explicit `?theme=` preview is supported too.

Phoenix hosts import the generated files into their `assets/js/app.js` and
`assets/css/app.css` bundles instead. The shared script also handles existing
`phx:set-theme` header buttons. Sync their generated vendor files with:

```sh
node ../selecto-api-console/packages/web-assets/bin/selecto-web-assets.mjs \
  sync --profile demo-theme --target assets/vendor
```

React hosts that hydrate the entire document use
`data-selecto-demo-theme="manual"` with `suppressHydrationWarning` on `<html>`,
then call `window.selectoDemoTheme.mount()` from their mounted client effect.
This applies the palette before hydration and inserts the control afterward.

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
over plain HTTP. The Laravel profile ships `selecto-components.css` with
`selecto-native.css` and the dialog helper for Livewire actions and charts. The
TypeScript profile ships the reference stylesheet without a transport script;
its native Express explorer uses ordinary GET forms and progressive enhancement.

`perl.css` works under a strict `style-src 'self'` Content-Security-Policy:
the Perl Explorer renders aggregate-grid heat as `sc-heat-0`..`sc-heat-9`
classes, rollup indentation as `sc-rollup-level-2`/`-3`, and its no-script
chart fallback through `@media (scripting: none)`, so it needs no inline
`style` attribute or `<style>` element.
