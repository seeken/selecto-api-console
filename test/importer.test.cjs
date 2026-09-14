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
});
