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

const field = (id, type, more = {}) => ({id, path:id, label:id[0].toUpperCase()+id.slice(1), type,
  groupable:true, sortable:true, filterable:true, operators:["eq", "in", "is_null"], aggregates:["count"], ...more});
const features = () => ({format:"selecto.explorer-features",format_version:1,profile:"remote_query.explorer.v1",
  domain:{id:"orders",fingerprint:"fp"},revision:"rev",default:{order_by:[]},
  fields:[field("status","string"),field("category","string"),field("price","decimal",{aggregates:["sum","avg","min","max"]}),
    field("weight","decimal",{groupable:false,aggregates:["sum","avg"]}),field("items","integer",{collection:true,aggregates:["sum"]})],
  limits:{max_limit:100,max_offset:10000,max_orders:3}, supports:{aggregate:true,as_of:true,rollup:true,cube:true,grouping_sets:true}});
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
  const manifest = {format: "selecto.canonical-domain-api", format_version: 1, domain: {fingerprint: "fp"},
    profiles: remote ? ["remote_query.v1"] : [], routes: [
      {operation_id: "queryDomain", method: "POST", path: "/api/orders/detail-query"},
      {operation_id: "getResource", method: "GET", path: "/api/orders/{id}"}, ...routes]};
  const domain = {name:"Orders",domain_fingerprint:"fp",source:{primary_key:"id",fields:["id","status","category","price","weight","note"],
    columns:{id:{type:"integer"},status:{type:"string"},category:{type:"string"},price:{type:"decimal"},weight:{type:"decimal"},note:{type:"string"}}},
    query_library:{segments:{open:{label:"Open",filters:[]}}}};
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

// Captured from the b08775c builder before replacement using this invented domain.
const baseline = require('./data/aggregate-chooser-baseline.json');
const control = (x, name, index) => x.root.querySelectorAll(`[data-sac-aggregate-control="${name}"]`).find(n => index === undefined || n.dataset.index === String(index));
function edit(x, name, value, index) { const target=control(x,name,index); assert.ok(target,name); target.value=value; x.console.onInput({target}); if(target.tagName==='SELECT'||target.type==='checkbox') x.console.onChange({target}); return target; }
function click(x, selector, index=0) { const target=x.root.querySelectorAll(selector)[index]; assert.ok(target,selector); target.focus(); x.console.onClick({target}); }
function group(x, id) {click(x,`[data-sac-add-group="${id}"]`);}
function measure(x, fn, field='') {const target=x.root.querySelectorAll('[data-sac-add-measure]').find(n=>n.dataset.fn===fn&&n.dataset.sacAddMeasure===field); assert.ok(target); target.focus();x.console.onClick({target});}
const request = x => JSON.parse(x.node('request').value);
function load(x, value) {x.node('request').value=JSON.stringify(value);x.console.onInput({target:x.node('request')});assert.equal(x.node('edited').hidden,false);assert.equal(x.console.loadRequestIntoChooser(),true);assert.equal(x.node('import-message').textContent,'Chooser updated from the request JSON.');assert.deepEqual(request(x),value);}

test('Aggregates occupies the three existing left cards and restores Detail controls and drafts',()=>withDOM(async()=>{
  const x=await instance();const aside=x.root.querySelector('.sac-builder');
  const detail=request(x);const cards=aside.querySelectorAll('.sac-card');assert.equal(cards.length,3);
  await x.choose('aggregate');assert.equal(aside.hidden,false);assert.equal(x.root.querySelector('section.sac-aggregate-builder'),null);
  assert.deepEqual(cards.map(c=>c.querySelector('h2').textContent),['Group & measure','Constrain','Subtotals & page']);
  for(const name of ['data','constraints','page'])assert.equal(x.node(`detail-${name}`).hidden,true);
  assert.equal(x.node('filters').closest('.sac-card'),cards[1]);assert.equal(x.node('as-of-slot').closest('.sac-card'),cards[1]);
  group(x,'status');const aggregate=request(x);
  await x.choose('flat');assert.deepEqual(cards.map(c=>c.querySelector('h2').textContent),['Choose data','Constrain','Order & page']);
  assert.equal(x.node('aggregate-data').hidden,true);assert.equal(x.node('detail-constraints').hidden,false);assert.deepEqual(request(x),detail);
  await x.choose('aggregate');assert.deepEqual(request(x),aggregate);
}));

