const assert = require("node:assert/strict");
const test = require("node:test");
const {APIConsole, requestPayloadFromLocation} = require("../dist/selecto-api-console.js");

function instance(remote = false) {
  const console = new APIConsole({dataset: {apiBase: "/api/items"}});
  console.remoteMode = remote;
  console.manifest = {domain: {fingerprint: "items-v1"}};
  console.domain = {
    source: {fields: ["id"], columns: {id: {type: "integer"}}, associations: {}}, schemas: {},
    query_library: {
      segments: {
        active: {}, pdf_yes: {parameters: {note: {type: "string"}}}, pdf_no: {}, marked: {}, unmarked: {},
      },
      projections: {summary: {fields: ["id"]}},
      views: {saved: {projection: "summary", segments: ["pdf_yes"]}},
      segment_picker_groups: {
        pdf: {label: "PDF", default: "pdf_yes", choices: [
          {segment: "pdf_yes", label: "Yes"}, {segment: "pdf_no", label: "No"},
        ]},
        annotation: {label: "Annotation", choices: [
          {segment: "marked", label: "Marked"}, {segment: "unmarked", label: "Unmarked"},
        ]},
      },
    },
  };
  console.fields = [{path: "id", type: "integer"}];
  console.fieldMap = new Map([["id", console.fields[0]]]);
  console.filterFields = console.fields;
  console.filterFieldMap = console.fieldMap;
  console.state.selectedFields = [{id: "1", field: "id", alias: "", format: ""}];
  return console;
}

test("Explorer URL segment choices load into the chooser without manual mode", () => {
  const console = instance();
  const payload = {select: ["id"], segments: ["pdf_no"], segment_choices: {pdf: "pdf_no"}, limit: 50};
  const imported = requestPayloadFromLocation({hash: `#request=${encodeURIComponent(JSON.stringify(payload))}`});
  console.state.rawDirty = true;
  console.loadPayloadIntoChooser(imported);
  assert.equal(console.state.rawDirty, false);
  assert.deepEqual(console.state.segmentChoices, {pdf: "pdf_no"});
  assert.deepEqual(console.buildPayload(), {...payload, row_format: "arrays", offset: 0});
});

test("unset, choices and explicit Off round trip with and without defaults in both wire modes", () => {
  for (const remote of [false, true]) {
    for (const [group, segment] of [["pdf", "pdf_no"], ["annotation", "marked"]]) {
      for (const choice of [null, segment, ""]) {
        const console = instance(remote);
        console.setSegmentGroupChoice(group, choice);
        const payload = console.buildPayload();
        const query = remote ? payload.query : payload;
        if (choice === null) {
          assert.equal(Object.hasOwn(query, "segment_choices"), false);
          assert.equal(Object.hasOwn(query, "segments"), false);
        } else {
          assert.deepEqual(query.segment_choices, {[group]: choice});
          assert.deepEqual(query.segments || [], choice ? [choice] : []);
        }
        const restored = instance(remote);
        restored.loadPayloadIntoChooser(payload);
        assert.equal(restored.state.rawDirty, false);
        assert.deepEqual(restored.buildPayload(), payload);
        assert.deepEqual(restored.state.segmentChoices, choice === null ? {} : {[group]: choice});
      }
    }
  }
});

test("switching to default clears an override and grouped segments while keeping ungrouped segments", () => {
  const console = instance();
  console.state.segments = ["active"];
  for (const choice of ["pdf_no", "", "pdf_yes", null]) assert.equal(console.setSegmentGroupChoice("pdf", choice), true);
  assert.deepEqual(console.state.segments, ["active"]);
  assert.deepEqual(console.state.segmentChoices, {});
  assert.equal(Object.hasOwn(console.buildPayload(), "segment_choices"), false);
  assert.deepEqual(console.effectiveSegmentIds(), ["active", "pdf_yes"]);
  assert.equal(console.setSegmentGroupChoice("pdf", undefined), false);
});

test("unknown groups, invalid choices and disagreeing segments refuse atomically and name the group", () => {
  const console = instance();
  const before = structuredClone(console.state);
  for (const [extra, message] of [
    [{segment_choices: {missing: ""}}, /Unknown segment picker group missing/],
    [{segment_choices: {pdf: "missing"}}, /Invalid choice for segment picker group pdf/],
    [{segment_choices: {pdf: "marked"}}, /Invalid choice for segment picker group pdf/],
    ...[null, false, 1, [], {}].map(choice => [{segment_choices: {pdf: choice}}, /Invalid choice for segment picker group pdf/]),
    [{segments: ["pdf_yes"], segment_choices: {pdf: "pdf_no"}}, /Segment picker group pdf disagrees with segments/],
    [{segments: ["pdf_yes", "pdf_no"], segment_choices: {pdf: "pdf_no"}}, /Segment picker group pdf disagrees with segments/],
    ...[null, [], "pdf"].map(value => [{segment_choices: value}, /segment_choices must be a JSON object/]),
    [{segment_choices: JSON.parse('{"constructor":""}')}, /Unknown segment picker group constructor/],
  ]) {
    assert.throws(() => console.loadPayloadIntoChooser({select: ["id"], ...extra}), message);
    assert.deepEqual(console.state, before);
  }
});

test("Off strips any explicit group segments and overrides inherited view segments as on the server", () => {
  for (const segments of [[], ["pdf_yes"], ["pdf_no"], ["pdf_yes", "pdf_no"]]) {
    const console = instance();
    console.loadPayloadIntoChooser({select: ["id"], segments: ["active", ...segments], segment_choices: {pdf: ""}});
    assert.deepEqual(console.state.segments, ["active"]);
    assert.deepEqual(console.buildPayload().segment_choices, {pdf: ""});
    assert.deepEqual(console.effectiveSegmentIds(), ["active"]);
  }
  const console = instance();
  console.loadPayloadIntoChooser({view: "saved", segment_choices: {pdf: ""}});
  assert.deepEqual(console.effectiveSegmentIds(), []);
  assert.deepEqual(console.activeParameterSpecs(), {});
  console.loadPayloadIntoChooser({view: "saved", segments: ["pdf_no"], segment_choices: {pdf: "pdf_no"}});
  assert.deepEqual(console.effectiveSegmentIds(), ["pdf_no"]);
});

