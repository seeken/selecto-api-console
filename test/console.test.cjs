const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const api = require("../dist/selecto-api-console.js");

test("exports a reusable browser and CommonJS surface", () => {
  assert.equal(api.version, "0.4.0");
  assert.equal(typeof api.APIConsole, "function");
  assert.equal(typeof api.mountAll, "function");
});

test("offers Explorer-style quick periods only for temporal filters", () => {
  assert.ok(api.operatorsForType("date").includes("date_shortcut"));
  assert.ok(api.operatorsForType("epoch_datetime").includes("date_shortcut"));
  assert.ok(!api.operatorsForType("decimal").includes("date_shortcut"));
  const consoleInstance = new api.APIConsole({dataset: {}});
  assert.ok(consoleInstance.dateShortcuts().some((choice) => choice[1] === "mtd_all_years"));
  assert.ok(consoleInstance.dateShortcuts().some((choice) => choice[1] === "qtd_all_years"));
  assert.ok(consoleInstance.dateShortcuts().some((choice) => choice[1] === "ytd_all_years"));
  consoleInstance.fieldMap = new Map([["occurred_at", {path: "occurred_at", type: "epoch_datetime"}]]);
  assert.deepEqual(consoleInstance.filterPayloads({
    field: "occurred_at", op: "date_shortcut", value: "this_week",
  }), [{field: "occurred_at", op: "date_shortcut", value: "this_week"}]);
  consoleInstance.openapi = {components: {schemas: {SelectoFilter: {
    "x-selecto-date-shortcuts": [{group: "Weeks", id: "this_week", label: "This Week"}],
  }}}};
  assert.deepEqual(consoleInstance.dateShortcuts(), [["Weeks", "this_week", "This Week"]]);
});

test("accepts only absolute same-origin API paths", () => {
  assert.equal(api.normalizeAPIBase("/api/v1/orders/"), "/api/v1/orders");
  assert.equal(api.normalizeAPIBase(""), "/api/v1/selecto");
  for (const value of ["api/v1/orders", "//example.test/api", "/api//orders", "/api/orders?x=1", "/api/../admin", "/api/%2e%2e/admin", "/api/%ZZ"]) {
    assert.throws(() => api.normalizeAPIBase(value), /same-origin API path/);
  }
});

test("builds host-configurable cURL authentication", () => {
  assert.equal(api.normalizeCurlAuth(undefined), "cookie");
  assert.equal(api.normalizeCurlAuth("BASIC"), "basic");
  assert.equal(api.normalizeCurlAuth("none"), "none");
  assert.throws(() => api.normalizeCurlAuth("bearer"), /basic, cookie, or none/);

  const renderCurl = (curlAuth) => {
    const editor = {value: '{"select":["id"]}'};
    const output = {textContent: ""};
    const consoleInstance = new api.APIConsole({
      dataset: {apiBase: "/api2/load/v1", curlAuth},
      querySelector: (selector) => selector === "[data-sac-request]" ? editor
        : selector === "[data-sac-curl]" ? output : null,
    });
    const previousWindow = global.window;
    global.window = {location: {origin: "https://tenant.example"}};
    try {
      consoleInstance.updateCurl();
    } finally {
      global.window = previousWindow;
    }
    return output.textContent;
  };

  const basic = renderCurl("basic");
  assert.match(basic, /--basic/);
  assert.match(basic, /--user 'YOUR_USERNAME:YOUR_PASSWORD'/);
  assert.doesNotMatch(basic, /--cookie/);
  assert.match(renderCurl("cookie"), /--cookie 'YOUR_SESSION_COOKIE'/);
  assert.doesNotMatch(renderCurl("none"), /--basic|--user|--cookie/);
});

test("ignores advertised routes that are not same-origin paths", async () => {
  const requests = [];
  await api.discoverCanonicalAPI("/api/v1/selecto", async (path) => {
    requests.push(path);
    if (path.endsWith("/")) return {routes: [{operation_id: "getDomain", path: "//example.test/domain"}]};
    if (path.endsWith("/domain")) return {source: {columns: {}}};
    return {openapi: "3.1.0"};
  });
  assert.deepEqual(requests, [
    "/api/v1/selecto/",
    "/api/v1/selecto/domain",
    "/api/v1/selecto/openapi.json",
  ]);
});