test('group chips, count and renamed sum produce the exact envelope captured from the old builder',()=>withDOM(async()=>{
  const x=await instance();await x.choose('aggregate');
  group(x,'status');group(x,'category');click(x,'[data-sac-aggregate-action="group-up"]',1);
  click(x,'[data-sac-aggregate-action="aggregate-remove"]');measure(x,'count');measure(x,'sum','price');edit(x,'aggregate-alias','total_price',1);
  click(x,'[data-sac-add-filter="status"]');const value=x.root.querySelector('[data-sac-filter-value]');value.value='open';x.console.onInput({target:value});
  edit(x,'grouping','rollup');assert.deepEqual(request(x),baseline);assert.deepEqual(x.console.buildAggregateRequest().errors,[]);
  assert.equal(x.node('group-chips').querySelectorAll('.sac-selected-field').length,2);
  assert.match(x.node('measure-chips').textContent,/Count of rows/);assert.match(x.node('measure-chips').textContent,/Sum of Price/);
}));

test('measure functions come only from each field, Count rows remains available and aliases are unique',()=>withDOM(async()=>{
  const x=await instance();await x.choose('aggregate');
  measure(x,'sum','price');measure(x,'sum','price');measure(x,'avg','weight');measure(x,'count');
  assert.deepEqual(x.console.aggregateState.aggregates.map(a=>a.alias),['count','sum_price','sum_price_2','avg_weight','count_2']);
  const before=structuredClone(x.console.aggregateState);
  for(const [fn,field] of [['sum','status'],['max','weight'],['sum','items'],['unknown','price'],['avg','']])assert.equal(x.console.addAggregateMeasure(fn,field),false);
  assert.deepEqual(x.console.aggregateState,before);
  assert.equal(x.root.querySelectorAll('[data-sac-add-measure]').some(n=>n.dataset.sacAddMeasure==='items'),false);
  assert.equal(x.root.querySelectorAll('[data-sac-add-measure]').some(n=>n.dataset.fn==='max'&&n.dataset.sacAddMeasure==='weight'),false);
  edit(x,'aggregate-alias','sales',1);click(x,'[data-sac-aggregate-action="aggregate-up"]',1);
  assert.equal(x.console.aggregateState.aggregates[0].alias,'sales');assert.equal(control(x,'aggregate-alias',0).value,'sales');
  assert.match(x.node('chooser-status').textContent,/Moved Sum of Price to position 1/);
}));

for(const mode of ['none','rollup','cube','sets'])test(`${mode}, filters and exact As of round-trip through Load into chooser`,()=>withDOM(async()=>{
  const x=await instance();await x.choose('aggregate');group(x,'status');group(x,'category');
  click(x,'[data-sac-add-filter="status"]');let target=x.root.querySelector('[data-sac-filter-op]');target.value='in';x.console.onChange({target});
  target=x.root.querySelector('[data-sac-filter-value]');target.value='open, pending';x.console.onInput({target});
  x.console.changeAsOf('2026-01-15T12:30:00.123456789-07:00','aggregate');edit(x,'grouping',mode);
  if(mode==='sets')for(const key of ['0','1','']) {const box=x.root.querySelectorAll('[data-sac-aggregate-control="set"]').find(n=>n.dataset.set===key);box.checked=true;box.focus();x.console.onChange({target:box});assert.equal(global.document.activeElement.dataset.set,key);}
  const saved=request(x);edit(x,'aggregate-alias','other',0);load(x,saved);
  assert.deepEqual(request(x).query.filters,[{field:'status',op:'in',value:['open','pending']}]);
  assert.equal(x.console.aggregateState.grouping,mode);assert.equal(x.console.aggregateState.asOf,'2026-01-15T12:30:00.123456789-07:00');
  if(mode==='sets'){const labels=x.node('aggregate-page').textContent;assert.match(labels,/Status \+ Category/);assert.match(labels,/Grand total/);}
}));

