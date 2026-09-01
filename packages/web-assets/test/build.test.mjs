import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import test from "node:test";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("the generated asset manifest covers every shared browser artifact", async () => {
  const manifest = JSON.parse(await readFile(resolve(packageRoot, "dist/manifest.json"), "utf8"));
  assert.equal(manifest.format, "selecto.web-assets.v1");
  for (const [name, entry] of Object.entries(manifest.assets)) {
    const content = await readFile(resolve(packageRoot, "dist", name));
    assert.equal(content.length, entry.bytes);
    assert.equal(createHash("sha256").update(content).digest("hex"), entry.sha256);
  }
  assert.deepEqual(Object.keys(manifest.assets).sort(), [
    "hx-ws.min.js",
    "htmx.min.js",
    "native-dialogs.js",
    "native.css",
    "perl.css"
  ].sort().map((name) => name.endsWith("min.js") ? `vendor/${name}` : name).sort());
});