test("discovers governed write and action routes", async () => {
  const discovered = await api.discoverCanonicalAPI("/api/v1/orders", async (path) => {
    if (path.endsWith("/")) return {routes: [
      {operation_id: "getDomain", path: "/api/v1/orders/domain"},
      {operation_id: "getOpenApi", path: "/api/v1/orders/openapi.json"},
      {operation_id: "queryDomain", path: "/api/v1/orders/query"},
      {operation_id: "writeDomain", path: "/api/v1/orders/write"},
      {operation_id: "executeAction", path: "/api/v1/orders/actions/{action}"},
    ]};
    if (path.endsWith("/domain")) return {source: {columns: {}}};
    return {openapi: "3.1.0"};
  });
  assert.equal(discovered.writePath, "/api/v1/orders/write");
  assert.equal(discovered.actionPath, "/api/v1/orders/actions/{action}");
});

test("builds and validates a governed write request", () => {
  const consoleInstance = new api.APIConsole({dataset: {apiBase: "/api/v1/orders"}});
  consoleInstance.domain = {
    source: {
      primary_key: "id", fields: ["id", "status", "amount"],
      columns: {id: {type: "integer"}, status: {type: "string"}, amount: {type: "decimal"}},
    },
    writes: {
      operations: {update: {enabled: true, bulk: true}},
      fields: {status: {updatable: true}, amount: {updatable: true}},
    },
  };
  consoleInstance.writeState = {
    operation: "update", assignments: {status: "closed", amount: "12.3400"},
    included: {status: true, amount: true}, filters: [{field: "id", op: "eq", value: "17"}],
    expectedCount: 1, returning: ["id", "amount"], conflictTarget: [], updateFields: [],
  };
  const model = consoleInstance.buildWriteRequest();
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.payload, {
    operation: "update",
    assignments: {status: "closed", amount: "12.3400"},
    filters: [{field: "id", op: "eq", value: 17}],
    expected_count: 1,
    returning: ["id", "amount"],
  });
  consoleInstance.writeState.filters = [];
  assert.match(consoleInstance.buildWriteRequest().errors.join(" "), /explicit filter/);
});

test("builds action forms from the OpenAPI governed action catalog", () => {
  const consoleInstance = new api.APIConsole({dataset: {apiBase: "/api/v1/orders"}});
  consoleInstance.domain = {
    source: {primary_key: "id", columns: {id: {type: "integer"}}}, actions: {},
  };
  consoleInstance.actionPath = "/api/v1/orders/actions/{action}";
  consoleInstance.openapi = {paths: {"/api/v1/orders/actions/{action}": {post: {
    "x-selecto-actions": [{
      id: "archive", label: "Archive", inputs: [{
        id: "reason", label: "Reason", type: "select", required: true,
        options: [{value: "duplicate", label: "Duplicate"}],
      }],
    }],
  }}}};
  consoleInstance.actionState = {
    id: "archive", targetIds: "17, 18", inputs: {reason: "duplicate"}, groups: [],
  };
  const model = consoleInstance.buildActionRequest();
  assert.equal(model.path, "/api/v1/orders/actions/archive");
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.payload, {
    target: {ids: [17, 18]}, inputs: {reason: "duplicate"},
  });
  consoleInstance.actionState.inputs.reason = "unknown";
  assert.match(consoleInstance.buildActionRequest().errors.join(" "), /not an available choice/);
});