test("a choice without a segments entry is added and defaults expose the effective parameter controls", () => {
  const console = instance();
  console.loadPayloadIntoChooser({select: ["id"], segment_choices: {pdf: "pdf_yes"}, parameters: {note: "fixture"}});
  assert.deepEqual(console.buildPayload().segments, ["pdf_yes"]);
  assert.deepEqual(console.buildPayload().parameters, {note: "fixture"});
  console.loadPayloadIntoChooser({select: ["id"], parameters: {note: "default choice"}});
  assert.deepEqual(console.buildPayload().parameters, {note: "default choice"});
  console.setSegmentGroupChoice("pdf", "");
  assert.equal(Object.hasOwn(console.buildPayload(), "parameters"), false);
  assert.throws(() => console.loadPayloadIntoChooser({select: ["id"], segment_choices: {pdf: ""}, parameters: {note: "off"}}), /Parameters not exposed/);
  console.domain.query_library.segment_picker_groups.pdf.default_views = ["aggregate"];
  console.setSegmentGroupChoice("pdf", null);
  assert.deepEqual(console.effectiveSegmentIds(), []);
  assert.deepEqual(console.activeParameterSpecs(), {});
});

test("legacy requests keep their exact serialized payload and do not acquire overrides", () => {
  const console = instance();
  for (const segments of [[], ["pdf_no"], ["active", "pdf_yes"], ["marked"]]) {
    const payload = {select: ["id"], ...(segments.length ? {segments} : {}), row_format: "arrays", limit: 50, offset: 0};
    console.setSegmentGroupChoice("pdf", "");
    console.loadPayloadIntoChooser(payload);
    assert.equal(JSON.stringify(console.buildPayload()), JSON.stringify(payload));
    assert.deepEqual(console.state.segmentChoices, {});
  }
  assert.throws(() => console.loadPayloadIntoChooser({select: ["id"], segments: ["pdf_yes", "pdf_no"]}), /PDF allows only one choice/);
});

test("group controls offer Default, Off and choices and handle each radio change", () => {
  class Node {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; }
    append(...nodes) { this.children.push(...nodes); }
    replaceChildren(...nodes) { this.children = nodes; }
  }
  const previousDocument = global.document;
  global.document = {createElement: tag => new Node(tag), createTextNode: text => ({text})};
  try {
    const console = instance();
    const container = new Node("div");
    console.root.querySelector = () => container;
    console.changed = () => {};
    function radios() {
      console.renderSegmentGroups();
      return container.children.map(group => group.children.filter(node => node.tag === "label")
        .map(label => ({input: label.children[0], text: label.children[1].text})));
    }
    let groups = radios();
    assert.deepEqual(groups[0].map(option => option.text), ["Default (Yes)", "Off", "Yes", "No"]);
    assert.deepEqual(groups[1].map(option => option.text), ["Default (unset)", "Off", "Marked", "Unmarked"]);
    assert.deepEqual(groups.map(options => options.filter(option => option.input.checked).map(option => option.text)), [["Default (Yes)"], ["Default (unset)"]]);
    for (const [index, expected] of [[3, "pdf_no"], [1, ""], [0, undefined]]) {
      const input = groups[0][index].input;
      input.matches = selector => selector === "[data-sac-segment-group]";
      console.onChange({target: input});
      assert.equal(console.state.segmentChoices.pdf, expected);
      groups = radios();
      assert.equal(groups[0][index].input.checked, true);
      assert.equal(groups[0].filter(option => option.input.checked).length, 1);
    }
    console.loadPayloadIntoChooser({view: "saved", segment_choices: {pdf: ""}});
    groups = radios();
    assert.equal(groups[0][1].input.checked, true);
    assert.equal(Boolean(container.children[0].disabled), false);
  } finally { global.document = previousDocument; }
});

test("request copy and cURL serialize all chooser overrides in plain and remote modes", () => {
  const previousWindow = global.window;
  global.window = {location: {origin: "https://items.example"}};
  try {
    for (const remote of [false, true]) {
      const console = instance(remote);
      const nodes = Object.fromEntries(["request", "query-path", "run", "edited", "curl"].map(name => [`[data-sac-${name}]`, {}]));
      console.root.querySelector = selector => nodes[selector] || null;
      console.setSegmentGroupChoice("pdf", "");
      console.setSegmentGroupChoice("annotation", "marked");
      console.syncRequest();
      const payload = JSON.parse(nodes["[data-sac-request]"].value);
      assert.deepEqual((remote ? payload.query : payload).segment_choices, {pdf: "", annotation: "marked"});
      assert.ok(nodes["[data-sac-curl]"].textContent.includes(nodes["[data-sac-request]"].value));
      let copied;
      console.copy = text => { copied = text; };
      console.onClick({target: {closest: selector => selector === "[data-sac-copy-request]" ? {} : null}});
      assert.equal(copied, nodes["[data-sac-request]"].value);
      // Saved/shared request JSON re-enters through the same importer.
      const restored = instance(remote);
      restored.loadPayloadIntoChooser(requestPayloadFromLocation({hash: `#request=${encodeURIComponent(copied)}`}));
      assert.deepEqual(restored.buildPayload(), payload);
    }
  } finally { global.window = previousWindow; }
});
