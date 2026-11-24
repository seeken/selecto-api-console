const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");

const api = require("../dist/selecto-api-console.js");

test("exports a reusable browser and CommonJS surface", () => {
  assert.equal(api.version, "0.5.0");
  assert.equal(typeof api.APIConsole, "function");
  assert.equal(typeof api.mountAll, "function");
  const source = fs.readFileSync(require.resolve("../dist/selecto-api-console.js"), "utf8");
  assert.doesNotMatch(source, />Selecto API</);
});

test("links the Importer at the path every host mounts", () => {
  // Perl, Rails, Blazor and Django mount the importer page at <base>/import.
  const source = fs.readFileSync(require.resolve("../dist/selecto-api-console.js"), "utf8");
  assert.match(source, /importerLink\.href = `\$\{this\.base\}\/import`;/);
  assert.doesNotMatch(source, /\$\{this\.base\}\/importer`/);
});

test("takes the host's header links, keeping only same-origin paths", () => {
  const links = [
    {label: "Privileges", href: "/explorer/privileges?page=orders"},
    {label: "Elsewhere", href: "https://example.test/"},
    {label: "Protocol relative", href: "//example.test/"},
    {label: "", href: "/empty-label"},
    {href: "/no-label"},
  ];
  const consoleInstance = new api.APIConsole({dataset: {links: JSON.stringify(links)}});
  assert.deepEqual(consoleInstance.links, [{label: "Privileges", href: "/explorer/privileges?page=orders"}]);
  assert.deepEqual(new api.APIConsole({dataset: {}}).links, []);
  assert.deepEqual(new api.APIConsole({dataset: {links: "not json"}}).links, []);
});

test("hides narrow segments unless they are already selected", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {query_library: {segments: {
    active: {label: "Active", description: "Only active orders."},
    carrier_unassigned: {label: "Unassigned carrier", picker_hidden: true},
  }}};
  consoleInstance.state = {segments: []};
  assert.deepEqual(consoleInstance.segmentOptions().map((option) => option.value), ["active"]);
  assert.equal(consoleInstance.segmentOptions()[0].description, "Only active orders.");
  consoleInstance.state.segments = ["carrier_unassigned"];
  assert.deepEqual(consoleInstance.segmentOptions().map((option) => option.value), ["active", "carrier_unassigned"]);
  consoleInstance.state = {mode: "view", view: "saved", segments: []};
  consoleInstance.domain.query_library.views = {saved: {segments: ["carrier_unassigned"]}};
  assert.deepEqual(consoleInstance.segmentOptions().map((option) => option.value), ["active", "carrier_unassigned"]);
});

test("source groups keep descriptive names while hiding incidental IDs from column choices", () => {
  const domain = {
    name: "Orders",
    source: {source_table: "orders", primary_key: "id", fields: ["id", "state_code", "billto_party_id"],
      columns: {id: {type: "integer"}, state_code: {type: "string"}, billto_party_id: {type: "integer"}},
      associations: {bill_to: {queryable: "parties", owner_key: "billto_party_id"},
        order_state: {queryable: "order_states", owner_key: "state_code", related_key: "code"}}},
    schemas: {parties: {source_table: "parties", fields: ["id", "party_name"],
      columns: {id: {type: "integer"}, party_name: {label: "Party Name"}}, associations: {}},
    order_states: {source_table: "order_states", primary_key: "code", fields: ["id", "code", "label"],
      columns: {id: {type: "integer"}, code: {type: "string"}, label: {label: "Description"}}, associations: {}}},
    joins: {bill_to: {name: "Bill To"}, order_state: {name: "Status", type: "star_dimension", dimension_key: "state_code"}},
  };
  const fields = api.collectFields(domain);
  const byPath = new Map(fields.map((field) => [field.path, field]));
  assert.equal(byPath.get("bill_to.party_name").groupLabel, "Bill To");
  assert.equal(byPath.get("bill_to.party_name").leafLabel, "Party Name");
  assert.equal(byPath.get("id").pickerHidden, false);
  assert.equal(byPath.get("billto_party_id").pickerHidden, true, "no table name keeps its IDs visible");
  assert.equal(byPath.get("state_code").pickerHidden, true);
  assert.equal(byPath.get("bill_to.id").pickerHidden, true, "no table name keeps its IDs visible");
  assert.equal(byPath.get("order_state.id").pickerHidden, true);
  assert.equal(api.collectFilterFields(domain, fields).find((field) => field.path === "state_code").pickerHidden, false);
  const listed = new Map(api.collectFields({...domain, components: {picker_visible_id_paths: ["billto_party_id", "bill_to.id"]}})
    .map((field) => [field.path, field]));
  assert.equal(listed.get("billto_party_id").pickerHidden, false, "the domain lists the party number as visible");
  assert.equal(listed.get("bill_to.id").pickerHidden, false);
});

test("selected picker tones match repeated columns and filters remain addable", () => {
  assert.equal(api.pickTone("bill_to.party_name"), api.pickTone("bill_to.party_name"));
  assert.ok(api.pickTone("bill_to.party_name") >= 0 && api.pickTone("bill_to.party_name") < 8);
  const consoleInstance = new api.APIConsole({dataset: {}});
  const field = {path: "bill_to.party_name", label: "Bill To: Party Name", type: "string"};
  consoleInstance.filterFields = [field];
  consoleInstance.filterFieldMap = new Map([[field.path, field]]);
  consoleInstance.changed = () => {};
  const addFilter = {dataset: {sacAddFilter: field.path}};
  const event = {target: {closest: (selector) => selector === "[data-sac-add-filter]" ? addFilter : null}};
  consoleInstance.onClick(event);
  consoleInstance.onClick(event);
  assert.deepEqual(consoleInstance.state.filters.map((filter) => filter.field), [field.path, field.path]);
  assert.notEqual(consoleInstance.state.filters[0].id, consoleInstance.state.filters[1].id);
  let available;
  consoleInstance.renderAvailableFields = (kind, fields) => { available = {kind, fields}; };
  consoleInstance.renderFilterFieldList();
  assert.equal(available.kind, "filter");
  assert.deepEqual(available.fields.map((candidate) => candidate.path), [field.path]);
});

test("picker cards identify a field by path and data type beneath its title", () => {
  assert.equal(api.fieldSignature({path: "id", type: "integer"}), "id - integer");
  assert.equal(api.fieldSignature({path: "bill_to.party_name", type: "string"}),
    "bill_to.party_name - string");
});

test("segment picker groups keep Off, Yes and No mutually exclusive", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {query_library: {
    segments: {pdf_yes: {label: "PDF sent"}, pdf_no: {label: "PDF not sent"}, active: {label: "Active"}},
    segment_picker_groups: {pdf: {
      label: "PDF sent to customer",
      description: "Off includes both.",
      choices: [{segment: "pdf_yes", label: "Yes"}, {segment: "pdf_no", label: "No"}],
    }},
  }};
  consoleInstance.state = {segments: []};
  assert.deepEqual(consoleInstance.segmentOptions().map((option) => option.value), ["active"]);
  assert.equal(consoleInstance.segmentGroups()[0].offLabel, "Off");
  assert.equal(consoleInstance.segmentGroups()[0].description, "Off includes both.");
  assert.equal(consoleInstance.setSegmentGroupChoice("pdf", "pdf_yes"), true);
  consoleInstance.setUngroupedSegments(["active"]);
  assert.deepEqual(consoleInstance.state.segments, ["pdf_yes", "active"]);
  assert.equal(consoleInstance.setSegmentGroupChoice("pdf", "pdf_no"), true);
  assert.deepEqual(consoleInstance.state.segments, ["active", "pdf_no"]);
  assert.equal(consoleInstance.setSegmentGroupChoice("pdf", ""), true);
  assert.deepEqual(consoleInstance.state.segments, ["active"]);
  assert.equal(consoleInstance.setSegmentGroupChoice("pdf", "invalid"), false);
  assert.equal(consoleInstance.conflictingSegmentGroup(["pdf_yes", "pdf_no"]).id, "pdf");
  consoleInstance.domain.source = {associations: {}};
  consoleInstance.domain.schemas = {};
  consoleInstance.fields = [{path: "id", type: "integer"}];
  consoleInstance.fieldMap = new Map([["id", consoleInstance.fields[0]]]);
  assert.throws(
    () => consoleInstance.loadPayloadIntoChooser({select: ["id"], segments: ["pdf_yes", "pdf_no"]}),
    /PDF sent to customer allows only one choice/,
  );
});

test("conditional Service Level is one named API filter and accepts Explorer handoff", () => {
  const domain = {
    source: {
      fields: ["id", "account_id", "service_level_id"],
      columns: {id: {type: "integer"}, account_id: {type: "integer"},
        service_level_id: {type: "integer"}},
      associations: {},
    },
    schemas: {}, joins: {},
    components: {
      filter_picker_hidden_paths: ["service_level_id"],
      filter_choices: {account_service_level: {
        label: "Service Level", choices: [
          {value: "14", label: "Standard"}, {value: "15", label: "Priority"},
        ],
        conditional: {
          when_field: "account_id", present_field: "account_choice",
          absent_field: "order_choice",
        },
      }},
    },
  };
  const fields = api.collectFields(domain);
  const filterFields = api.collectFilterFields(domain, fields);
  assert.equal(filterFields.filter((field) => field.label === "Service Level").length, 1);
  assert.equal(filterFields.find((field) => field.path === "service_level_id").pickerHidden, true);
  assert.deepEqual(api.operatorsForField(filterFields.find((field) =>
    field.path === "account_service_level")), ["eq", "ne", "in", "not_in", "is_null", "not_null"]);
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = domain;
  consoleInstance.fields = fields;
  consoleInstance.fieldMap = new Map(fields.map((field) => [field.path, field]));
  consoleInstance.filterFields = filterFields;
  consoleInstance.filterFieldMap = new Map(filterFields.map((field) => [field.path, field]));
  consoleInstance.loadPayloadIntoChooser({
    select: ["id"], filters: [{field: "service_level_id", op: "eq", value: 14}],
  });
  assert.equal(consoleInstance.state.filters[0].field, "service_level_id");
  consoleInstance.loadPayloadIntoChooser({
    select: ["id"], filters: [
      {field: "account_service_level", op: "in", value: ["14", "15"]},
    ],
  });
  assert.deepEqual(consoleInstance.filterPayloads(consoleInstance.state.filters[0]),
    [{field: "account_service_level", op: "in", value: ["14", "15"]}]);
});

test("governed write controls follow canonical field types", () => {
  assert.equal(api.writeControlKind({type: "integer"}), "number");
  assert.equal(api.writeControlKind({type: "decimal"}), "number");
  assert.equal(api.writeControlKind({type: "epoch_datetime"}), "number");
  assert.equal(api.writeControlKind({type: "date"}), "date");
  assert.equal(api.writeControlKind({type: "utc_datetime"}), "datetime-local");
  assert.equal(api.writeControlKind({type: "boolean"}), "select");
  assert.equal(api.writeControlKind({type: "string"}), "text");
  assert.equal(api.writeControlKind({type: "object"}), "textarea");
  assert.equal(api.writeControlKind({type: "string", column: {enum: ["A", "B"]}}), "select");
  assert.equal(api.writeFieldRequired({required: true}, "insert"), true);
  assert.equal(api.writeFieldRequired({required: true}, "upsert"), true);
  assert.equal(api.writeFieldRequired({required: true}, "update"), false);
  assert.equal(api.writeRequiredValueMissing(true, ""), true);
  assert.equal(api.writeRequiredValueMissing(true, "   "), true);
  assert.equal(api.writeRequiredValueMissing(true, null), true);
  assert.equal(api.writeRequiredValueMissing(true, 0), false);
  assert.equal(api.writeRequiredValueMissing(true, false), false);
});

test("places required governed write fields before optional fields", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  const fields = [
    {name: "optional_first"}, {name: "required_one"},
    {name: "optional_second"}, {name: "required_two"},
  ];
  const contract = {
    optional_first: {insertable: true, updatable: true},
    required_one: {insertable: true, updatable: true, required: true},
    optional_second: {insertable: true, updatable: true},
    required_two: {insertable: true, updatable: true, required: true},
  };
  assert.deepEqual(
    consoleInstance.writeFieldsForOperation(fields, contract, "insert").map((field) => field.name),
    ["required_one", "required_two", "optional_first", "optional_second"],
  );
  assert.deepEqual(
    consoleInstance.writeFieldsForOperation(fields, contract, "update").map((field) => field.name),
    fields.map((field) => field.name),
  );
});

test("accepts canonical keyed action-input maps", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  assert.deepEqual(
    consoleInstance.actionInputSpecs({distance_km: {type: "number", required: true}}),
    [{id: "distance_km", type: "number", required: true}],
  );
});

test("offers Explorer-style quick periods only for temporal filters", () => {
  assert.ok(api.operatorsForType("date").includes("date_shortcut"));
  assert.ok(api.operatorsForType("epoch_datetime").includes("date_shortcut"));
  assert.ok(!api.operatorsForType("decimal").includes("date_shortcut"));
  for (const op of ["starts_with", "starts_with_ci", "text_contains", "text_contains_ci", "ends_with", "ends_with_ci"]) {
    assert.ok(api.operatorsForType("string").includes(op));
    assert.ok(api.operatorsForType("text").includes(op));
    for (const type of ["decimal", "integer", "boolean", "date", "utc_datetime"]) {
      assert.ok(!api.operatorsForType(type).includes(op));
    }
    assert.ok(!api.operatorsForField({type: "string", filterChoices: []}).includes(op));
  }
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

test("reads an Explorer query handoff from the URL fragment", () => {
  const payload = {select: [{field: "created", format: "iso_date"}], limit: 25};
  const hash = `#request=${encodeURIComponent(JSON.stringify(payload))}`;
  assert.deepEqual(api.requestPayloadFromLocation({hash}), payload);
  assert.equal(api.requestPayloadFromLocation({hash: "#tab=query"}), null);
  assert.throws(
    () => api.requestPayloadFromLocation({hash: "#request=%7Bbad"}),
    /not valid JSON/,
  );
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
      dataset: {apiBase: "/api2/orders/v1", curlAuth},
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
  const cookie = renderCurl("cookie");
  assert.match(cookie, /--cookie 'YOUR_SESSION_COOKIE'/);
  assert.match(cookie, /X-CSRF-Token: YOUR_CSRF_TOKEN/);
  assert.doesNotMatch(renderCurl("none"), /--basic|--user|--cookie/);
});

test("propagates host CSRF tokens on cookie-authenticated mutations", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-api-console.js"), "utf8");
  assert.match(source, /dataset\.csrfToken/);
  assert.match(source, /request\.headers\["X-CSRF-Token"\]/);
  assert.match(source, /response\.headers\.get\("X-CSRF-Token"\)/);
});