test("builds grouped action payloads as governed sub-arrays", () => {
  const consoleInstance = new api.APIConsole({dataset: {apiBase: "/api/v1/orders"}});
  consoleInstance.domain = {source: {primary_key: "id", columns: {id: {type: "integer"}}}, actions: {}};
  consoleInstance.actionPath = "/api/v1/orders/actions/{action}";
  consoleInstance.openapi = {paths: {"/api/v1/orders/actions/{action}": {post: {
    "x-selecto-actions": [{
      id: "build", inputs: [], selection: {mode: "groups", max_groups: 3, group_inputs: [
        {id: "carrier_id", label: "Carrier", type: "lookup", value_type: "integer", required: true},
      ]},
    }],
  }}}};
  consoleInstance.actionState = {id: "build", targetIds: "", inputs: {}, groups: [
    {ids: "1, 2", inputs: {carrier_id: "44"}},
    {ids: "3", inputs: {carrier_id: "45"}},
  ]};
  const model = consoleInstance.buildActionRequest();
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.payload.target.ids, [1, 2, 3]);
  assert.deepEqual(model.payload.groups, [
    {index: 0, selected_ids: [1, 2], inputs: {carrier_id: 44}},
    {index: 1, selected_ids: [3], inputs: {carrier_id: 45}},
  ]);
});

test("derives sorted public fields from a canonical domain", () => {
  const fields = api.collectFields({
    source: {
      fields: ["secret", "name", "id"],
      columns: {
        id: {type: "integer", label: "Identifier"},
        name: {type: "string", label: "Account name"},
        secret: {type: "string", internal: true},
      },
      associations: {
        origin: {queryable: "location"},
        destination: {queryable: "location"},
        orders: {queryable: "order"},
      },
    },
    schemas: {
      order: {fields: ["total"], columns: {total: {type: "decimal", label: "Order total"}}},
      location: {fields: ["address1"], columns: {address1: {type: "string", label: "Address 1"}}},
    },
    joins: {origin: {name: "Origin"}, destination: {name: "Destination"}},
  });
  assert.deepEqual(fields.map((field) => field.path), [
    "name", "destination.address1", "id", "orders.total", "origin.address1",
  ]);
  assert.equal(fields.find((field) => field.path === "origin.address1").label, "Origin: Address 1");
  assert.equal(fields.find((field) => field.path === "destination.address1").label, "Destination: Address 1");
  assert.equal(fields.find((field) => field.path === "orders.total").label, "Orders: Order total");
});

test("infers canonical to-many associations when cardinality is omitted", () => {
  const schemas = {
    load_det: {primary_key: "id"},
    client_location: {primary_key: "id"},
  };
  assert.equal(api.associationIsMany({
    queryable: "load_det", related_key: "load_id",
  }, schemas), true);
  assert.equal(api.associationIsMany({
    queryable: "client_location", related_key: "id",
  }, schemas), false);
  assert.equal(api.associationIsMany({
    queryable: "load_det", related_key: "load_id", cardinality: "one",
  }, schemas), false);
});

test("renders a usable subtable checkbox for an inferred to-many association", () => {
  class FakeNode {
    constructor(tag) {
      this.tag = tag;
      this.children = [];
      this.dataset = {};
      this.hidden = false;
    }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
  }
  const previousDocument = global.document;
  global.document = {createElement: (tag) => new FakeNode(tag)};
  try {
    const container = new FakeNode("div");
    const consoleInstance = new api.APIConsole({
      dataset: {},
      querySelector: (selector) => selector === "[data-sac-normalization]" ? container : null,
    });
    consoleInstance.domain = {
      source: {associations: {
        load_det: {queryable: "load_det", related_key: "load_id"},
      }},
      schemas: {load_det: {primary_key: "id"}},
    };
    consoleInstance.openapi = {components: {schemas: {SelectoQuery: {properties: {
      select: {items: {oneOf: [
        {type: "string"},
        {$ref: "#/components/schemas/SelectoSubtableSelection"},
      ]}},
    }}}}};
    consoleInstance.state.selectedFields = [{field: "load_det.vin"}];
    consoleInstance.renderNormalization();
    assert.equal(container.hidden, false);
    assert.equal(container.children[0].textContent, "To-many relationships");
    const checkbox = container.children[1].children[0];
    assert.equal(checkbox.type, "checkbox");
    assert.equal(checkbox.value, "load_det");
    assert.equal(checkbox.dataset.sacSubtable, "");
  } finally {
    global.document = previousDocument;
  }
});