test('search lists, labels and native buttons match the shared chooser and preserve keyboard focus',()=>withDOM(async()=>{
  const x=await instance();await x.choose('aggregate');
  x.node('group-search').value='category';x.console.onInput({target:x.node('group-search')});assert.equal(x.node('group-list').querySelectorAll('[data-sac-add-group]').length,1);
  group(x,'category');assert.equal(global.document.activeElement,x.node('group-search'));assert.match(x.node('chooser-status').textContent,/Added group Category/);
  x.node('measure-search').value='average';x.console.onInput({target:x.node('measure-search')});assert.match(x.node('measure-list').textContent,/Price/);assert.doesNotMatch(x.node('measure-list').textContent,/Status/);
  measure(x,'avg','price');assert.equal(global.document.activeElement.dataset.sacAddMeasure,'price');assert.match(x.node('chooser-status').textContent,/Added Average of Price/);
  const alias=edit(x,'aggregate-alias','average_price',1);alias.focus();edit(x,'aggregate-alias','average_price_2',1);assert.equal(global.document.activeElement,alias);
  click(x,'[data-sac-aggregate-action="aggregate-remove"]',1);assert.match(x.node('chooser-status').textContent,/Removed Average of Price/);
  assert.equal(global.document.activeElement.dataset.sacAggregateAction,'aggregate-remove');
  x.node('filter-search').value='status';x.console.onInput({target:x.node('filter-search')});assert.equal(x.node('filter-field-list').querySelectorAll('[data-sac-add-filter]').length,1);
  click(x,'[data-sac-add-filter="status"]');assert.deepEqual(x.root.querySelector('[data-sac-filter-op]').children.map(n=>n.value),['eq','in','is_null']);
  assert.equal(x.node('filter-field-list').querySelector('[data-sac-add-filter="note"]'),null);
  assert.equal(x.node('chooser-status')['aria-live'],'polite');
}));

test('validation is live in its own card, and manual JSON uses the normal edited and import messages',()=>withDOM(async()=>{
  const x=await instance();await x.choose('aggregate');group(x,'status');
  const alias=edit(x,'aggregate-alias','bad name',0);assert.equal(control(x,'aggregate-alias',0),alias);
  assert.match(x.root.querySelector('[data-sac-aggregate-errors="data"]').textContent,/needs a name/);assert.equal(x.node('run').disabled,true);
  x.console.changeAsOf('2026-02-30','aggregate');assert.match(x.root.querySelector('[data-sac-aggregate-errors="constrain"]').textContent,/valid ISO/);
  edit(x,'limit','101');assert.match(x.root.querySelector('[data-sac-aggregate-errors="page"]').textContent,/Limit must/);
  const manual={...baseline,query:{...baseline.query,as_of:'2026-01-15'}};load(x,manual);assert.equal(x.node('run').disabled,false);
  for(const card of ['data','constrain','page'])assert.equal(x.root.querySelector(`[data-sac-aggregate-errors="${card}"]`).hidden,true);
  x.node('request').value='{"query":';x.console.onInput({target:x.node('request')});assert.equal(x.console.state.rawDirty,true);assert.equal(x.node('run').disabled,false);
  const draft=structuredClone(x.console.aggregateState);assert.equal(x.console.loadRequestIntoChooser(),false);assert.deepEqual(x.console.aggregateState,draft);
  assert.match(x.node('import-message').textContent,/The chooser cannot represent this JSON:.*manual JSON mode/);
}));

