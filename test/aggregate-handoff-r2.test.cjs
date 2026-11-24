const assert = require("node:assert/strict");
const test = require("node:test");
const {APIConsole} = require("../dist/selecto-api-console.js");

// Only the selectors and element operations used by the Console are needed here.
class Node {
  constructor(tag = "div") {
    this.tagName = tag.toUpperCase(); this.children = []; this.dataset = {};
    this.value = ""; this.hidden = false; this.disabled = false; this.readOnly = false;
    this.className = ""; this.text = "";
    this.classList = {add() {}, remove() {}, toggle() {}};
  }
  append(...nodes) { for (let node of nodes) { if (typeof node !== "object") { const text = new Node("text"); text.textContent = node; node = text; } node.parentElement = this; this.children.push(node); } }
  focus() { global.document.activeElement = this; }
  add(node) { this.append(node); }
  replaceChildren(...nodes) { this.children = []; this.text = ""; this.append(...nodes); }
  set textContent(text) { this.replaceChildren(); this.text = String(text); }
  get textContent() { return this.text + this.children.map(node => node.textContent).join(""); }
  setAttribute(key, value) {
    if (key.startsWith("data-")) this.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    else if (key === "class") this.className = value;
    else this[key] = value;
  }
  setCustomValidity() {}
  addEventListener() {}
  matches(selector) {
    if (/^[a-z][a-z0-9]*$/.test(selector)) return this.tagName.toLowerCase() === selector;
    if (/^[a-z]+\./.test(selector)) { const [tag, cls] = selector.split("."); return this.matches(tag) && this.matches(`.${cls}`); }
    if (selector.startsWith(".")) return this.className.split(/\s+/).includes(selector.slice(1));
    const match = /^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!match) return false;
    const key = match[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    return Object.hasOwn(this.dataset, key) && (match[2] === undefined || this.dataset[key] === match[2]);
  }
  closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) || null; }
  querySelectorAll(selector) { return this.children.flatMap(node => [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  set innerHTML(html) {
    this.html = html; this.replaceChildren(); const stack = [this];
    for (const token of html.matchAll(/<\/(\w+)>|<(\w+)([^>]*)>|([^<]+)/g)) {
      if (token[1]) { stack.pop(); continue; }
      if (token[4]) { const text = new Node("text"); text.textContent = token[4]; stack.at(-1).append(text); continue; }
      const node = new Node(token[2]);
      for (const attr of token[3].matchAll(/([\w-]+)(?:="([^"]*)")?/g)) node.setAttribute(attr[1], attr[2] ?? true);
      stack.at(-1).append(node);
      if (!["input", "br", "hr", "img"].includes(token[2])) stack.push(node);
    }
  }
}

const handoff = require("./data/aggregate-handoff-r2.json");
const field = (id, type, more = {}) => ({id, path:id, label:id[0].toUpperCase()+id.slice(1), type,
  groupable:true, sortable:true, filterable:true, operators:["eq", "in", "is_null"], aggregates:["count"], ...more});
const features = () => ({format:"selecto.explorer-features",format_version:1,profile:"remote_query.explorer.v1",
  domain:{id:"orders",fingerprint:handoff.domain.fingerprint},revision:handoff.features.revision,default:{order_by:[]},
  fields:[field("id","integer",{operators:["gte","eq","in","is_null"],aggregates:["count"]}),field("region","string"),field("channel","string"),
    field("amount","integer",{operators:["eq","in","is_null"],aggregates:["sum","avg","count"],buckets:["numeric"]}),
    field("created","date",{group_formats:["month","year"],buckets:["year"],aggregates:["min","max","count"]})],
  query_library:{segments:[{name:"open",parameters:[{name:"minimum",type:"integer"}]}]},
  limits:{max_limit:100,max_offset:10000,max_orders:3,max_group_by:3,max_select:20,max_buckets:4,max_filters:20,max_filter_depth:3},
  supports:{aggregate:true,rollup:true,cube:true,grouping_sets:true,count_exact:true,grid:true,export:["json"],group_formats:true,buckets:true,recursive_filters:true,timezones:"iana"}});
const aggregateRoutes = [
  {operation_id: "getExplorerFeatures", method: "GET", path: "/api/orders/group-features"},
  {operation_id: "queryExplorer", method: "POST", path: "/api/orders/group-query"},
];
const result = () => ({ok: true, data: {columns: [{id: "status", role: "group"}, {id: "count", role: "aggregate"}],
  rows: [["open", 2], [null, 2]], row_meta: [{kind: "detail", level: 1}, {kind: "total", level: 0}]}});

async function withDOM(fn) {
  const before = {document: global.document, Option: global.Option, window: global.window, location: global.location, fetch: global.fetch};
  global.document = {createElement: tag => new Node(tag)};
  global.Option = class extends Node { constructor(label, value) { super("option"); this.textContent = label; this.value = value; } };
  global.location = {hash: "", search: "", origin: "https://example.test", href:"https://example.test/console?api=/api/orders"};
  global.window = {location: global.location};
  try { await fn(); } finally { Object.assign(global, before); }
}

async function instance({routes = aggregateRoutes, remote = false, featureResponse = features(), hash = ""} = {}) {
  global.location.hash = hash;
  const root = new Node(); root.dataset.apiBase = "/api/orders";
  const console = new APIConsole(root);
  // These independent form renderers are covered by the existing chooser tests.
  for (const method of ["seedMutationState", "renderWritePanel", "renderActionPanel"]) console[method] = () => {};
  const manifest = {format: "selecto.canonical-domain-api", format_version: 1, domain: {fingerprint: handoff.domain.fingerprint},
    profiles: remote ? ["remote_query.v1"] : [], routes: [
      {operation_id: "queryDomain", method: "POST", path: "/api/orders/detail-query"},
      {operation_id: "getResource", method: "GET", path: "/api/orders/{id}"}, ...routes]};
  const domain = {name:"Orders",domain_fingerprint:handoff.domain.fingerprint,source:{primary_key:"id",fields:features().fields.map(f=>f.id),
    columns:Object.fromEntries(features().fields.map(f=>[f.id,{type:f.type,label:f.label}]))}};
  const operation = {requestBody:{content:{"application/json":{schema:{properties:{as_of:{type:"string"},query:{properties:{as_of:{type:"string"}}}}}}}}};
  const openapi = {paths:{"/api/orders/detail-query":{post:operation},"/api/orders/group-query":{post:operation}},components:{schemas:{SelectoFilter:{properties:{op:{enum:["eq","in","is_null"]}}}}}};
  const calls = [];
  global.fetch = async (path, init = {}) => {
    calls.push({path, init});
    if (init.method === "POST") return Response.json(result());
    if (path === "/api/orders/") return Response.json(manifest);
    if (path === "/api/orders/domain") return Response.json(domain);
    if (path === "/api/orders/openapi.json") return Response.json(openapi);
    if (path === "/api/orders/group-features") {
      if (featureResponse instanceof Error) throw featureResponse;
      if (featureResponse instanceof Response) return featureResponse;
      return Response.json(featureResponse);
    }
    throw new Error(`Unexpected path ${path}`);
  };
  console.renderFatal = error => { throw error; };
  await console.start();
  const node = name => root.querySelector(`[data-sac-${name}]`);
  const choose = value => { node("root-mode").value = value; return console.onInput({target: node("root-mode")}); };
  return {console, root, node, choose, calls};
}

const clone = value => structuredClone(value);
const exported = x => JSON.parse(x.node('request').value);
const equivalent = value => {value=clone(value);if(value.query.offset===0)delete value.query.offset;return value;};
const withQuery = changes => ({...clone(handoff),query:{...clone(handoff.query),...changes}});
async function imported(payload=handoff) {return instance({hash:'#request='+encodeURIComponent(JSON.stringify(payload))});}
function load(x,payload) {x.node('request').value=JSON.stringify(payload);x.console.onInput({target:x.node('request')});return x.console.loadRequestIntoChooser();}
function rename(x,index,value) {const target=x.root.querySelectorAll('[data-sac-aggregate-control="aggregate-alias"]')[index];target.value=value;x.console.onInput({target});}
function reject(x,payload,message) {const previous=clone(x.console.aggregateState);assert.equal(load(x,payload),false);assert.deepEqual(x.console.aggregateState,previous);assert.match(x.node('import-message').textContent,message);}

test('the exact evidence URL without profile opens Aggregates and retains the complete handoff for export and Run',()=>withDOM(async()=>{
  const x=await imported();assert.equal(x.console.queryProfile,'aggregate');assert.equal(x.console.state.rawDirty,false);assert.equal(x.node('edited').hidden,true);assert.equal(x.node('run').disabled,false);
  assert.equal(x.node('import-message').textContent,'Query form loaded from Explorer.');assert.deepEqual(equivalent(exported(x)),equivalent(handoff));
  assert.match(x.node('measure-chips').textContent,/Nulls: auto/);assert.match(x.node('aggregate-kept-settings').textContent,/Row shape: arrays/);
  assert.equal(x.console.aggregateState.filters[0].value,2);assert.equal(x.console.aggregateState.grouping,'rollup');
  await x.console.run();const post=x.calls.find(c=>c.init.method==='POST');assert.ok(post);assert.deepEqual(equivalent(JSON.parse(post.init.body)),equivalent(handoff));
  rename(x,1,'sales');const expected=clone(handoff);expected.query.select[3].alias='sales';assert.deepEqual(equivalent(exported(x)),equivalent(expected));
  await x.choose('flat');await x.choose('aggregate');assert.deepEqual(equivalent(exported(x)),equivalent(expected));
}));

test('row formats, sum null handling and zero offset survive Load into chooser, copy and share links',()=>withDOM(async()=>{
  const x=await imported();
  for(const shape of ['arrays','objects']) {const payload=withQuery({row_format:shape,offset:0});assert.equal(load(x,payload),true);assert.deepEqual(equivalent(exported(x)),equivalent(payload));
    let copied;x.console.copy=async text=>{copied=text;};x.console.onClick({target:x.node('copy-request')});assert.deepEqual(JSON.parse(copied),exported(x));
    await x.console.copyRequestLink(x.node('copy-link'));const slots=new URLSearchParams(new URL(copied).hash.slice(1));assert.equal(slots.get('profile'),'aggregate');assert.deepEqual(JSON.parse(slots.get('request')),exported(x));
  }
}));

test('all additional query options use the closed contract and survive unrelated chooser edits',()=>withDOM(async()=>{
  const x=await imported();const payload=withQuery({row_format:'objects',timezone:'America/Denver',count:'exact',complete:false,segments:['open'],parameters:{minimum:2},export:{all_rows:true,shape:'rows'}});
  payload.request_id='orders-preview';assert.equal(load(x,payload),true);assert.deepEqual(equivalent(exported(x)),equivalent(payload));rename(x,0,'rows');
  payload.query.select[2].alias='rows';assert.deepEqual(equivalent(exported(x)),equivalent(payload));
  const grid=withQuery({rollup:false,cube:true,complete:true});assert.equal(load(x,grid),true);assert.deepEqual(equivalent(exported(x)),equivalent(grid));
  const empty=withQuery({rollup:false,cube:false,complete:false,count:'none',timezone:'UTC',filters:[],order_by:[],segments:[],parameters:{},export:null});assert.equal(load(x,empty),true);assert.deepEqual(equivalent(exported(x)),equivalent(empty));
}));

test('invalid and unknown query, envelope and selection members still refuse atomically with the existing messages',()=>withDOM(async()=>{
  const x=await imported();
  for(const changes of [{unknown:1},{row_format:'records'},{timezone:'unknown/zone'},{count:'approximate'},{complete:'true'},{segments:'open'},{segments:['unpublished']},{parameters:[]},{rollup:'yes'},{cube:1},{export:{all_rows:false}},{export:{all_rows:true,shape:'chart'}},{export:{all_rows:true,extra:true}},{complete:true},{offset:-1},{offset:'0'},{limit:null}]) reject(x,withQuery(changes),/Unsupported aggregate chooser properties/);
  for(const value of [false,true,'always','never',null,0]) {const invalid=clone(handoff);invalid.query.select[3].ignore_nulls=value;reject(x,invalid,/Unsupported aggregate selection/);}
  for(const fn of ['count','avg','min']) {const invalid=clone(handoff);invalid.query.select[3].aggregate=fn;reject(x,invalid,/Unsupported aggregate selection/);}
  const invalid=clone(handoff);invalid.query.select[3].where=[];reject(x,invalid,/Unsupported aggregate selection/);
  reject(x,{...clone(handoff),unknown:true},/Unsupported aggregate envelope properties/);
  reject(x,{...clone(handoff),request_id:''},/Unsupported aggregate envelope properties/);
}));

test('omitted paging defaults are preserved, explicit summary paging loads, and ascending is the order default',()=>withDOM(async()=>{
  const x=await imported();let payload=clone(handoff);delete payload.query.limit;delete payload.query.offset;assert.equal(load(x,payload),true);assert.deepEqual(exported(x),payload);
  let limit=x.root.querySelector('[data-sac-aggregate-control="limit"]');assert.equal(limit.value,'');assert.equal(limit.placeholder,'Host default');
  limit.value='100';x.console.onInput({target:limit});assert.equal(exported(x).query.limit,100);
  limit.value='';x.console.onInput({target:limit});assert.equal('limit' in exported(x).query,false);
  payload=withQuery({limit:0,offset:0});assert.equal(load(x,payload),true);assert.deepEqual(equivalent(exported(x)),equivalent(payload));
  payload=withQuery({select:[{aggregate:'sum',field:'amount',alias:'sales',ignore_nulls:'auto'}],limit:25,offset:0});delete payload.query.group_by;delete payload.query.rollup;assert.equal(load(x,payload),true);assert.deepEqual(equivalent(exported(x)),equivalent(payload));
  payload=withQuery({rollup:false,order_by:[{field:'region'}]});assert.equal(load(x,payload),true);assert.deepEqual(exported(x).query.order_by,[{field:'region',direction:'asc'}]);
}));

test('formatted and bucket groups, group selections and selection ordering retain their published settings',()=>withDOM(async()=>{
  const x=await imported();const group={field:'created',alias:'month',format:'month'};
  const payload=withQuery({group_by:['region',group],select:[{group:'month'},{aggregate:'count',alias:'count'},{field:'region'}],row_format:'objects'});
  assert.equal(load(x,payload),true);assert.deepEqual(equivalent(exported(x)),equivalent(payload));assert.match(x.node('group-chips').textContent,/Created \(month\)/);
  const bucket={field:'amount',alias:'band',buckets:{kind:'numeric',step:10}};
  const bucketed=withQuery({group_by:[bucket],select:[{group:'band'},{aggregate:'count',alias:'count'}]});assert.equal(load(x,bucketed),true);assert.deepEqual(equivalent(exported(x)),equivalent(bucketed));
  const sets={...clone(payload),query:{...clone(payload.query),grouping_sets:[[1,0],[]]}};delete sets.query.rollup;
  assert.equal(load(x,sets),true);assert.deepEqual(equivalent(exported(x)),equivalent(sets));
  const aliasCollision=withQuery({group_by:[{field:'created',alias:'region',format:'month'}],select:[{group:'region'},{aggregate:'count',alias:'count'}]});
  assert.equal(load(x,aliasCollision),true);assert.match(x.node('group-chips').textContent,/Created \(month\)/);
  x.console.aggregateAction({dataset:{sacAggregateAction:'group-remove',index:'0'}});
  x.console.aggregateControl({dataset:{sacAggregateControl:'add-group'},value:'region'});
  assert.deepEqual(exported(x).query.group_by,['region']);assert.equal(exported(x).query.select.includes('region'),true);
  const invalid=clone(payload);invalid.query.group_by[1].extra=true;reject(x,invalid,/Unsupported aggregate selection/);
  reject(x,withQuery({select:[{group:'region'},'channel',...clone(handoff.query.select.slice(2))]}),/Unsupported aggregate selection/);
}));

test('published bucket counts retain ranges and sort by their actual expanded column IDs',()=>withDOM(async()=>{
  const x=await imported();const measure={aggregate:'bucket_count',field:'amount',alias:'bands',buckets:{kind:'numeric',ranges:[{min:0,max:20,label:'Small'},{min:21,label:'Large'}]}};
  const payload=withQuery({rollup:false,select:['region','channel',measure],order_by:[{field:'bands__bucket_2',direction:'desc'}]});
  assert.equal(load(x,payload),true);assert.deepEqual(equivalent(exported(x)),equivalent(payload));assert.match(x.node('measure-chips').textContent,/Buckets: numeric/);
  rename(x,0,'ranges');assert.deepEqual(exported(x).query.order_by,[{field:'ranges__bucket_2',direction:'desc'}]);
  const invalid=clone(payload);invalid.query.select[2].buckets.step=10;reject(x,invalid,/Unsupported aggregate selection/);
  const unknown=clone(payload);unknown.query.select[2].buckets.ranges[0].extra=true;reject(x,unknown,/Unsupported aggregate selection/);
}));

test('recursive and formatted filters and typed list values are retained without flattening or coercion',()=>withDOM(async()=>{
  const x=await imported();const filters=[{any:[{field:'id',op:'gte',value:2},{field:'created',format:'month',op:'eq',value:'2026-01'}]},{field:'amount',op:'in',value:[2,3]}];
  const payload=withQuery({filters});assert.equal(load(x,payload),true);assert.deepEqual(exported(x).query.filters,filters);assert.match(x.node('filters').textContent,/Imported filter settings kept/);
  rename(x,1,'sales');assert.deepEqual(exported(x).query.filters,filters);
  const typed=x.root.querySelector('[data-sac-filter-value]');typed.value='4, 5';x.console.onInput({target:typed});assert.deepEqual(exported(x).query.filters[1].value,[4,5]);
  for(const filter of [{any:[],extra:true},{field:'id',op:'gte',value:'2'},{field:'id',op:'is_null',value:null},{field:'created',format:'unknown',op:'eq',value:'2026-01'}])reject(x,withQuery({filters:[filter]}),/Unsupported aggregate filter/);
}));

test('unsupported advertised capabilities and incompatible retained settings stay refused',()=>withDOM(async()=>{
  const f=features();Object.assign(f.supports,{count_exact:false,grid:false,buckets:false,group_formats:false,recursive_filters:false,export:[]});
  const x=await instance({featureResponse:f});await x.choose('aggregate');
  for(const changes of [{count:'exact'},{rollup:false,complete:true},{export:{all_rows:true}}])reject(x,withQuery(changes),/Unsupported aggregate chooser properties/);
  reject(x,withQuery({group_by:[{field:'created',alias:'month',format:'month'}],select:[{group:'month'},{aggregate:'count',alias:'count'}]}),/Unsupported aggregate selection/);
  reject(x,withQuery({filters:[{any:[{field:'id',op:'gte',value:2}]}]}),/Unsupported aggregate filter/);
}));


test('the evidence handoff also opens on a remote-query host and measure changes keep its null option',()=>withDOM(async()=>{
  const x=await instance({remote:true,hash:'#request='+encodeURIComponent(JSON.stringify(handoff))});
  assert.equal(x.console.remoteMode,true);assert.equal(x.console.queryProfile,'aggregate');assert.equal(x.console.state.rawDirty,false);assert.deepEqual(equivalent(exported(x)),equivalent(handoff));
  x.console.aggregateAction({dataset:{sacAggregateAction:'aggregate-up',index:'1'}});
  assert.equal(exported(x).query.select[2].ignore_nulls,'auto');
  assert.equal(exported(x).query.select[2].alias,'total_amount');
}));
