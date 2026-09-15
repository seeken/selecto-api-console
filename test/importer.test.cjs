const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const importer = require("../dist/selecto-importer.js");

test("exports a reusable importer surface", () => {
  assert.equal(typeof importer.Importer, "function");
  assert.equal(typeof importer.mountAll, "function");
});

test("maps uploaded columns to governed fields and keeps non-file values separate", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-importer.js"), "utf8");
  assert.match(source, /Each row below is a column in the uploaded file/);
  assert.match(source, /data-sai-column/);
  assert.match(source, /Additional values not in the file/);
  assert.match(source, /data-sai-run-row/);
  assert.match(source, /Import row/);
});

test("offers published governed action inputs as file mapping targets", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-importer.js"), "utf8");
  assert.match(source, /importActions\(\)/);
  assert.match(source, /actionMappings/);
  assert.match(source, /governed action input/);
});

test("supports static and typed values for governed action inputs", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-importer.js"), "utf8");
  assert.match(source, /data-sai-action-static/);
  assert.match(source, /extraActionInputs/);
  assert.match(source, /inputType\(spec.type\)/);
  assert.match(source, /publishedAction/);
});

test("offers only file-mapped key sets as persistent radio choices", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-importer.js"), "utf8");
  assert.match(source, /eligibleKeySets\(\)/);
  assert.match(source, /selecto-import-key-set/);
  assert.match(source, /Match: \$\{set.label/);
  assert.match(source, /kind === "column"/);
});

test("auto-mapping reserves each file column for one governed destination", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-importer.js"), "utf8");
  assert.match(source, /claimedColumns/);
  assert.match(source, /Action inputs are operational semantics/);
});

test("shows governed action results alongside the write result", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-importer.js"), "utf8");
  assert.match(source, /action_results/);
  assert.match(source, /actionResults/);
});

test("refreshes a stale browser mapping against the current domain contract", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-importer.js"), "utf8");
  assert.match(source, /refreshDomain\(\)/);
  assert.match(source, /import_domain_changed/);
  assert.match(source, /Preview again before importing/);
});

test("lets an operator explicitly disable source-row duplicate protection", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-importer.js"), "utf8");
  assert.match(source, /data-sai-idempotency/);
  assert.match(source, /Duplicate protection is off/);
  assert.match(source, /mode: "none"/);
});

test("shows proposed work and supports server-governed import row scopes", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-importer.js"), "utf8");
  assert.match(source, /Source data/);
  assert.match(source, /Proposed work/);
  assert.match(source, /data-sai-row-select/);
  assert.match(source, /row_numbers/);
  assert.match(source, /All valid rows/);
});
