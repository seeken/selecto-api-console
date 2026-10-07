import {mkdir, copyFile} from "node:fs/promises";
import {resolve} from "node:path";

const name = process.argv[2];
if (!["canonical-client", "explorer-client"].includes(name)) throw new Error("Unknown client workspace");
const root = resolve(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "..", "packages", name);
await mkdir(resolve(root, "dist"), {recursive: true});
for (const file of ["index.js", "index.d.ts"]) await copyFile(resolve(root, "src", file), resolve(root, "dist", file));
