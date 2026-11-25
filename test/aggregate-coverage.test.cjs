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

async function instance({routes = aggregateRoutes, remote = false, featureResponse = coverageFeatures(), hash = ""} = {}) {
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


const coverageFeatures = () => {
  const f = features();
  Object.assign(f.supports, {as_of:true, retarget:true, pivot:true, subtotal_position:true});
  f.fields.find(field => field.id === 'channel').value_order = ['open', 'done'];
  f.retargets = [{path:'notes', label:'Notes', fields:[field('notes.kind','string'), field('notes.stage','string'), field('notes.weight','decimal',{aggregates:['sum','avg','count']})]}];
  return f;
};
const base = () => withQuery({rollup:false});
const hashFor = payload => '#request='+encodeURIComponent(JSON.stringify(payload));
function control(x, name, value, extra={}) {
  const node=x.root.querySelector(`[data-sac-aggregate-control="${name}"]`);
  assert.ok(node, `Missing control ${name}`);node.value=value;Object.assign(node,extra);
  x.console[node.tagName==='INPUT' && node.type!=='checkbox' ? 'onInput' : 'onChange']({target:node});
}
const memberQuery = {
  as_of: () => ({as_of:'2026-05-10T12:30:00.123456789+02:00'}),
  retarget: () => ({retarget:'notes',group_by:['notes.kind','notes.stage'],select:['notes.kind','notes.stage',{aggregate:'sum',field:'notes.weight',alias:'weight'}],filters:[{field:'id',op:'eq',value:2}]}),
  pivot: () => ({pivot:{column:'channel',values:['open','done',null],other:true,totals:false,value_order:['done','open',null]}}),
  subtotal_position: () => ({rollup:true,subtotal_position:'before',order_by:[{field:'count',direction:'desc'}]})
};

for (const [member, changes] of Object.entries(memberQuery)) {
  test(`${member} round trips through hash, chooser, link, profile switch and POST`,()=>withDOM(async()=>{
    const payload=withQuery(changes()),x=await instance({hash:hashFor(payload)});
    assert.equal(x.console.queryProfile,'aggregate');assert.equal(x.console.state.rawDirty,false);
    assert.deepEqual(equivalent(exported(x)),equivalent(payload));
    assert.equal(load(x,payload),true);
    await x.choose('flat');await x.choose('aggregate');
    assert.deepEqual(equivalent(exported(x)),equivalent(payload));
    let link;x.console.copy=async text=>{link=text;};await x.console.copyRequestLink(x.node('copy-link'));
    const y=await instance({hash:new URL(link).hash});assert.deepEqual(equivalent(exported(y)),equivalent(payload));
    await y.console.run();assert.deepEqual(equivalent(JSON.parse(y.calls.find(call=>call.init.method==='POST').init.body)),equivalent(payload));
  }));
  for(const advertised of [false,undefined]) test(`${member} refuses imports and hash restores when support is ${advertised}`,()=>withDOM(async()=>{
    const f=coverageFeatures();if(advertised===undefined)delete f.supports[member];else f.supports[member]=false;
    const x=await instance({featureResponse:f});await x.choose('aggregate');
    reject(x,withQuery(changes()),/does not publish/);
    const y=await instance({featureResponse:f,hash:hashFor(withQuery(changes()))});
    assert.equal(y.console.state.rawDirty,true);assert.match(y.node('import-message').textContent,/does not publish/);
    assert.equal(y.calls.some(call=>call.init.method==='POST'),false);
    if(member==='as_of')assert.equal(x.node('as-of-slot').hidden,true);
    if(member==='retarget')assert.equal(x.root.querySelector('[data-sac-aggregate-control="retarget"]'),null);
    if(member==='pivot')assert.equal(x.root.querySelector('[data-sac-aggregate-pivot]'),null);
    if(member==='subtotal_position') {control(x,'grouping','rollup');assert.equal(x.root.querySelector('[data-sac-aggregate-control="subtotal-position"]'),null);}
  }));
}

test('As of needs both features and its route OpenAPI, preserving the timestamp on unrelated edits',()=>withDOM(async()=>{
  const x=await instance({hash:hashFor(withQuery(memberQuery.as_of()))});
  assert.equal(x.node('as-of-slot').hidden,false);rename(x,0,'rows');
  assert.equal(exported(x).query.as_of,memberQuery.as_of().as_of);
  const operation=x.console.openapi.paths['/api/orders/group-query'].post;
  operation.requestBody.content['application/json'].schema.properties={query:{properties:{as_of:false}}};
  x.console.renderAggregateBuilder();assert.equal(x.node('as-of-slot').hidden,true);
  reject(x,withQuery(memberQuery.as_of()),/does not publish/);
  delete x.console.openapi.paths['/api/orders/group-query'];assert.equal(x.console.supportsAsOf('aggregate'),false);
}));

test('Count by scopes groups and measures, preserves root filters and clears unavailable chips with an announcement',()=>withDOM(async()=>{
  const x=await instance({hash:hashFor(handoff)});
  control(x,'retarget','notes');
  assert.deepEqual(x.console.aggregateGroupFields().map(field=>field.id),['notes.kind','notes.stage','notes.weight']);
  assert.deepEqual(x.console.aggregateMeasureFields('sum').map(field=>field.id),['notes.weight']);
  assert.equal(x.console.queryFilterFields('aggregate').some(field=>field.id==='id'),true);
  assert.equal(x.console.queryFilterFields('aggregate').some(field=>field.id==='notes.kind'),false);
  assert.deepEqual(x.console.aggregateState.groupBy,[]);assert.equal(x.console.aggregateState.aggregates.length,1);
  assert.deepEqual(exported(x).query.filters,handoff.query.filters);
  assert.match(x.node('chooser-status').textContent,/unavailable.*removed/);
  assert.equal(exported(x).query.retarget,'notes');
  x.console.aggregateControl({dataset:{sacAggregateControl:'add-group'},value:'notes.kind'});
  assert.equal(x.console.addAggregateMeasure('sum','notes.weight'),true);
  control(x,'retarget','');assert.deepEqual(x.console.aggregateState.groupBy,[]);
  assert.equal(x.console.aggregateState.aggregates.length,1);assert.equal('retarget' in exported(x).query,false);
  reject(x,withQuery({...memberQuery.retarget(),retarget:'unknown'}),/not published/);
  reject(x,withQuery({...memberQuery.retarget(),group_by:['region'],select:['region',{aggregate:'count',alias:'n'}]}),/Unsupported aggregate selection/);
}));

test('pivot controls select typed chips and null, top-N and toggles; measure rename follows rank reference',()=>withDOM(async()=>{
  const x=await instance({hash:hashFor(base())});
  control(x,'pivot-column','channel');control(x,'pivot-mode','values');
  assert.equal(x.node('run').disabled,true);assert.match(x.root.querySelector('[data-sac-aggregate-errors="page"]').textContent,/distinct typed/);
  control(x,'pivot-value-input','open');x.console.aggregateAction({dataset:{sacAggregateAction:'pivot-add-value'}});
  assert.deepEqual(exported(x).query.pivot.values,['open']);
  const choices=x.console.aggregatePivotChoices(),idx=choices.findIndex(value=>value===null);
  const nullBox=x.root.querySelectorAll('[data-sac-aggregate-control="pivot-value"]')[idx];nullBox.checked=true;x.console.onChange({target:nullBox});
  control(x,'pivot-other','',{checked:true});control(x,'pivot-totals','',{checked:false});
  assert.deepEqual(exported(x).query.pivot,{column:'channel',values:['open',null],other:true,totals:false});
  control(x,'pivot-mode','top');control(x,'pivot-top-limit','2');control(x,'pivot-top-measure','total_amount');control(x,'pivot-top-order','natural');
  rename(x,1,'weight');assert.deepEqual(exported(x).query.pivot.top,{limit:2,measure:'weight',order:'natural'});
  control(x,'pivot-column','');assert.equal('pivot' in exported(x).query,false);
}));

test('pivot refuses contract combinations atomically and explains incomplete drafts inline',()=>withDOM(async()=>{
  const x=await instance({hash:hashFor(base())});
  const bad=[
    {pivot:{column:'channel',values:['open'],top:{limit:1,measure:'count'}}},
    {pivot:{column:'region',top:{limit:1,measure:'missing'}}},
    {pivot:{column:'missing'}},{pivot:{column:'channel',other:true}},{pivot:{column:'channel',values:[]}},
    {pivot:{column:'channel',values:['open','open']}},{pivot:{column:'channel',values:[2]}},
    {pivot:{column:'channel',top:{limit:0,measure:'count'}}},{pivot:{column:'channel',totals:'yes'}},
    {pivot:{column:'channel',top:{limit:2,measure:'count',order:'unknown'}}},
    {pivot:{column:'channel',values:['a','b','c','d'],other:true}},
    {pivot:{column:'channel',value_order:[]}},{pivot:{column:'channel',unknown:1}},
    {pivot:{column:'channel'},complete:true},
    {pivot:{column:'channel'},export:{all_rows:true,shape:'grid'}},
    {pivot:{column:'channel'},order_by:[{field:'channel',direction:'asc'}]},
    {pivot:{column:'region'},group_by:['region'],select:['region',{aggregate:'count',alias:'count'}]},
    {pivot:{column:'region'},select:['region','channel']}
  ];
  for(const changes of bad)reject(x,withQuery({...changes,rollup:false}),/Pivot|pivot|Top-N|sort|Other|Unsupported aggregate chooser/);
  x.console.aggregateAction({dataset:{sacAggregateAction:'group-remove',index:'1'}});
  assert.match(x.node('aggregate-page').textContent,/at least two groups/);
  control(x,'pivot-column','region');assert.equal(x.node('run').disabled,true);
  assert.match(x.root.querySelector('[data-sac-aggregate-errors="page"]').textContent,/at least two groups/);
}));

test('pivot retains typed integers, booleans, precise decimals and configured group aliases',()=>withDOM(async()=>{
  const f=coverageFeatures();f.fields.push(field('active','boolean'));f.fields.find(field=>field.id==='amount').type='decimal';
  const x=await instance({featureResponse:f});await x.choose('aggregate');
  for(const [axis,values] of [['id',[2,3,null]],['active',[true,false,null]],['amount',['12345678901234567890.125','2.50',null]]]) {
    
    const payload=withQuery({rollup:false,group_by:['region',axis],select:['region',axis,{aggregate:'count',alias:'count'}],pivot:{column:axis,values,totals:true}});
    assert.equal(load(x,payload),true);assert.deepEqual(exported(x).query.pivot.values,values);
  }
  const group={field:'created',alias:'month',format:'month'};
  const payload=withQuery({group_by:['region',group],select:['region',{group:'month'},{aggregate:'count',alias:'count'}],pivot:{column:'month',values:['2026-01',null]}});
  assert.equal(load(x,payload),true);assert.deepEqual(equivalent(exported(x)),equivalent(payload));
}));

test('explicit placement enables sorting with subtotals, and clearing it clears incompatible orders',()=>withDOM(async()=>{
  const x=await instance({hash:hashFor(handoff)});assert.equal(x.node('add-order').hidden,true);
  control(x,'subtotal-position','before');assert.equal(x.node('add-order').hidden,false);
  x.console.onClick({target:x.node('add-order')});assert.equal(exported(x).query.order_by.length,1);
  control(x,'subtotal-position','after');assert.equal(exported(x).query.subtotal_position,'after');assert.equal(exported(x).query.order_by.length,1);
  control(x,'subtotal-position','');assert.equal(x.node('add-order').hidden,true);assert.equal('order_by' in exported(x).query,false);
  reject(x,withQuery({rollup:false,subtotal_position:'before'}),/placement/);
  reject(x,withQuery({subtotal_position:'middle'}),/placement/);
  control(x,'subtotal-position','before');control(x,'grouping','none');assert.equal('subtotal_position' in exported(x).query,false);
}));

test('pivot response uses returned ids and metadata headers for objects and arrays, and shows the read clock',()=>withDOM(async()=>{
  const x=await instance({hash:hashFor(base())});
  const columns=[{id:'region',label:'Area',role:'group'},
    {id:'host_collision__',label:'misleading',pivot:{column:'channel',value:'open',measure:'count'}},
    {id:'host_empty',pivot:{column:'channel',value:null,other:false,measure:'count'}},
    {id:'host_other',pivot:{column:'channel',value:null,other:true,measure:'count'}},
    {id:'host_total',pivot:{column:'channel',total:true,measure:'count'}}];
  for(const row of [['A',2,3,4,9],{region:'A',host_collision__:2,host_empty:3,host_other:4,host_total:9}]) {
    x.console.renderResponse({ok:true,meta:{as_of:'2026-05-10'},data:{columns,rows:[row]}});
    const headers=x.node('result-head').querySelectorAll('tr');assert.equal(headers.length,2);
    assert.equal(headers[0].textContent,'Areacount');assert.equal(headers[0].children[1].colSpan,4);
    assert.equal(headers[1].textContent,'open(empty)OtherTotal');assert.equal(headers[1].children[0].title,'host_collision__');
    assert.equal(x.node('result-body').querySelector('tr').textContent,'A2349');assert.equal(x.node('response-as-of').textContent,'As of 2026-05-10');
  }
  x.console.renderResponse({ok:true,data:{columns:[],rows:[]}});assert.equal(x.node('response-as-of').hidden,true);
}));

test('all four members compose with retained Round 2 settings and optional pivot defaults stay exact',()=>withDOM(async()=>{
  const payload=withQuery({...memberQuery.retarget(),...memberQuery.as_of(),rollup:true,subtotal_position:'after',row_format:'objects',timezone:'UTC',count:'none',complete:false,
    pivot:{column:'notes.stage',top:{limit:2,measure:'weight'},other:false,totals:false,value_order:['done','open',null]},order_by:[{field:'weight',direction:'desc'}]});
  payload.query.select[2].ignore_nulls='auto';payload.request_id='coverage-preview';
  const x=await instance({hash:hashFor(payload)});assert.equal(x.console.state.rawDirty,false);assert.deepEqual(equivalent(exported(x)),equivalent(payload));
  rename(x,0,'total_weight');payload.query.select[2].alias='total_weight';payload.query.pivot.top.measure='total_weight';payload.query.order_by[0].field='total_weight';
  assert.deepEqual(equivalent(exported(x)),equivalent(payload));
  assert.equal(x.root.querySelector('[data-sac-aggregate-control="pivot-top-measure"]').value,'total_weight');
  await x.choose('flat');await x.choose('aggregate');assert.deepEqual(equivalent(exported(x)),equivalent(payload));
}));

test('typed pivot additions reject invalid input, preserve Boolean and decimal values, and detect equivalent numeric duplicates',()=>withDOM(async()=>{
  const f=coverageFeatures();f.fields.push(field('active','boolean'));f.fields.find(field=>field.id==='amount').type='decimal';
  const x=await instance({featureResponse:f});await x.choose('aggregate');
  for(const [axis,text,wanted] of [['id','2',2],['active','false',false],['amount','12345678901234567890.125','12345678901234567890.125']]) {
    const payload=withQuery({rollup:false,group_by:['region',axis],select:['region',axis,{aggregate:'count',alias:'count'}],pivot:{column:axis}});
    assert.equal(load(x,payload),true);control(x,'pivot-mode','values');control(x,'pivot-value-input',text);x.console.addAggregatePivotValue();
    assert.deepEqual(exported(x).query.pivot.values,[wanted]);
    if(axis==='id') {control(x,'pivot-value-input','bad');x.console.addAggregatePivotValue();assert.equal(x.node('run').disabled,true);assert.match(x.root.querySelector('[data-sac-aggregate-errors="page"]').textContent,/valid integer/);}
  }
  const payload=withQuery({rollup:false,group_by:['region','amount'],select:['region','amount',{aggregate:'count',alias:'count'}],pivot:{column:'amount',values:[1e-7,'0.0000001']}});
  reject(x,payload,/distinct typed/);
}));

test('manual requests cannot send unadvertised members even without loading the chooser',()=>withDOM(async()=>{
  const f=coverageFeatures();for(const member of Object.keys(memberQuery))delete f.supports[member];
  const x=await instance({featureResponse:f});await x.choose('aggregate');
  for(const changes of Object.values(memberQuery)) {
    x.node('request').value=JSON.stringify(withQuery(changes()));x.console.onInput({target:x.node('request')});await x.console.run();
    assert.equal(x.calls.some(call=>call.init.method==='POST'),false);
  }
}));

test('Enter commits a pivot chip while composition does not, and published choices retain checked types',()=>withDOM(async()=>{
  const x=await instance({hash:hashFor(base())});control(x,'pivot-column','channel');control(x,'pivot-mode','values');
  control(x,'pivot-value-input','open');let prevented=false;
  x.console.onKeyDown({key:'Enter',isComposing:true,target:x.root.querySelector('[data-sac-aggregate-control="pivot-value-input"]'),preventDefault(){prevented=true;}});
  assert.equal(prevented,false);assert.deepEqual(exported(x).query.pivot.values,[]);
  x.console.onKeyDown({key:'Enter',target:x.root.querySelector('[data-sac-aggregate-control="pivot-value-input"]'),preventDefault(){prevented=true;}});
  assert.equal(prevented,true);assert.deepEqual(exported(x).query.pivot.values,['open']);
  assert.equal(x.root.querySelector('[data-sac-aggregate-control="pivot-value-input"]').value,'');
  const doneIndex=x.console.aggregatePivotChoices().indexOf('done'),box=x.root.querySelectorAll('[data-sac-aggregate-control="pivot-value"]')[doneIndex];
  box.checked=true;x.console.onChange({target:box});assert.deepEqual(exported(x).query.pivot.values,['open','done']);
}));