test("discovers safe OpenAPI operation headers for governed writes", () => {
  const openapi = {paths: {"/api2/orders/v1/write": {
    parameters: [
      {name: "X-Trace", in: "header", required: false},
      {name: "unsafe name", in: "header", required: true},
    ],
    post: {parameters: [{
      name: "If-Match", in: "header", required: true,
      description: "Current aggregate version.",
    }]},
  }}};
  assert.deepEqual(api.operationHeaderSpecs(
    openapi, "/api2/orders/v1/write",
  ), [
    {name: "X-Trace", required: false, description: ""},
    {name: "If-Match", required: true, description: "Current aggregate version."},
  ]);

  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.writePath = "/api2/orders/v1/write";
  consoleInstance.openapi = openapi;
  consoleInstance.domain = {
    source: {
      primary_key: "id", fields: ["id", "order_ref"],
      columns: {id: {type: "integer"}, order_ref: {type: "string"}},
    },
    writes: {
      operations: {update: {enabled: true}},
      fields: {order_ref: {updatable: true}},
    },
  };
  consoleInstance.seedMutationState();
  consoleInstance.writeState.included.order_ref = true;
  consoleInstance.writeState.assignments.order_ref = "CUSTOMER-123";
  consoleInstance.writeState.filters[0].value = "7001";
  assert.match(consoleInstance.buildWriteRequest().errors.join(" "), /If-Match request header is required/);
  consoleInstance.writeState.headers["If-Match"] = '"cm-version"';
  assert.doesNotMatch(consoleInstance.buildWriteRequest().errors.join(" "), /If-Match/);
});

