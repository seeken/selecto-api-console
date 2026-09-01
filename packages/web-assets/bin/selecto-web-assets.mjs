#!/usr/bin/env node

import {copyFile, mkdir, readFile, rm} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dist = resolve(packageRoot, "dist");
const profiles = {
  "native-htmx": [
    ["native.css", "selecto.css"],
    ["native-dialogs.js", "selecto-dialogs.js"],
    ["vendor/htmx.min.js", "htmx.min.js"]
  ],
  "native-spring": [
    ["native.css", "selecto.css"],
    ["native-dialogs.js", "selecto-dialogs.js"],
    ["vendor/htmx.min.js", "vendor/htmx.min.js"]
  ],
  "native-livewire": [
    ["native.css", "selecto.css"],
    ["native-dialogs.js", "selecto-dialogs.js"]
  ],
  "native-blazor": [
    ["native.css", "app.css"],
    ["native-dialogs.js", "selecto-native-dialogs.js"]
  ],
  "perl-components": [
    ["perl.css", "selecto-components.css"],
    ["vendor/htmx.min.js", "htmx.min.js"],
    ["vendor/hx-ws.min.js", "hx-ws.min.js"]
  ]
};

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write("Usage: selecto-web-assets sync --profile <name> --target <directory>\n");
  process.exit(2);
}

const [command, ...args] = process.argv.slice(2);
if (command !== "sync") usage();
const valueFor = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const profile = valueFor("--profile");
const target = valueFor("--target");
const check = args.includes("--check");
if (!profile || !profiles[profile]) usage(`Unknown or missing profile: ${profile ?? ""}`);
if (!target) usage("Missing --target");

const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
if (manifest.format !== "selecto.web-assets.v1") throw new Error("Unsupported Selecto web asset manifest");

await mkdir(resolve(target), {recursive: true});
const expectedTargets = new Set(profiles[profile].map(([, destination]) => destination));
if (!check) {
  for (const stale of ["selecto.css", "app.css", "selecto-dialogs.js", "selecto-native-dialogs.js", "htmx.min.js", "hx-ws.min.js", "selecto-components.css"]) {
    if (!expectedTargets.has(stale)) await rm(resolve(target, stale), {force: true});
  }
}
for (const [sourceName, targetName] of profiles[profile]) {
  const source = resolve(dist, sourceName);
  const content = await readFile(source);
  const expected = manifest.assets[sourceName]?.sha256;
  const actual = createHash("sha256").update(content).digest("hex");
  if (!expected || expected !== actual) throw new Error(`Digest mismatch for ${sourceName}`);
  const destination = resolve(target, targetName);
  if (check) {
    let installed;
    try {
      installed = await readFile(destination);
    } catch {
      throw new Error(`Missing generated Selecto web asset: ${destination}`);
    }
    const installedDigest = createHash("sha256").update(installed).digest("hex");
    if (installedDigest !== expected) {
      throw new Error(`Stale generated Selecto web asset: ${destination}`);
    }
  } else {
    await copyFile(source, destination);
  }
}

process.stdout.write(`${check ? "Verified" : "Synced"} @selecto/web-assets ${manifest.version} (${profile}) ${check ? "in" : "to"} ${resolve(target)}\n`);