test('grouped sorting uses sortable groups and aliases, retains renamed aliases, and excludes subtotals',()=>withDOM(async()=>{
  const x=await instance();await x.choose('aggregate');assert.equal(x.node('add-order').hidden,true);group(x,'status');measure(x,'sum','price');
  assert.equal(x.node('add-order').hidden,false);click(x,'[data-sac-add-order]');let target=x.node('aggregate-orders').querySelector('[data-sac-order-field]');target.value='sum_price';x.console.onChange({target});
  target=x.node('aggregate-orders').querySelector('[data-sac-order-direction]');target.value='desc';x.console.onChange({target});edit(x,'aggregate-alias','sales',1);
  assert.deepEqual(request(x).query.order_by,[{field:'sales',direction:'desc'}]);const sorted=request(x);load(x,sorted);
  edit(x,'grouping','rollup');assert.equal('order_by' in request(x).query,false);assert.equal(x.node('add-order').hidden,true);
  const draft=structuredClone(x.console.aggregateState);x.node('request').value=JSON.stringify({...sorted,query:{...sorted.query,rollup:true}});assert.equal(x.console.loadRequestIntoChooser(),false);assert.deepEqual(x.console.aggregateState,draft);assert.match(x.node('import-message').textContent,/Sorting requires groups and no subtotals/);
  edit(x,'grouping','none');assert.equal(x.node('add-order').hidden,false);
  const multiple={...sorted,query:{...sorted.query,order_by:[{field:'status',direction:'asc'},{field:'sales',direction:'desc'}]}};
  load(x,multiple);click(x,'[data-sac-add-order]');assert.equal(new Set(x.console.aggregateState.orders.map(o=>o.id)).size,3);
  const added=x.node('aggregate-orders').querySelectorAll('[data-sac-order-direction]')[2];added.value='desc';x.console.onChange({target:added});
  assert.deepEqual(request(x).query.order_by,[...multiple.query.order_by,{field:'status',direction:'desc'}]);
}));

test('Copy link includes the profile, reopens complete Aggregates state, and legacy links still import',()=>withDOM(async()=>{
  const x=await instance();await x.choose('aggregate');load(x,baseline);let link;x.console.copy=async text=>{link=text;};
  await x.console.copyRequestLink(x.node('copy-link'));const url=new URL(link),slots=new URLSearchParams(url.hash.slice(1));assert.equal(slots.get('profile'),'aggregate');assert.deepEqual(JSON.parse(slots.get('request')),baseline);
  const reopened=await instance({hash:url.hash});assert.equal(reopened.console.queryProfile,'aggregate');assert.equal(reopened.node('aggregate-data').hidden,false);assert.deepEqual(request(reopened),baseline);assert.equal(reopened.calls.some(c=>c.init.method==='POST'),false);
  slots.delete('profile');const old=await instance({hash:'#'+slots});assert.equal(old.console.queryProfile,'aggregate');assert.deepEqual(request(old),baseline);
  const detail={select:['status'],limit:10,offset:0};const flat=await instance({hash:'#request='+encodeURIComponent(JSON.stringify(detail))});assert.equal(flat.console.queryProfile,'flat');assert.equal(flat.console.state.limit,10);
}));

test('aggregate paging uses Explorer page metadata, preserves POST with a retained GET draft, and respects manual mode',()=>withDOM(async()=>{
  const x=await instance();x.console.state.resourceId='7';x.console.setQueryMethod('get');x.console.renderAll();await x.choose('aggregate');group(x,'status');edit(x,'limit','5');
  const posts=[];global.fetch=async(path,init)=>{const body=JSON.parse(init.body);posts.push({path,body});return Response.json({ok:true,data:{format:'selecto.explorer-query-result',format_version:1,columns:[{id:'count',role:'aggregate'}],rows:[[2]],row_count:1,page:{has_more:true,limit:body.query.limit,offset:body.query.offset||0}}});};
  await x.console.run();assert.equal(x.node('legacy-page-info').hidden,false);assert.equal(x.node('next-page').hidden,false);
  await x.console.goToPage('next');assert.equal(posts.at(-1).body.query.offset,5);assert.equal(posts.at(-1).path,'/api/orders/group-query');assert.equal(x.console.aggregateState.offset,5);
  await x.console.goToPage('previous');assert.equal(posts.at(-1).body.query.offset,undefined);assert.equal(x.console.aggregateState.offset,0);
  x.console.onInput({target:x.node('request')});await x.console.goToPage('next');assert.equal(posts.length,3);
}));