test("shows host-declared write properties such as an order's lines", () => {
  const line = {
    type: "object", additionalProperties: false,
    properties: {description: {type: "string"}, line_no: {type: "integer"}},
  };
  const insertExample = [{description: "Packing crates", line_no: 1}, {description: "Display panels", line_no: 2}];
  const openapi = {
    paths: {"/api2/orders/v1/write": {post: {requestBody: {content: {
      "application/json": {schema: {$ref: "#/components/schemas/SelectoWrite"}},
    }}}}},
    components: {schemas: {
      OrderLine: line,
      SelectoWrite: {type: "object", properties: {
        operation: {type: "string"}, assignments: {type: "object"},
        expedite: {type: "boolean", description: "Expedite the order.", "x-selecto-operations": ["insert", "update"]},
        order_lines: {
          description: "Insert: the order lines (an array). Update: {add, update, remove}.",
          "x-selecto-operations": ["insert", "update"],
          "x-selecto-examples": {insert: insertExample, update: {add: [insertExample[0]], remove: [9001]}},
          oneOf: [{type: "array", items: {$ref: "#/components/schemas/OrderLine"}}],
        },
      }},
    }},
  };
  const path = "/api2/orders/v1/write";
  assert.deepEqual(api.writeExtensionSpecs(openapi, path).map((spec) => [spec.name, spec.boolean]),
    [["expedite", true], ["order_lines", false]], "governed properties are not repeated as extensions");
  assert.deepEqual(api.schemaExample(openapi, {oneOf: [{type: "array", items: {$ref: "#/components/schemas/OrderLine"}}]}, "insert"),
    [{description: "", line_no: 0}], "an example follows the schema when the host gives none");

  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.writePath = path;
  consoleInstance.openapi = openapi;
  consoleInstance.domain = {
    source: {
      primary_key: "id", fields: ["id", "order_ref"],
      columns: {id: {type: "integer"}, order_ref: {type: "string"}},
    },
    writes: {
      operations: {insert: {enabled: true}, update: {enabled: true}, delete: {enabled: true}},
      fields: {order_ref: {insertable: true, updatable: true}},
    },
  };
  consoleInstance.seedMutationState();
  assert.equal(consoleInstance.writeState.operation, "insert");
  assert.deepEqual(consoleInstance.writeExtensions().map((spec) => spec.name), ["expedite", "order_lines"]);
  assert.deepEqual(consoleInstance.writeExtensions("delete"), [], "delete takes no extra properties");
  const [, orderLines] = consoleInstance.writeExtensions();
  assert.deepEqual(JSON.parse(consoleInstance.writeExtensionExample(orderLines)), insertExample,
    "the insert example shows several order lines");
  assert.deepEqual(JSON.parse(consoleInstance.writeExtensionExample(orderLines, "update")).remove, [9001]);

  consoleInstance.writeState.included.order_ref = true;
  consoleInstance.writeState.assignments.order_ref = "PO-77";
  consoleInstance.writeState.extensions = {
    order_lines: {included: true, text: consoleInstance.writeExtensionExample(orderLines)},
    expedite: {included: true, text: "false"},
  };
  const built = consoleInstance.buildWriteRequest();
  assert.deepEqual(built.errors, []);
  assert.deepEqual(built.payload, {
    operation: "insert", assignments: {order_ref: "PO-77"}, expected_count: 1,
    order_lines: insertExample, expedite: false,
  });

  consoleInstance.loadWritePayloadIntoForm(built.payload);
  assert.deepEqual(consoleInstance.buildWriteRequest(), {payload: built.payload, errors: []},
    "a request with order lines loads back into the form");

  consoleInstance.writeState.extensions.order_lines.text = "[{";
  assert.deepEqual(consoleInstance.buildWriteRequest().errors, ["order_lines must be valid JSON."]);
  assert.throws(() => consoleInstance.writeStateFromPayload({operation: "insert", expedite: "yes"}), /expedite must be true or false/);
  assert.throws(() => consoleInstance.writeStateFromPayload({operation: "delete", order_lines: []}), /Unsupported write properties: order_lines/);
});

test("keeps a referenced write property's own hints and offers its example choices", () => {
  const openapi = {
    paths: {"/api2/orders/v1/write": {post: {requestBody: {content: {
      "application/json": {schema: {$ref: "#/components/schemas/SelectoWrite"}},
    }}}}},
    components: {schemas: {
      LocationRef: {description: "A location.", oneOf: [{type: "string"}, {type: "object"}]},
      SelectoWrite: {type: "object", properties: {
        operation: {type: "string"},
        origin: {
          $ref: "#/components/schemas/LocationRef",
          description: "The origin.",
          "x-selecto-operations": ["insert"],
          "x-selecto-examples": {insert: "shipper"},
          "x-selecto-example-choices": [
            {label: "Your own company", value: "shipper"},
            {label: "A location by key", value: {key: "SITE7"}},
            {label: "", value: "unlabelled"},
            {label: "No value"},
          ],
        },
      }},
    }},
  };
  const path = "/api2/orders/v1/write";
  const [origin] = api.writeExtensionSpecs(openapi, path);
  assert.deepEqual(origin.operations, ["insert"], "sibling hints survive the $ref");
  assert.equal(origin.description, "The origin.", "and take precedence over the target's");
  assert.ok(Array.isArray(origin.schema.oneOf), "while the target's schema is kept");
  assert.deepEqual(origin.choices.map((choice) => choice.label), ["Your own company", "A location by key"],
    "choices need a label and a value");

  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.writePath = path;
  consoleInstance.openapi = openapi;
  consoleInstance.domain = {
    source: {primary_key: "id", fields: ["id", "order_ref"], columns: {id: {type: "integer"}, order_ref: {type: "string"}}},
    writes: {operations: {insert: {enabled: true}}, fields: {order_ref: {insertable: true}}},
  };
  consoleInstance.seedMutationState();
  assert.equal(consoleInstance.writeExtensionExample(origin), '"shipper"');
  consoleInstance.chooseWriteExtensionExample("origin", "1");
  assert.deepEqual(consoleInstance.writeState.extensions.origin, {included: true, text: JSON.stringify({key: "SITE7"}, null, 2)},
    "choosing an example includes the property with it");
  consoleInstance.writeState.included.order_ref = true;
  consoleInstance.writeState.assignments.order_ref = "PO-1";
  assert.deepEqual(consoleInstance.buildWriteRequest().payload.origin, {key: "SITE7"});
  consoleInstance.chooseWriteExtensionExample("origin", "");
  assert.deepEqual(consoleInstance.buildWriteRequest().payload.origin, {key: "SITE7"}, "the placeholder changes nothing");
});

test("does not require a field while a host property given instead of it is included", () => {
  const path = "/api2/orders/v1/write";
  const openapi = {
    paths: {[path]: {post: {requestBody: {content: {
      "application/json": {schema: {$ref: "#/components/schemas/SelectoWrite"}},
    }}}}},
    components: {schemas: {SelectoWrite: {type: "object", properties: {
      operation: {type: "string"},
      origin: {type: "string", "x-selecto-operations": ["insert"], "x-selecto-replaces": ["origin_party_id", 7]},
    }}}},
  };
  assert.deepEqual(api.writeExtensionSpecs(openapi, path)[0].replaces, ["origin_party_id"]);
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.writePath = path;
  consoleInstance.openapi = openapi;
  consoleInstance.domain = {
    source: {primary_key: "id", fields: ["id", "origin_party_id", "order_ref"],
      columns: {id: {type: "integer"}, origin_party_id: {type: "integer", label: "Origin ID"}, order_ref: {type: "string"}}},
    writes: {operations: {insert: {enabled: true}},
      fields: {origin_party_id: {insertable: true, required: true}, order_ref: {insertable: true}}},
  };
  consoleInstance.seedMutationState();
  Object.assign(consoleInstance.writeState.included, {origin_party_id: true, order_ref: true});
  Object.assign(consoleInstance.writeState.assignments, {origin_party_id: "", order_ref: "PO-1"});
  assert.ok(consoleInstance.buildWriteRequest().errors.some((error) => /origin_party_id\) is required/.test(error)),
    "the field is required without the property");

  consoleInstance.writeState.extensions = {origin: {included: true, text: '"shipper"'}};
  assert.deepEqual(consoleInstance.buildWriteRequest(), {
    payload: {operation: "insert", assignments: {order_ref: "PO-1"}, expected_count: 1, origin: "shipper"},
    errors: [],
  }, "with it, the blank field is left out");
  consoleInstance.writeState.assignments.origin_party_id = "12";
  assert.deepEqual(consoleInstance.buildWriteRequest().errors, ["Give origin_party_id or origin, not both."]);
});

