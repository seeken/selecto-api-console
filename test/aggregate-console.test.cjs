const assert = require("node:assert/strict");
const test = require("node:test");
const api = require("../dist/selecto-api-console.js");

const field = (id, type, more = {}) => ({id, path: id, label: id, type, groupable: true, aggregates: ["count", "count_distinct"],
  collection: null, ...more});
const features = () => ({
  format: "selecto.explorer-features", format_version: 1, profile: "remote_query.explorer.v1",
  domain: {id: "tasks", fingerprint: "sha256:domain"}, revision: "sha256:features",
  fields: [
    field("state", "string"), field("done", "boolean", {aggregates: ["count", "count_distinct", "true_count"]}),
    field("hours", "decimal", {groupable: false, aggregates: ["count", "count_distinct", "sum", "avg", "min", "max"]}),
    field("steps.label", "string", {collection: "steps"}),
  ],
  limits: {max_limit: 50, max_offset: 1000, max_group_by: 2, max_aggregates: 3},
  supports: {aggregate: true, rollup: true, cube: true, grouping_sets: true},
});

function instance(document = features()) {
  const console = new api.APIConsole({dataset: {apiBase: "/api/tasks"}});
  console.aggregateFeatures = document;
  console.aggregateQueryPath = "/api/tasks/explorer-query";
  console.aggregateState = console.newAggregateState();
  return console;
}

test("recognises an explorer features document that offers aggregates", () => {
  assert.equal(api.usableAggregateFeatures(features()), true);
  assert.equal(api.usableAggregateFeatures({...features(), supports: {aggregate: false}}), false);
  assert.equal(api.usableAggregateFeatures({...features(), format_version: 2}), false);
  assert.equal(api.usableAggregateFeatures({...features(), profile: "remote_query.v1"}), false);
  assert.equal(api.usableAggregateFeatures({...features(), revision: undefined}), false);
  assert.equal(api.usableAggregateFeatures(null), false);
});

test("lists every combination of group positions, most detailed first", () => {
  assert.deepEqual(api.aggregateSetChoices(1), [[0], []]);
  assert.deepEqual(api.aggregateSetChoices(2), [[0, 1], [0], [1], []]);
  assert.equal(api.aggregateSetChoices(3).length, 8);
  assert.deepEqual(api.aggregateSetChoices(3)[0], [0, 1, 2]);
  assert.deepEqual(api.aggregateSetChoices(3).at(-1), []);
});

test("offers only what the publication publishes", () => {
  const console = instance();
  assert.deepEqual(console.aggregateGroupFields().map((f) => f.id), ["state", "done"], "groupable, not a collection field");
  assert.deepEqual(console.aggregateMeasureFields("sum").map((f) => f.id), ["hours"]);
  assert.deepEqual(console.aggregateMeasureFields("true_count").map((f) => f.id), ["done"]);
  assert.deepEqual(console.aggregateFunctions(), ["count", "count_distinct", "sum", "avg", "min", "max", "true_count"]);
  assert.deepEqual(console.aggregateGroupingModes().map((mode) => mode.value), ["none", "rollup", "cube", "sets"]);
  const limited = instance({...features(), supports: {aggregate: true, rollup: true}});
  assert.deepEqual(limited.aggregateGroupingModes().map((mode) => mode.value), ["none", "rollup"]);
});

test("builds the explorer-query envelope bound to the fingerprint and features revision", () => {
  const console = instance();
  let model = console.buildAggregateRequest();
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.request, {format: "selecto.explorer-query", format_version: 1,
    domain: {fingerprint: "sha256:domain"}, features: {revision: "sha256:features"},
    query: {select: [{aggregate: "count", alias: "count"}]}}, "a summary row has no group, limit or offset");

  Object.assign(console.aggregateState, {groupBy: ["state", "done"], limit: 20, offset: 5,
    aggregates: [{fn: "count", field: "", alias: "n"}, {fn: "sum", field: "hours", alias: "total_hours"}]});
  model = console.buildAggregateRequest();
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.request.query, {
    select: ["state", "done", {aggregate: "count", alias: "n"}, {aggregate: "sum", field: "hours", alias: "total_hours"}],
    group_by: ["state", "done"], limit: 20, offset: 5});

  console.aggregateState.grouping = "rollup";
  assert.equal(console.buildAggregateRequest().request.query.rollup, true);
  console.aggregateState.grouping = "cube";
  const cube = console.buildAggregateRequest().request.query;
  assert.equal(cube.cube, true);
  assert.equal("rollup" in cube, false, "one subtotal mode at a time");

  Object.assign(console.aggregateState, {grouping: "sets", sets: ["", "1", "0"]});
  model = console.buildAggregateRequest();
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.request.query.grouping_sets, [[0], [1], []], "positions in group_by, in a fixed order");
});

test("explains a draft that cannot be sent", () => {
  const broken = (change) => { const console = instance(); change(console.aggregateState); return console.buildAggregateRequest().errors.join(" "); };
  assert.match(broken((s) => { s.aggregates = []; }), /at least one aggregate/);
  assert.match(broken((s) => { s.aggregates[0].alias = "bad name"; }), /needs a name/);
  assert.match(broken((s) => { s.groupBy = ["state"]; s.aggregates[0].alias = "state"; }), /repeats the name state/);
  assert.match(broken((s) => { s.aggregates = [{fn: "sum", field: "", alias: "s"}]; }), /needs a field/);
  assert.match(broken((s) => { s.aggregates = [{fn: "sum", field: "state", alias: "s"}]; }), /sum is not offered for state/);
  assert.match(broken((s) => { s.grouping = "cube"; }), /need at least one group/);
  assert.match(broken((s) => { s.groupBy = ["state", "done"]; s.grouping = "sets"; }), /at least one grouping set/);
  assert.match(broken((s) => { s.groupBy = ["state", "done"]; s.grouping = "sets"; s.sets = ["0", ""]; }), /Every group must appear/);
  assert.match(broken((s) => { s.groupBy = ["state"]; s.limit = 51; }), /Limit must be 1 to 50/);
  assert.match(broken((s) => { s.groupBy = ["state"]; s.offset = -1; }), /Offset/);
  assert.match(broken((s) => { s.aggregates = [1, 2, 3, 4].map((n) => ({fn: "count", field: "", alias: `c${n}`})); }), /At most 3 aggregates/);
  const console = instance();
  console.aggregateState.groupBy = ["state", "hours", "nowhere"];
  assert.deepEqual(console.buildAggregateRequest().request.query.group_by, ["state"], "a field that is not groupable is never sent");
});

test("tells a left-out group from a NULL value in a result row", () => {
  const columns = [{id: "state", role: "group"}, {id: "done", role: "group"}, {id: "n", role: "aggregate"}];
  assert.equal(api.aggregateRowHolds({level: 1, kind: "subtotal"}, columns[0], columns), true, "rollup: the first level groups");
  assert.equal(api.aggregateRowHolds({level: 1, kind: "subtotal"}, columns[1], columns), false);
  assert.equal(api.aggregateRowHolds({level: 1, kind: "subtotal", groups: ["done"]}, columns[1], columns), true, "cube: the named groups");
  assert.equal(api.aggregateRowHolds({level: 1, kind: "subtotal", groups: ["done"]}, columns[0], columns), false);
  assert.equal(api.aggregateRowHolds({level: 0, kind: "total", groups: []}, columns[0], columns), false);
});
