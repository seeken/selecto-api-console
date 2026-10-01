import assert from "node:assert/strict";
import {mkdtemp, readFile, writeFile, rm, access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {resolve, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {execFileSync} from "node:child_process";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("profile changes preserve host-owned app.css and remove identifiable generated copies", async () => {
  const target = await mkdtemp(resolve(tmpdir(), "selecto-assets-ownership-"));
  const sync = () => execFileSync(process.execPath, [resolve(root, "bin/selecto-web-assets.mjs"), "sync", "--profile", "native-htmx", "--target", target]);
  try {
    const authored = ".host-toolbar { display: flex; }\n";
    await writeFile(resolve(target, "app.css"), authored);
    sync();
    assert.equal(await readFile(resolve(target, "app.css"), "utf8"), authored);
    assert.equal(await readFile(resolve(target, "selecto.css"), "utf8"), await readFile(resolve(root, "dist/native.css"), "utf8"));

    await writeFile(resolve(target, "app.css"), await readFile(resolve(root, "dist/native.css")));
    sync();
    await assert.rejects(access(resolve(target, "app.css")), {code: "ENOENT"});
  } finally {
    await rm(target, {recursive: true, force: true});
  }
});

test("the Rails components profile ships the Perl stylesheet and no htmx bundles", async () => {
  const target = await mkdtemp(resolve(tmpdir(), "selecto-assets-rails-"));
  const run = (...extra) => execFileSync(process.execPath, [resolve(root, "bin/selecto-web-assets.mjs"), "sync", "--profile", "rails-components", "--target", target, ...extra], {stdio: "pipe"});
  try {
    run();
    assert.equal(await readFile(resolve(target, "selecto-components.css"), "utf8"), await readFile(resolve(root, "dist/perl.css"), "utf8"));
    await assert.rejects(access(resolve(target, "htmx.min.js")), {code: "ENOENT"});
    await assert.rejects(access(resolve(target, "hx-ws.min.js")), {code: "ENOENT"});
    run("--check");
    await writeFile(resolve(target, "selecto-components.css"), "/* edited */\n");
    assert.throws(() => run("--check"), /Stale generated Selecto web asset/);
  } finally {
    await rm(target, {recursive: true, force: true});
  }
});

test("the Blazor components profile ships the Perl stylesheet and dialog helper, and retires native-livewire's copy", async () => {
  const target = await mkdtemp(resolve(tmpdir(), "selecto-assets-blazor-"));
  const run = (profile, ...extra) => execFileSync(process.execPath, [resolve(root, "bin/selecto-web-assets.mjs"), "sync", "--profile", profile, "--target", target, ...extra], {stdio: "pipe"});
  try {
    run("native-livewire");
    await access(resolve(target, "selecto.css"));
    run("blazor-components");
    assert.equal(await readFile(resolve(target, "selecto-components.css"), "utf8"), await readFile(resolve(root, "dist/perl.css"), "utf8"));
    assert.equal(await readFile(resolve(target, "selecto-dialogs.js"), "utf8"), await readFile(resolve(root, "dist/native-dialogs.js"), "utf8"));
    // The generated native stylesheet of the previous profile is identifiable, so it is removed.
    await assert.rejects(access(resolve(target, "selecto.css")), {code: "ENOENT"});
    await assert.rejects(access(resolve(target, "htmx.min.js")), {code: "ENOENT"});
    await assert.rejects(access(resolve(target, "hx-ws.min.js")), {code: "ENOENT"});
    run("blazor-components", "--check");
    await writeFile(resolve(target, "selecto-dialogs.js"), "/* edited */\n");
    assert.throws(() => run("blazor-components", "--check"), /Stale generated Selecto web asset/);
  } finally {
    await rm(target, {recursive: true, force: true});
  }
});

test("the Django components profile ships the Perl stylesheet, dialog helper and htmx, and retires native-htmx's stylesheet", async () => {
  const target = await mkdtemp(resolve(tmpdir(), "selecto-assets-django-"));
  const run = (profile, ...extra) => execFileSync(process.execPath, [resolve(root, "bin/selecto-web-assets.mjs"), "sync", "--profile", profile, "--target", target, ...extra], {stdio: "pipe"});
  try {
    run("native-htmx");
    await access(resolve(target, "selecto.css"));
    run("django-components");
    assert.equal(await readFile(resolve(target, "selecto-components.css"), "utf8"), await readFile(resolve(root, "dist/perl.css"), "utf8"));
    assert.equal(await readFile(resolve(target, "selecto-dialogs.js"), "utf8"), await readFile(resolve(root, "dist/native-dialogs.js"), "utf8"));
    assert.equal(await readFile(resolve(target, "htmx.min.js"), "utf8"), await readFile(resolve(root, "dist/vendor/htmx.min.js"), "utf8"));
    // The generated native stylesheet of the previous profile is identifiable, so it is removed.
    await assert.rejects(access(resolve(target, "selecto.css")), {code: "ENOENT"});
    // htmx stays over plain HTTP: no WebSocket bundle.
    await assert.rejects(access(resolve(target, "hx-ws.min.js")), {code: "ENOENT"});
    run("django-components", "--check");
    await writeFile(resolve(target, "selecto-components.css"), "/* edited */\n");
    assert.throws(() => run("django-components", "--check"), /Stale generated Selecto web asset/);
  } finally {
    await rm(target, {recursive: true, force: true});
  }
});