test("groups a required field with the properties it can be given as", () => {
  const path = "/api2/orders/v1/write";
  const openapi = {
    paths: {[path]: {post: {requestBody: {content: {
      "application/json": {schema: {$ref: "#/components/schemas/SelectoWrite"}},
    }}}}},
    components: {schemas: {SelectoWrite: {type: "object", properties: {
      operation: {type: "string"},
      origin: {type: "object", "x-selecto-operations": ["insert", "update"], "x-selecto-replaces": ["origin_party_id"],
        "x-selecto-examples": {insert: "shipper"}},
      origin_key: {type: "string", "x-selecto-operations": ["insert", "update"], "x-selecto-replaces": ["origin_party_id"],
        "x-selecto-examples": {insert: "SITE7"}},
      expedite: {type: "boolean"},
    }}}},
  };
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.writePath = path;
  consoleInstance.openapi = openapi;
  consoleInstance.domain = {
    source: {primary_key: "id", fields: ["id", "origin_party_id"],
      columns: {id: {type: "integer"}, origin_party_id: {type: "integer", label: "Origin ID"}}},
    writes: {operations: {insert: {enabled: true}, update: {enabled: true}},
      fields: {origin_party_id: {insertable: true, updatable: true, required: true}}},
  };
  consoleInstance.seedMutationState();
  assert.deepEqual(Array.from(consoleInstance.writeAlternatives().get("origin_party_id"), (spec) => spec.name),
    ["origin", "origin_key"]);
  assert.equal(consoleInstance.writeAlternatives("update").size, 0, "only where the field is required");
  assert.equal(consoleInstance.writeAlternativeChoice("origin_party_id", consoleInstance.writeAlternatives().get("origin_party_id")), "origin_party_id",
    "the field itself is chosen first");
  assert.match(consoleInstance.buildWriteRequest().errors.join("\n"),
    /Origin ID \(origin_party_id\) is required for insert: give one of origin_party_id, origin, origin_key\./);

  consoleInstance.chooseWriteAlternative("origin_party_id", "origin_key");
  assert.equal(consoleInstance.writeState.included.origin_party_id, false);
  assert.deepEqual(consoleInstance.writeState.extensions.origin_key, {included: true, text: '"SITE7"'},
    "choosing a property includes it with its example");
  assert.deepEqual(consoleInstance.buildWriteRequest(), {
    payload: {operation: "insert", assignments: {}, expected_count: 1, origin_key: "SITE7"},
    errors: ["Choose at least one assignment."],
  });
  consoleInstance.chooseWriteAlternative("origin_party_id", "origin");
  assert.equal(consoleInstance.writeState.extensions.origin_key.included, false, "one form at a time");
  assert.equal(consoleInstance.writeAlternativeChoice("origin_party_id", consoleInstance.writeAlternatives().get("origin_party_id")), "origin");
  consoleInstance.chooseWriteAlternative("origin_party_id", "origin_party_id");
  assert.equal(consoleInstance.writeState.included.origin_party_id, true);
  assert.equal(consoleInstance.writeState.extensions.origin.included, false);
});

test("builds write and resolved action cURL commands from their current JSON", () => {
  const consoleInstance = new api.APIConsole({dataset: {curlAuth: "basic"}});
  const previousWindow = global.window;
  global.window = {location: {origin: "https://tenant.example"}};
  try {
    const write = consoleInstance.curlCommand(
      "/api2/orders/v1/write", '{"operation":"insert"}',
    );
    assert.match(write, /curl -X POST 'https:\/\/tenant\.example\/api2\/orders\/v1\/write'/);
    assert.match(write, /--basic/);
    assert.match(write, /--user 'YOUR_USERNAME:YOUR_PASSWORD'/);
    assert.match(write, /--data-binary '\{"operation":"insert"\}'/);
    const conditionalWrite = consoleInstance.curlCommand(
      "/api2/orders/v1/write", '{"operation":"update"}', "json", "",
      {"If-Match": '"cm-version"'},
    );
    assert.match(conditionalWrite, /-H 'If-Match: "cm-version"'/);
    const resourceGet = consoleInstance.getCurlCommand(
      "/api2/orders/v1/resources/7001?fields=status,origin.city",
    );
    assert.match(resourceGet, /curl -X GET 'https:\/\/tenant\.example\/api2\/orders\/v1\/resources\/7001\?fields=status,origin\.city'/);
    assert.doesNotMatch(resourceGet, /--data-binary|Content-Type/);

    const action = consoleInstance.curlCommand(
      "/api2/orders/v1/actions/place_hold", '{"target":{"ids":[7]}}',
    );
    assert.match(action, /\/api2\/orders\/v1\/actions\/place_hold'/);
    assert.match(action, /--data-binary '\{"target":\{"ids":\[7\]\}\}'/);

    consoleInstance.queryResponseFormats = api.discoverQueryResponseFormats({
      paths: {"/api2/orders/v1/query": {post: {responses: {200: {content: {
        "application/json": {}, "text/csv": {},
      }}}}}},
    }, "/api2/orders/v1/query");
    const csv = consoleInstance.curlCommand(
      "/api2/orders/v1/query", '{"select":["id"]}', "csv", "September Orders.csv",
    );
    assert.match(csv, /-H 'Accept: text\/csv'/);
    assert.match(csv, /filename=September%20Orders\.csv/);
    assert.match(csv, /--output 'September Orders\.csv'/);
  } finally {
    global.window = previousWindow;
  }
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
      {method: "GET", operation_id: "getCustomerResourceVersion", path: "/api/v1/orders/resources/{id}"},
      {operation_id: "writeDomain", path: "/api/v1/orders/write"},
      {operation_id: "executeAction", path: "/api/v1/orders/actions/{action}"},
    ]};
    if (path.endsWith("/domain")) return {source: {columns: {}}};
    return {openapi: "3.1.0", paths: {"/api/v1/orders/query": {post: {
      responses: {200: {content: {
        "application/json": {},
        "text/csv": {},
        "text/tab-separated-values": {},
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {},
      }}},
    }}}};
  });
  assert.equal(discovered.writePath, "/api/v1/orders/write");
  assert.equal(discovered.resourcePath, "/api/v1/orders/resources/{id}");
  assert.equal(discovered.actionPath, "/api/v1/orders/actions/{action}");
  assert.deepEqual(discovered.queryResponseFormats.map((format) => format.id), [
    "json", "csv", "tsv", "xlsx",
  ]);
});

test("discovers the canonical getResource route", async () => {
  const discovered = await api.discoverCanonicalAPI("/api2/orders/v1", async (path) => {
    if (path.endsWith("/")) return {routes: [
      {operation_id: "getDomain", path: "/api2/orders/v1/domain"},
      {operation_id: "queryDomain", path: "/api2/orders/v1/query"},
      {method: "GET", operation_id: "getResource", path: "/api2/orders/v1/resources/{id}"},
    ]};
    if (path.endsWith("/domain")) return {source: {columns: {}}};
    return {openapi: "3.1.0", paths: {}};
  });
  assert.equal(discovered.resourcePath, "/api2/orders/v1/resources/{id}");
});