test("preserves exact decimal strings for table and JSON result rendering", () => {
  const response = JSON.parse('{"data":{"rows":[["1.2500"]]},"ok":true}');
  assert.equal(response.data.rows[0][0], "1.2500");
  assert.equal(api.renderValue(response.data.rows[0][0]), "1.2500");
  assert.match(JSON.stringify(response), /"1\.2500"/);
});

test("reads result cells from ordered arrays and JSON objects", () => {
  assert.equal(api.rowValue([7, "A"], "status", 1), "A");
  assert.equal(api.rowValue({id: 7, status: "A"}, "status", 1), "A");
});

test("builds configured field aliases and formats from picked fields", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {query_library: {}};
  consoleInstance.state.selectedFields = [
    {id: "1", field: "id", alias: "", format: ""},
    {id: "2", field: "origin.city", alias: "pickup_city", format: ""},
    {id: "3", field: "pickup_datetime_tz", alias: "pickup_month", format: "month"},
  ];
  consoleInstance.state.timezone = "America/New_York";
  consoleInstance.state.rowFormat = "objects";
  assert.deepEqual(consoleInstance.buildPayload().select, [
    "id",
    {field: "origin.city", alias: "pickup_city"},
    {field: "pickup_datetime_tz", alias: "pickup_month", format: "month"},
  ]);
  assert.equal(consoleInstance.buildPayload().timezone, "America/New_York");
  assert.equal(consoleInstance.buildPayload().row_format, "objects");
});

test("groups explicitly selected to-many relationships into sub-arrays", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {query_library: {}};
  consoleInstance.state.selectedFields = [
    {id: "1", field: "id", alias: "", format: ""},
    {id: "2", field: "load_det.vin", alias: "", format: ""},
  ];
  consoleInstance.state.subtables = ["load_det"];
  assert.deepEqual(consoleInstance.buildPayload().select, ["id", ["load_det.vin"]]);
});

test("loads representable request JSON back into every chooser level", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {
    source: {associations: {load_det: {queryable: "load_det", related_key: "load_id"}}},
    schemas: {load_det: {primary_key: "id"}},
    query_library: {
      segments: {active: {parameters: {tenant: {type: "integer"}}}},
      orderings: {}, projections: {}, views: {},
    },
  };
  consoleInstance.openapi = {components: {schemas: {SelectoSelection: {properties: {
    format: {enum: ["day"]},
  }}}}};
  consoleInstance.fields = [
    {path: "id", type: "integer"},
    {path: "load_det.vin", type: "string"},
    {path: "load_det.created", type: "epoch_datetime"},
  ];
  consoleInstance.fieldMap = new Map(consoleInstance.fields.map((field) => [field.path, field]));
  const payload = {
    select: ["id", ["load_det.vin", {field: "load_det.created", alias: "created_day", format: "day"}]],
    segments: ["active"], parameters: {tenant: 7},
    filters: [{field: "id", op: "gte", value: 10}],
    order_by: [{field: "id", direction: "desc"}],
    timezone: "America/New_York", row_format: "objects", limit: 25, offset: 5,
  };
  consoleInstance.loadPayloadIntoChooser(payload);
  assert.deepEqual(consoleInstance.buildPayload(), payload);
  assert.deepEqual(consoleInstance.state.subtables, ["load_det"]);
});

test("rejects JSON the chooser cannot faithfully represent without changing state", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {source: {associations: {}}, schemas: {}, query_library: {}};
  consoleInstance.fields = [{path: "id", type: "integer"}];
  consoleInstance.fieldMap = new Map([["id", consoleInstance.fields[0]]]);
  const before = JSON.parse(JSON.stringify(consoleInstance.state));
  assert.throws(
    () => consoleInstance.loadPayloadIntoChooser({select: ["id"], raw_sql: "select 1"}),
    /Unsupported request properties: raw_sql/,
  );
  assert.deepEqual(consoleInstance.state, before);
});

