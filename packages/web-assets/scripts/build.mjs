import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(packageRoot, "dist");
const files = [
  ["src/native.css", "native.css"],
  ["src/native-dialogs.js", "native-dialogs.js"],
  ["src/perl.css", "perl.css"],
  ["vendor/htmx.min.js", "vendor/htmx.min.js"],
  ["vendor/hx-ws.min.js", "vendor/hx-ws.min.js"]
];

for (const [source, target] of files) {
  const destination = resolve(dist, target);
  await mkdir(dirname(destination), {recursive: true});
  await copyFile(resolve(packageRoot, source), destination);
}

const assets = {};
for (const [, target] of files) {
  const content = await readFile(resolve(dist, target));
  assets[target] = {
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex")
  };
}

await writeFile(
  resolve(dist, "manifest.json"),
  `${JSON.stringify({format: "selecto.web-assets.v1", version: "0.1.0", assets}, null, 2)}\n`
);