test("offers POST and GET as radio buttons, not a select", () => {
  const source = fs.readFileSync(require.resolve("../dist/selecto-api-console.js"), "utf8");
  assert.match(source, /<input type="radio" name="sac-query-method" value="post" data-sac-query-method>/);
  assert.match(source, /<input type="radio" name="sac-query-method" value="get" data-sac-query-method>/);
  assert.doesNotMatch(source, /<select id="sac-query-method"/);
  assert.match(source, /choose Aggregate Version, when the domain publishes it/);
  assert.match(source, /\[data-sac-query-method-group\]"\)\.hidden = !this\.resourcePath/);
});

test("uses safe response download filenames", () => {
  assert.equal(api.downloadFilename('attachment; filename="orders-query.csv"', "query.csv"), "orders-query.csv");
  assert.equal(api.downloadFilename('attachment; filename="../../unsafe name.csv"', "query.csv"), "unsafe name.csv");
  assert.equal(api.downloadFilename('attachment; filename="bad..name.csv"', "query.csv"), "query-download");
  assert.equal(api.downloadFilename("", "query.tsv"), "query.tsv");
});

test("builds safe sparse-field resource GET requests", () => {
  assert.equal(
    api.safeResourcePathTemplate(
      "/api2/orders/v1/resources/{id}", "/api2/orders/v1",
    ),
    "/api2/orders/v1/resources/{id}",
  );
  assert.equal(api.safeResourcePathTemplate(
    "//other.test/resources/{id}", "/api2/orders/v1",
  ), "");
  assert.equal(
    api.resourceRequestPath(
      "/api2/orders/v1/resources/{id}", "7001",
      ["status", "origin.city", "status"],
    ),
    "/api2/orders/v1/resources/7001?fields=status,origin.city",
  );

  const domain = {
    source: {
      primary_key: "id",
      columns: {id: {type: "integer"}},
      associations: {
        origin: {queryable: "parties", owner_key: "origin_party_id", related_key: "id"},
        order_lines: {queryable: "order_lines", owner_key: "id", related_key: "order_id", cardinality: "many"},
      },
    },
    schemas: {
      parties: {primary_key: "id", associations: {}},
      order_lines: {primary_key: "id", associations: {}},
    },
  };
  assert.equal(api.fieldTraversesMany(domain, "origin.city"), false);
  assert.equal(api.fieldTraversesMany(domain, "order_lines.description"), true);

  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = domain;
  consoleInstance.resourcePath = "/api2/orders/v1/resources/{id}";
  consoleInstance.state.queryMethod = "get";
  consoleInstance.state.resourceId = "7001";
  consoleInstance.state.selectedFields = [
    {field: "id"}, {field: "status"}, {field: "origin.city"},
  ];
  assert.deepEqual(consoleInstance.buildResourceRequest(), {
    path: "/api2/orders/v1/resources/7001?fields=status,origin.city",
    fields: ["status", "origin.city"], errors: [],
  });
  consoleInstance.state.selectedFields.push({field: "order_lines.description"});
  assert.match(consoleInstance.buildResourceRequest().errors.join(" "), /to-many relationship/);

  const switcher = new api.APIConsole({dataset: {}});
  switcher.domain = domain;
  switcher.resourcePath = "/api2/orders/v1/resources/{id}";
  switcher.state.selectedFields = [
    {id: "1", field: "status", alias: "current_status", format: ""},
    {id: "2", field: "order_lines.description", alias: "", format: ""},
  ];
  switcher.state.subtables = ["order_lines"];
  assert.equal(switcher.setQueryMethod("get"), "get");
  assert.deepEqual(switcher.state.selectedFields, [
    {id: "1", field: "status", alias: "", format: ""},
  ]);
  assert.deepEqual(switcher.state.subtables, []);
  switcher.state.selectedFields.push({id: "3", field: "origin.city", alias: "", format: ""});
  assert.equal(switcher.setQueryMethod("post"), "post");
  assert.deepEqual(switcher.state.selectedFields.map((selection) => selection.field), [
    "status", "order_lines.description",
  ]);
  assert.deepEqual(switcher.state.subtables, ["order_lines"]);
  assert.equal(switcher.setQueryMethod("get"), "get");
  assert.deepEqual(switcher.state.selectedFields.map((selection) => selection.field), [
    "status", "origin.city",
  ]);
});

test("requires a safe download filename with the selected extension", () => {
  const csv = {id: "csv", extension: "csv"};
  assert.deepEqual(api.validateDownloadFilename("September Orders.csv", csv), {
    value: "September Orders.csv", error: "",
  });
  assert.match(api.validateDownloadFilename("September Orders.xlsx", csv).error, /ending in \.csv/);
  assert.match(api.validateDownloadFilename("../orders.csv", csv).error, /safe name/);
  assert.deepEqual(api.validateDownloadFilename("ignored", {id: "json", extension: "json"}), {
    value: "", error: "",
  });
  assert.equal(api.suggestedDownloadFilename("Order API", "xlsx"), "order-api-query.xlsx");
  assert.equal(
    api.pathWithDownloadFilename("/api2/orders/v1/query", "September Orders.csv"),
    "/api2/orders/v1/query?filename=September%20Orders.csv",
  );
});

test("honors server-advertised API surface access", async () => {
  const discovered = await api.discoverCanonicalAPI("/api2/orders/v1", async (path) => {
    if (path.endsWith("/")) return {
      access: {read: true, write: false, action: false, importer: true},
      routes: [
        {operation_id: "getDomain", path: "/api2/orders/v1/domain"},
        {operation_id: "getOpenApi", path: "/api2/orders/v1/openapi.json"},
        {operation_id: "queryDomain", path: "/api2/orders/v1/query"},
      ],
    };
    if (path.endsWith("/domain")) return {source: {columns: {}}};
    return {openapi: "3.1.0"};
  });
  assert.deepEqual(discovered.access, {
    read: true, write: false, action: false, importer: true,
  });
  assert.equal(api.initialSurfaceTab(discovered.access), "query");
  assert.equal(api.initialSurfaceTab({read: false, write: true, action: false}), "writes");
  assert.equal(api.initialSurfaceTab({read: false, write: false, action: false}), "domain");
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
    relationships: {},
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

test("reports omitted required insert fields before sending", () => {
  const consoleInstance = new api.APIConsole({dataset: {apiBase: "/api/v1/orders"}});
  consoleInstance.domain = {
    source: {
      primary_key: "id", fields: ["id", "account_id", "name"],
      columns: {
        id: {type: "integer"}, account_id: {type: "integer", label: "Account"},
        name: {type: "string", label: "Name"},
      },
    },
    writes: {
      operations: {insert: {enabled: true}},
      fields: {
        account_id: {insertable: true, required: true},
        name: {insertable: true, required: true},
      },
    },
  };
  consoleInstance.writeState = {
    operation: "insert", assignments: {name: "Order 77"},
    included: {name: true}, filters: [], expectedCount: 1, returning: [],
    conflictTarget: [], updateFields: [], relationships: {},
  };
  assert.deepEqual(consoleInstance.buildWriteRequest().errors, [
    "Account (account_id) is required for insert.",
  ]);
  consoleInstance.writeState.assignments.account_id = "1001";
  consoleInstance.writeState.included.account_id = true;
  const valid = consoleInstance.buildWriteRequest();
  assert.deepEqual(valid.errors, []);
  assert.deepEqual(valid.payload.assignments, {name: "Order 77", account_id: 1001});

  consoleInstance.writeState.assignments.name = "   ";
  assert.deepEqual(consoleInstance.buildWriteRequest().errors, [
    "Name (name) is required for insert.",
  ]);
});

test("rejects blank and invalid date assignments before sending", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  assert.match(
    consoleInstance.coerceValue("", "date", "Delivered On").error,
    /must be an ISO date.*uncheck it to omit it/,
  );
  assert.match(
    consoleInstance.coerceValue("2026-02-30", "date", "Delivered On").error,
    /must be an ISO date/,
  );
  assert.deepEqual(
    consoleInstance.coerceValue("2026-02-28", "date", "Delivered On"),
    {value: "2026-02-28"},
  );
});

test("builds a governed nested relationship write", () => {
  const consoleInstance = new api.APIConsole({dataset: {apiBase: "/api/v1/orders"}});
  consoleInstance.domain = {
    source: {
      primary_key: "id", fields: ["id", "order_ref"],
      columns: {id: {type: "integer"}, order_ref: {type: "string"}},
    },
    writes: {
      operations: {update: {enabled: true}},
      fields: {order_ref: {updatable: true}},
      relationships: {
        carrier: {
          writable: true, cardinality: "one", allowed_ops: ["update"],
          domain: {
            source: {
              primary_key: "id", fields: ["id", "party_name"],
              columns: {id: {type: "integer"}, party_name: {type: "string"}},
            },
            writes: {
              operations: {update: {enabled: true}},
              fields: {party_name: {updatable: true}},
            },
          },
        },
      },
    },
  };
  consoleInstance.writeState = {
    operation: "update", assignments: {order_ref: "PO-1A"},
    included: {order_ref: true}, filters: [{field: "id", op: "eq", value: "7"}],
    expectedCount: 1, returning: [], conflictTarget: [], updateFields: [],
    relationships: {carrier: {
      enabled: true, operation: "update", assignments: {party_name: "North Yard"},
      included: {party_name: true}, returning: [],
    }},
  };
  const model = consoleInstance.buildWriteRequest();
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.payload.relationships, {
    carrier: {operation: "update", assignments: {party_name: "North Yard"}},
  });
});

test("loads governed write JSON into the write form without losing nested data", () => {
  const consoleInstance = new api.APIConsole({dataset: {apiBase: "/api/v1/orders"}});
  consoleInstance.domain = {
    source: {
      primary_key: "id", fields: ["id", "order_ref", "delivered_on"],
      columns: {
        id: {type: "integer"}, order_ref: {type: "string", label: "Description"},
        delivered_on: {type: "date", label: "Delivered on"},
      },
    },
    writes: {
      operations: {update: {enabled: true}},
      fields: {order_ref: {updatable: true}, delivered_on: {updatable: true}},
      relationships: {
        carrier: {
          writable: true, cardinality: "one", allowed_ops: ["update"],
          domain: {
            source: {
              primary_key: "id", fields: ["id", "party_name"],
              columns: {id: {type: "integer"}, party_name: {type: "string", label: "Description"}},
            },
            writes: {
              operations: {update: {enabled: true}},
              fields: {party_name: {updatable: true}},
            },
          },
        },
      },
    },
  };
  const payload = {
    operation: "update",
    assignments: {order_ref: "PO-9", delivered_on: "2026-09-14"},
    filters: [{field: "id", op: "eq", value: 9}],
    expected_count: 1,
    returning: ["id", "order_ref"],
    relationships: {
      carrier: {
        operation: "update", assignments: {party_name: "North Yard"}, returning: ["id"],
      },
    },
  };
  consoleInstance.loadWritePayloadIntoForm(payload);
  assert.deepEqual(consoleInstance.buildWriteRequest(), {payload, errors: []});
  assert.equal(consoleInstance.writeState.assignments.id, undefined);
  assert.equal(consoleInstance.writeState.relationships.carrier.enabled, true);
});

test("rejects unrepresentable write JSON atomically", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {
    source: {primary_key: "id", fields: ["id", "name"], columns: {id: {type: "integer"}, name: {type: "string"}}},
    writes: {operations: {insert: {enabled: true}}, fields: {name: {insertable: true}}},
  };
  const before = JSON.parse(JSON.stringify(consoleInstance.writeState));
  assert.throws(
    () => consoleInstance.loadWritePayloadIntoForm({operation: "insert", assignments: {name: "Order"}, raw_sql: "no"}),
    /Unsupported write properties: raw_sql/,
  );
  assert.deepEqual(consoleInstance.writeState, before);
});

