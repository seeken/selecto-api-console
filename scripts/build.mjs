import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const version = "0.5.0";
const files = ["selecto-api-console.js", "selecto-api-console.css", "selecto-importer.js", "selecto-importer.css"];
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = (file) => resolve(packageRoot, "src", file);
const distPath = (file) => resolve(packageRoot, "dist", file);

await mkdir(distPath("."), {recursive: true});
for (const file of files) {
  if (file !== "selecto-api-console.js") { await copyFile(sourcePath(file), distPath(file)); continue; }
  // Include the exact workspace sources in the distributable classic script.
  // Native hosts need only the existing single Console asset.
  const names = {
    "canonical-client": ["CanonicalWireError", "CanonicalHttpError", "safePath", "record", "nonEmptyString", "integer", "keys", "assertCatalog", "assertManifest", "assertDomain", "routePath", "assertError", "assertColumn", "assertScalar", "assertQueryResult", "buildRemoteRequest", "createCanonicalClient"],
    "explorer-client": ["ExplorerIntentError", "assertExplorerMetadata", "toExplorerDescriptor", "toCanonicalQuery", "toExplorerResult", "createExplorerClient"],
  };
  let bundled = "(function(global) {\n";
  for (const name of ["canonical-client", "explorer-client"]) {
    const content = (await readFile(resolve(packageRoot, "packages", name, "src/index.js"), "utf8"))
      .replace(/^import .*;\n/gm, "").replace(/^export /gm, "");
    const globalName = name === "canonical-client" ? "SelectoCanonicalClient" : "SelectoExplorerClient";
    bundled += `global.${globalName} = (function() {\n${name === "explorer-client" ? "const canonical = global.SelectoCanonicalClient;\n" : ""}${content}\nreturn {${names[name].join(",")}};\n})();\n`;
  }
  bundled += "})(typeof globalThis !== 'undefined' ? globalThis : this);\n";
  await writeFile(distPath(file), bundled + await readFile(sourcePath(file), "utf8"));
}
await copyFile(sourcePath("compatibility.json"), distPath("compatibility.json"));

const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Selecto API Console</title>
  <link rel="stylesheet" href="./selecto-api-console.css?v=${version}">
  <script defer src="./selecto-api-console.js?v=${version}"></script>
</head>
<body class="sac-body">
  <main class="sac-app" data-selecto-api-console>
    <div class="sac-boot" role="status"><span class="sac-spinner" aria-hidden="true"></span><span>Reading the Selecto domain&hellip;</span></div>
    <noscript><div class="sac-fatal">The Selecto API Console requires JavaScript.</div></noscript>
  </main>
</body>
</html>
`;
await writeFile(distPath("index.html"), html);

const assets = {};
for (const file of [...files, "index.html", "compatibility.json"]) {
  const content = await readFile(distPath(file));
  assets[file] = {
    bytes: content.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}
await writeFile(distPath("manifest.json"), `${JSON.stringify({format: "selecto.api-console.assets.v1", version, assets}, null, 2)}\n`);
