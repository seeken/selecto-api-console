import {mkdtemp, writeFile, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {spawnSync} from "node:child_process";

const temporary = await mkdtemp(join(tmpdir(), "selecto-client-pack-"));
function run(command, args, cwd) {
  const result = spawnSync(command, args, {cwd, encoding: "utf8"});
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")}: ${result.stderr || result.stdout}`);
  return result.stdout;
}
try {
  const files = ["canonical-client", "explorer-client"].map((name) => {
    const packed = JSON.parse(run("npm", ["pack", "--json", "--workspace", `@selecto/${name}`, "--pack-destination", temporary], process.cwd()))[0];
    if (!packed.files.some((file) => file.path === "dist/index.js") || !packed.files.some((file) => file.path === "dist/index.d.ts")) throw new Error(`${name}: missing public build`);
    return join(temporary, packed.filename);
  });
  await writeFile(join(temporary, "package.json"), JSON.stringify({private: true, type: "module"}));
  run("npm", ["install", "--offline", "--ignore-scripts", "--no-audit", "--no-fund", ...files], temporary);
  run(process.execPath, ["--input-type=module", "-e", "import * as canonical from '@selecto/canonical-client'; import * as explorer from '@selecto/explorer-client'; for (const name of ['createCanonicalClient','assertRootPredicateFeatures','parseCanonicalRequestText','buildRootPredicateRequest','assertRootPredicateResult']) if (typeof canonical[name] !== 'function') process.exit(1); for (const name of ['createExplorerClient','assertRootPredicateIntent','toRootPredicateQuery','parseRootPredicateState','encodeRootPredicateState','decodeRootPredicateState','validateRootPredicateFeaturesAndMap','flatSnapshotToRequest']) if (typeof explorer[name] !== 'function') process.exit(1);"], temporary);
  process.stdout.write("Installed tarball ESM client imports passed.\n");
} finally { await rm(temporary, {recursive: true, force: true}); }