test("loads a filter-first update draft before an assignment is chosen", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {
    source: {
      primary_key: "id", fields: ["id", "description"],
      columns: {id: {type: "integer"}, description: {type: "string", label: "Description"}},
    },
    writes: {
      operations: {update: {enabled: true}},
      fields: {description: {updatable: true}},
    },
  };
  const payload = {
    operation: "update",
    filters: [{field: "id", op: "eq", value: 17}],
    expected_count: 1,
  };
  consoleInstance.loadWritePayloadIntoForm(payload);
  assert.equal(consoleInstance.writeState.operation, "update");
  assert.deepEqual(consoleInstance.writeState.filters, [{field: "id", op: "eq", value: "17"}]);
  assert.deepEqual(consoleInstance.writeState.assignments, {});
  assert.deepEqual(consoleInstance.writeState.included, {});
  assert.deepEqual(consoleInstance.buildWriteRequest().errors, ["Choose at least one assignment."]);
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
      id: "consolidate", inputs: [], selection: {mode: "groups", max_groups: 6, group_inputs: [
        {id: "carrier_party_id", label: "Carrier", type: "lookup", value_type: "integer", required: true},
      ]},
    }],
  }}}};
  consoleInstance.actionState = {id: "consolidate", targetIds: "", inputs: {}, groups: [
    {ids: "1, 2", inputs: {carrier_party_id: "44"}},
    {ids: "3", inputs: {carrier_party_id: "45"}},
  ]};
  const model = consoleInstance.buildActionRequest();
  assert.deepEqual(model.errors, []);
  assert.deepEqual(model.payload.target.ids, [1, 2, 3]);
  assert.deepEqual(model.payload.groups, [
    {index: 0, selected_ids: [1, 2], inputs: {carrier_party_id: 44}},
    {index: 1, selected_ids: [3], inputs: {carrier_party_id: 45}},
  ]);
});

test("loads grouped action JSON into the selected action form", () => {
  const consoleInstance = new api.APIConsole({dataset: {apiBase: "/api/v1/orders"}});
  consoleInstance.domain = {source: {primary_key: "id", columns: {id: {type: "integer"}}}, actions: {}};
  consoleInstance.actionPath = "/api/v1/orders/actions/{action}";
  consoleInstance.openapi = {paths: {"/api/v1/orders/actions/{action}": {post: {
    "x-selecto-actions": [{
      id: "consolidate", inputs: [{id: "note", type: "textarea"}],
      selection: {mode: "groups", max_groups: 6, group_inputs: [
        {id: "carrier_party_id", label: "Carrier", type: "lookup", value_type: "integer", required: true},
      ]},
    }],
  }}}};
  consoleInstance.actionState.id = "consolidate";
  const payload = {
    target: {ids: [1, 2, 3]}, inputs: {note: "Handle together"},
    groups: [
      {index: 0, selected_ids: [1, 2], inputs: {carrier_party_id: 44}},
      {index: 1, selected_ids: [3], inputs: {carrier_party_id: 45}},
    ],
  };
  consoleInstance.loadActionPayloadIntoForm(payload);
  assert.deepEqual(consoleInstance.buildActionRequest(), {
    path: "/api/v1/orders/actions/consolidate", payload, errors: [],
  });
});

test("rejects action JSON that cannot map to the selected form without changing state", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {source: {primary_key: "id", columns: {id: {type: "integer"}}}, actions: {}};
  consoleInstance.actionPath = "/api/v1/orders/actions/{action}";
  consoleInstance.openapi = {paths: {"/api/v1/orders/actions/{action}": {post: {
    "x-selecto-actions": [{id: "archive", inputs: []}],
  }}}};
  consoleInstance.actionState.id = "archive";
  const before = JSON.parse(JSON.stringify(consoleInstance.actionState));
  assert.throws(
    () => consoleInstance.loadActionPayloadIntoForm({target: {ids: [1]}, inputs: {}, groups: []}),
    /does not use target groups/,
  );
  assert.deepEqual(consoleInstance.actionState, before);
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
        origin: {queryable: "parties"},
        destination: {queryable: "parties"},
        orders: {queryable: "order"},
      },
    },
    schemas: {
      order: {fields: ["total"], columns: {total: {type: "decimal", label: "Order total"}}},
      parties: {fields: ["city"], columns: {city: {type: "string", label: "City"}}},
    },
    joins: {origin: {name: "Origin"}, destination: {name: "Destination"}},
  });
  assert.deepEqual(fields.map((field) => field.path), [
    "name", "destination.city", "id", "orders.total", "origin.city",
  ]);
  assert.equal(fields.find((field) => field.path === "origin.city").label, "Origin: City");
  assert.equal(fields.find((field) => field.path === "destination.city").label, "Destination: City");
  assert.equal(fields.find((field) => field.path === "orders.total").label, "Orders: Order total");
});

test("infers canonical to-many associations when cardinality is omitted", () => {
  const schemas = {
    order_lines: {primary_key: "id"},
    parties: {primary_key: "id"},
  };
  assert.equal(api.associationIsMany({
    queryable: "order_lines", related_key: "order_id",
  }, schemas), true);
  assert.equal(api.associationIsMany({
    queryable: "parties", related_key: "id",
  }, schemas), false);
  assert.equal(api.associationIsMany({
    queryable: "order_lines", related_key: "order_id", cardinality: "one",
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
        order_lines: {queryable: "order_lines", related_key: "order_id"},
      }},
      schemas: {order_lines: {primary_key: "id"}},
    };
    consoleInstance.openapi = {components: {schemas: {SelectoQuery: {properties: {
      select: {items: {oneOf: [
        {type: "string"},
        {$ref: "#/components/schemas/SelectoSubtableSelection"},
      ]}},
    }}}}};
    consoleInstance.state.selectedFields = [{field: "order_lines.description"}];
    consoleInstance.renderNormalization();
    assert.equal(container.hidden, false);
    assert.equal(container.children[0].textContent, "To-many relationships");
    const checkbox = container.children[1].children[0];
    assert.equal(checkbox.type, "checkbox");
    assert.equal(checkbox.value, "order_lines");
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
  const descriptor = {id: "status", label: "Status", type: "string", encoding: "string", nullable: false};
  assert.equal(api.rowValue([7, "A"], descriptor, 1), "A");
  assert.equal(api.rowValue({id: 7, status: "A"}, descriptor, 1), "A");
});

test("names result columns from typed descriptors or bare ids", () => {
  assert.equal(api.columnId("status"), "status");
  assert.equal(api.columnLabel("status"), "status");
  assert.equal(api.columnId({id: "price", label: "Price", type: "decimal"}), "price");
  assert.equal(api.columnLabel({id: "price", label: "Price", type: "decimal"}), "Price");
  assert.equal(api.columnLabel({id: "price", label: "", type: "decimal"}), "price");
  assert.equal(api.columnLabel({id: "price", type: "decimal"}), "price");
});

