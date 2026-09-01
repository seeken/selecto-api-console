import {copyFile, mkdir, readFile, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const version = "0.1.0";
const files = ["selecto-api-console.js", "selecto-api-console.css"];
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = (file) => resolve(packageRoot, "src", file);
const distPath = (file) => resolve(packageRoot, "dist", file);

await mkdir(distPath("."), {recursive: true});
for (const file of files) await copyFile(sourcePath(file), distPath(file));
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
