import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";

const path = process.env.SELECTO_DENYLIST_FILE;
if (!path) throw new Error("Set SELECTO_DENYLIST_FILE to the external plaintext list.");

const tokens = (await readFile(path, "utf8")).split(/\r?\n/)
  .map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
const hashes = new Set(tokens.map((token) =>
  createHash("sha256").update(`selecto-denylist-v1:${token.toLowerCase()}`).digest("hex")));
for (const hash of [...hashes].sort()) console.log(hash);