test("renders result headers and cells for both column shapes", () => {
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
    const nodes = {
      "[data-sac-empty-response]": new FakeNode("p"),
      "[data-sac-response-json]": new FakeNode("pre"),
      "[data-sac-result-head]": new FakeNode("thead"),
      "[data-sac-result-body]": new FakeNode("tbody"),
    };
    const consoleInstance = new api.APIConsole({dataset: {}, querySelector: (selector) => nodes[selector] || null});
    consoleInstance.updateCurl = () => {};
    consoleInstance.switchResultTab = (tab) => { consoleInstance.shownTab = tab; };
    const table = () => ({
      head: nodes["[data-sac-result-head]"].children[0].children.map((th) => [th.textContent, th.title]),
      cells: nodes["[data-sac-result-body]"].children.map((tr) => tr.children.map((td) => td.textContent)),
    });
    const typed = [
      {id: "id", label: "ID", field: "id", type: "integer", encoding: "json", nullable: false},
      {id: "price", label: "Price", field: "price", type: "decimal", encoding: "decimal-string", nullable: false},
      {id: "note", label: "note", field: "note", type: "string", encoding: "string", nullable: true},
    ];
    consoleInstance.renderResponse({ok: true, data: {columns: typed, rows: [[3, "8.00", null]]}});
    assert.deepEqual(table(), {
      head: [["ID", "id"], ["Price", "price"], ["note", undefined]],
      cells: [["3", "8.00", "NULL"]],
    });
    assert.equal(consoleInstance.shownTab, "table");
    consoleInstance.renderResponse({ok: true, data: {columns: typed, row_format: "objects",
      rows: [{id: 3, price: "8.00", note: "boxed"}]}});
    assert.deepEqual(table().cells, [["3", "8.00", "boxed"]]);
    consoleInstance.renderResponse({ok: true, data: {columns: ["id", "price"], rows: [[3, "8.00"]]}});
    assert.deepEqual(table(), {head: [["id", undefined], ["price", undefined]], cells: [["3", "8.00"]]});
    consoleInstance.renderResponse({ok: true, data: {columns: ["id", "price"], rows: [{id: 3, price: "8.00"}]}});
    assert.deepEqual(table().cells, [["3", "8.00"]]);
  } finally {
    global.document = previousDocument;
  }
});

test("builds configured field aliases and formats from picked fields", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {query_library: {}};
  consoleInstance.state.selectedFields = [
    {id: "1", field: "id", alias: "", format: ""},
    {id: "2", field: "origin.city", alias: "pickup_city", format: ""},
    {id: "3", field: "pickup_at", alias: "pickup_month", format: "month"},
  ];
  consoleInstance.state.timezone = "America/New_York";
  consoleInstance.state.rowFormat = "objects";
  assert.deepEqual(consoleInstance.buildPayload().select, [
    "id",
    {field: "origin.city", alias: "pickup_city"},
    {field: "pickup_at", alias: "pickup_month", format: "month"},
  ]);
  assert.equal(consoleInstance.buildPayload().timezone, "America/New_York");
  assert.equal(consoleInstance.buildPayload().row_format, "objects");
});

test("groups explicitly selected to-many relationships into sub-arrays", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {query_library: {}};
  consoleInstance.state.selectedFields = [
    {id: "1", field: "id", alias: "", format: ""},
    {id: "2", field: "order_lines.description", alias: "", format: ""},
  ];
  consoleInstance.state.subtables = ["order_lines"];
  assert.deepEqual(consoleInstance.buildPayload().select, ["id", ["order_lines.description"]]);
});

test("loads representable request JSON back into every chooser level", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {
    source: {associations: {order_lines: {queryable: "order_lines", related_key: "order_id"}}},
    schemas: {order_lines: {primary_key: "id"}},
    query_library: {
      segments: {active: {parameters: {account_id: {type: "integer"}}}},
      orderings: {}, projections: {}, views: {},
    },
  };
  consoleInstance.openapi = {components: {schemas: {SelectoSelection: {properties: {
    format: {enum: ["day"]},
  }}}}};
  consoleInstance.fields = [
    {path: "id", type: "integer"},
    {path: "order_lines.description", type: "string"},
    {path: "order_lines.updated_at", type: "epoch_datetime"},
  ];
  consoleInstance.fieldMap = new Map(consoleInstance.fields.map((field) => [field.path, field]));
  consoleInstance.filterFields = api.collectFilterFields(consoleInstance.domain, consoleInstance.fields);
  consoleInstance.filterFieldMap = new Map(consoleInstance.filterFields.map((field) => [field.path, field]));
  const payload = {
    select: ["id", ["order_lines.description", {field: "order_lines.updated_at", alias: "updated_day", format: "day"}]],
    segments: ["active"], parameters: {account_id: 1001},
    filters: [{field: "id", op: "gte", value: 10}],
    order_by: [{field: "id", direction: "desc"}],
    timezone: "America/New_York", row_format: "objects", limit: 25, offset: 5,
  };
  consoleInstance.loadPayloadIntoChooser(payload);
  assert.deepEqual(consoleInstance.buildPayload(), payload);
  assert.deepEqual(consoleInstance.state.subtables, ["order_lines"]);
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
  assert.equal(manifest.version, "0.5.0");
  assert.equal(compatibility.targets.length, 14);
  assert.equal(new Set(compatibility.targets.map((target) => target.lineage)).size, 11);
});

test("offers choice filters only the operators their field type accepts", () => {
  const yesNo = {path: "consolidate_ready", type: "boolean", filterChoices: [{value: "true", label: "Yes"}, {value: "false", label: "No"}]};
  assert.deepEqual(api.operatorsForField(yesNo), ["eq", "ne", "is_null", "not_null"]);
  assert.equal(api.initialFilterOperator(yesNo), "eq");
  const status = {path: "status", type: "integer", filterChoices: [{value: "1", label: "Open"}]};
  assert.deepEqual(api.operatorsForField(status), ["eq", "ne", "in", "not_in", "is_null", "not_null"]);
  assert.equal(api.initialFilterOperator(status), "in");
  assert.equal(api.initialFilterOperator({path: "name", type: "string"}), "eq");

  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {query_library: {}};
  consoleInstance.fields = [{path: "consolidate_ready", type: "boolean", label: "Consolidation ready"}];
  consoleInstance.fieldMap = new Map(consoleInstance.fields.map((field) => [field.path, field]));
  consoleInstance.filterFieldMap = new Map([["consolidate_ready", yesNo]]);
  assert.throws(() => consoleInstance.chooserStateFromPayload({select: ["consolidate_ready"], filters: [
    {field: "consolidate_ready", op: "in", value: ["true"]},
  ]}), /in filter is not available for consolidate_ready/);
  assert.equal(consoleInstance.chooserStateFromPayload({select: ["consolidate_ready"], filters: [
    {field: "consolidate_ready", op: "eq", value: "true"},
  ]}).draft.filters[0].op, "eq");
});

test("honors published filterable and sortable field roles", () => {
  assert.equal(api.fieldRoleAllowed({}, "filter"), true);
  assert.equal(api.fieldRoleAllowed({filterable: false}, "filter"), false);
  assert.equal(api.fieldRoleAllowed({query_filterable: false}, "filter"), false);
  assert.equal(api.fieldRoleAllowed({"filterable?": true, query_filterable: false}, "filter"), true, "the first flag present decides");
  assert.equal(api.fieldRoleAllowed({sortable: false}, "sort"), false);
  assert.equal(api.fieldRoleAllowed({sortable: false}, "filter"), true);

  const domain = {
    source: {primary_key: "id", fields: ["id", "notes", "aggregate_version"], associations: {},
      columns: {id: {type: "integer"}, notes: {type: "text", sortable: false},
        aggregate_version: {type: "string", filterable: false, sortable: false}}},
    schemas: {},
  };
  const fields = api.collectFields(domain);
  const byPath = new Map(fields.map((field) => [field.path, field]));
  assert.deepEqual([byPath.get("notes").filterable, byPath.get("notes").sortable], [true, false]);
  assert.deepEqual(api.collectFilterFields(domain, fields).map((field) => field.path), ["id", "notes"]);

  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {...domain, query_library: {}};
  consoleInstance.fields = fields;
  consoleInstance.fieldMap = byPath;
  consoleInstance.filterFields = api.collectFilterFields(domain, fields);
  consoleInstance.filterFieldMap = new Map(consoleInstance.filterFields.map((field) => [field.path, field]));
  assert.deepEqual(consoleInstance.sortFields().map((field) => field.path), ["id"]);
  assert.throws(() => consoleInstance.chooserStateFromPayload({select: ["id"], order_by: [{field: "notes", direction: "asc"}]}),
    /notes cannot be used for sorting/);
  assert.throws(() => consoleInstance.chooserStateFromPayload({select: ["id"], filters: [{field: "aggregate_version", op: "eq", value: "x"}]}),
    /aggregate_version cannot be used in filters/);
});