test("keeps unrepresentable pasted JSON and clearly enters manual mode", () => {
  const editor = {value: '{"select":["id"],"raw_sql":"select 1"}'};
  const message = {textContent: "", dataset: {}, hidden: true};
  const consoleInstance = new api.APIConsole({
    dataset: {},
    querySelector: (selector) => selector === "[data-sac-request]" ? editor
      : selector === "[data-sac-import-message]" ? message : null,
  });
  consoleInstance.domain = {source: {associations: {}}, schemas: {}, query_library: {}};
  consoleInstance.fields = [{path: "id", type: "integer"}];
  consoleInstance.fieldMap = new Map([["id", consoleInstance.fields[0]]]);
  assert.equal(consoleInstance.loadRequestIntoChooser(), false);
  assert.equal(editor.value, '{"select":["id"],"raw_sql":"select 1"}');
  assert.equal(message.hidden, false);
  assert.equal(message.dataset.kind, "error");
  assert.match(message.textContent, /manual JSON mode/);
});

test("allows one field to be selected repeatedly with independent configuration", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {query_library: {}};
  const dateSelection = consoleInstance.newSelectedField("created_at");
  consoleInstance.state.selectedFields.push(dateSelection);
  const timeSelection = consoleInstance.newSelectedField("created_at");
  consoleInstance.state.selectedFields.push(timeSelection);
  dateSelection.alias = "created_date";
  dateSelection.format = "day";
  timeSelection.alias = "created_time";
  timeSelection.format = "time";
  assert.deepEqual(consoleInstance.buildPayload().select, [
    {field: "created_at", alias: "created_date", format: "day"},
    {field: "created_at", alias: "created_time", format: "time"},
  ]);
  const thirdSelection = consoleInstance.newSelectedField("created_at");
  assert.equal(thirdSelection.alias, "created_at__3");
});

test("discovers field formats from OpenAPI only for temporal fields", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.openapi = {components: {schemas: {SelectoSelection: {properties: {
    alias: {type: "string"},
    format: {type: "string", enum: ["day", "month"]},
  }}}}};
  assert.deepEqual(consoleInstance.fieldFormats({type: "utc_datetime"}), ["day", "month"]);
  assert.deepEqual(consoleInstance.fieldFormats({type: "decimal"}), []);
});

test("discovers advertised canonical API routes without backend assumptions", async () => {
  const requests = [];
  const responses = new Map([
    ["/api/v7/orders/", {routes: [
      {operation_id: "getDomain", path: "/api/v7/orders/schema"},
      {operation_id: "getOpenApi", path: "/api/v7/orders/spec"},
      {operation_id: "queryDomain", path: "/api/v7/orders/search"},
    ]}],
    ["/api/v7/orders/schema", {source: {columns: {id: {type: "integer"}}}}],
    ["/api/v7/orders/spec", {openapi: "3.1.0"}],
  ]);
  const discovery = await api.discoverCanonicalAPI("/api/v7/orders/", async (path) => {
    requests.push(path);
    return responses.get(path);
  });
  assert.deepEqual(requests, ["/api/v7/orders/", "/api/v7/orders/schema", "/api/v7/orders/spec"]);
  assert.equal(discovery.queryPath, "/api/v7/orders/search");
  assert.equal(discovery.openapi.openapi, "3.1.0");
});

test("build emits a standalone same-origin console", () => {
  const html = fs.readFileSync("dist/index.html", "utf8");
  const css = fs.readFileSync("dist/selecto-api-console.css", "utf8");
  const manifest = JSON.parse(fs.readFileSync("dist/manifest.json", "utf8"));
  const compatibility = JSON.parse(fs.readFileSync("dist/compatibility.json", "utf8"));
  assert.match(html, /data-selecto-api-console/);
  assert.match(html, /selecto-api-console\.js/);
  assert.match(css, /\.sac-query-layout/);
  assert.equal(manifest.format, "selecto.api-console.assets.v1");
  assert.equal(manifest.version, "0.4.0");
  assert.equal(compatibility.targets.length, 14);
  assert.equal(new Set(compatibility.targets.map((target) => target.lineage)).size, 11);
});
