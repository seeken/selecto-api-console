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