test("offers the resource GET date formats the API advertises", () => {
  const openapi = {paths: {"/api2/orders/v1/resources/{id}": {get: {operationId: "getResource", parameters: [
    {in: "path", name: "id"},
    {in: "query", name: "date_format", schema: {type: "string",
      enum: ["iso8601", "rfc3339_millis", "epoch_seconds", "epoch_milliseconds"], default: "iso8601"}},
  ]}}}};
  assert.deepEqual(api.discoverResourceDateFormats(openapi, "/api2/orders/v1/resources/{id}"), {
    values: ["iso8601", "rfc3339_millis", "epoch_seconds", "epoch_milliseconds"], defaultValue: "iso8601",
  });
  assert.deepEqual(api.discoverResourceDateFormats({paths: {}}, "/api2/orders/v1/resources/{id}"), {values: [], defaultValue: ""});
  assert.equal(
    api.resourceRequestPath("/api2/orders/v1/resources/{id}", "7", ["status"], "epoch_seconds"),
    "/api2/orders/v1/resources/7?fields=status&date_format=epoch_seconds",
  );
  assert.equal(api.resourceRequestPath("/api2/orders/v1/resources/{id}", "7", [], "iso8601"),
    "/api2/orders/v1/resources/7?date_format=iso8601");

  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.domain = {source: {primary_key: "id", columns: {id: {type: "integer"}}}};
  consoleInstance.resourcePath = "/api2/orders/v1/resources/{id}";
  consoleInstance.resourceDateFormats = api.discoverResourceDateFormats(openapi, consoleInstance.resourcePath);
  consoleInstance.state.queryMethod = "get";
  consoleInstance.state.resourceId = "7";
  consoleInstance.state.selectedFields = [{field: "status"}];
  consoleInstance.state.dateFormat = "epoch_milliseconds";
  assert.equal(consoleInstance.buildResourceRequest().path, "/api2/orders/v1/resources/7?fields=status&date_format=epoch_milliseconds");
  consoleInstance.state.dateFormat = "unix";
  assert.match(consoleInstance.buildResourceRequest().errors.join(" "), /does not offer the date format unix/);
});

test("pages through query results with the API's has_more", () => {
  const consoleInstance = new api.APIConsole({dataset: {}});
  consoleInstance.state.limit = 50;
  const page = (data) => consoleInstance.pageInfo({ok: true, data: {columns: [], rows: [], ...data}});
  assert.deepEqual(page({returned: 50, limit: 50, offset: 100, has_more: true}),
    {offset: 100, limit: 50, returned: 50, hasMore: true, text: "Rows 101–150; more rows follow"});
  assert.equal(page({returned: 3, limit: 50, offset: 0, has_more: false}).text, "Rows 1–3; no more rows");
  assert.equal(page({returned: 0, limit: 50, offset: 200, has_more: false}).text, "No rows after row 200");
  assert.equal(page({returned: 1}), null, "no has_more, no paging");
  consoleInstance.state.queryMethod = "get";
  assert.equal(page({has_more: false}), null, "a resource GET is not a page");
  consoleInstance.state.queryMethod = "post";

  const node = () => ({hidden: false, textContent: ""});
  const parts = {"[data-sac-page-text]": node(), "[data-sac-next-page]": node(), "[data-sac-previous-page]": node()};
  const container = {hidden: true, querySelector: (selector) => parts[selector]};
  consoleInstance.root = {querySelector: (selector) => (selector === "[data-sac-legacy-page-info]" ? container : null)};
  consoleInstance.renderPageInfo({ok: true, data: {rows: [], returned: 50, limit: 50, offset: 0, has_more: true}});
  assert.equal(container.hidden, false);
  assert.deepEqual([parts["[data-sac-next-page]"].hidden, parts["[data-sac-previous-page]"].hidden], [false, true]);

  let ran = 0;
  consoleInstance.changed = () => {};
  consoleInstance.run = () => { ran++; };
  consoleInstance.goToPage("next");
  assert.deepEqual([consoleInstance.state.offset, consoleInstance.state.limit, ran], [50, 50, 1]);
  consoleInstance.page = {offset: 50, limit: 50};
  consoleInstance.goToPage("previous");
  assert.equal(consoleInstance.state.offset, 0);

  consoleInstance.state.rawDirty = true;
  consoleInstance.renderPageInfo({ok: true, data: {rows: [], returned: 50, limit: 50, offset: 50, has_more: true}});
  assert.deepEqual([parts["[data-sac-next-page]"].hidden, parts["[data-sac-previous-page]"].hidden], [true, true],
    "manually edited JSON is not paged");
});

test("canonical page status survives result rendering alongside the legacy pager", () => {
  class FakeNode {
    constructor(tag) { this.tag = tag; this.children = []; this.dataset = {}; this.hidden = true; this.textContent = ""; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
  }
  const previousDocument = global.document;
  global.document = {createElement: (tag) => new FakeNode(tag)};
  try {
    const canonical = new FakeNode("p");
    const parts = Object.fromEntries(["page-text", "next-page", "previous-page"].map(name => [`[data-sac-${name}]`, new FakeNode("span")]));
    const legacy = new FakeNode("div");
    legacy.querySelector = selector => parts[selector];
    legacy.append(...Object.values(parts));
    const nodes = {
      "[data-sac-page-info]": canonical,
      "[data-sac-legacy-page-info]": legacy,
      "[data-sac-empty-response]": new FakeNode("p"),
      "[data-sac-response-json]": new FakeNode("pre"),
      "[data-sac-result-head]": new FakeNode("thead"),
      "[data-sac-result-body]": new FakeNode("tbody"),
    };
    const consoleInstance = new api.APIConsole({dataset: {}, querySelector: selector => nodes[selector] || null});
    consoleInstance.state.queryMethod = "post";
    consoleInstance.state.rawDirty = true;
    consoleInstance.updateCurl = () => {};
    consoleInstance.switchResultTab = () => {};
    const result = hasMore => ({ok: true, data: {format: "selecto.remote-query-result", format_version: 1,
      columns: [{id: "id", label: "Id"}], rows: [[1], [3]], row_count: 2,
      page: {limit: 100, offset: 0, has_more: hasMore}}});
    for (const [hasMore, text] of [[false, "No more rows"], [true, "More rows available"]]) {
      consoleInstance.renderResponse(result(hasMore));
      assert.equal(canonical.hidden, false);
      assert.equal(canonical.textContent, text);
      assert.equal(legacy.hidden, true);
      assert.equal(consoleInstance.page, null);
      assert.deepEqual(nodes["[data-sac-result-body]"].children.map(row => row.children[0].textContent), ["1", "3"]);
    }
    for (const untyped of [undefined, null, "false", 0]) {
      consoleInstance.renderResponse(result(untyped));
      assert.equal(canonical.hidden, true, "only a boolean has_more supplies canonical page status");
    }
    consoleInstance.state.rawDirty = false;
    consoleInstance.renderResponse({ok: true, data: {columns: ["id"], rows: [[1], [3]],
      returned: 2, offset: 2, limit: 2, has_more: true}});
    assert.equal(canonical.hidden, true);
    assert.equal(legacy.hidden, false);
    assert.equal(parts["[data-sac-page-text]"].textContent, "Rows 3–4; more rows follow");
    assert.equal(parts["[data-sac-next-page]"].hidden, false);
    assert.equal(parts["[data-sac-previous-page]"].hidden, false);
    consoleInstance.renderResponse(result(false));
    assert.equal(canonical.hidden, false);
    assert.equal(legacy.hidden, false, "an editable canonical flat query retains its pager");
    consoleInstance.clearQueryResult();
    assert.equal(canonical.hidden, true);
    assert.equal(canonical.textContent, "");
    assert.equal(legacy.hidden, true);
    assert.equal(legacy.children.length, 3, "clearing retains the legacy pager controls");
    assert.equal(consoleInstance.page, null);
  } finally {
    global.document = previousDocument;
  }
});
