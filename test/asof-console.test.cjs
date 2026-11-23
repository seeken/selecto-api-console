const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../dist/selecto-api-console.js');
const c = globalThis.SelectoCanonicalClient, e = globalThis.SelectoExplorerClient;
const clockSchema = {type:'string', maxLength:45, pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,9})?(Z|[+-][0-9]{2}:[0-9]{2})?)?$'};
function openapi(envelope=false) {
  return {paths:{'/api/items/query':{post:{requestBody:{$ref:'#/components/requestBodies/Query'}}}}, components:{
    requestBodies:{Query:{content:{'application/json':{schema:{$ref:'#/components/schemas/Query'}}}}},
    schemas:{Query:{allOf:[{properties:envelope?{query:{$ref:'#/components/schemas/Body'}}:{as_of:clockSchema}}]},Body:{properties:{as_of:clockSchema}}}}};
}
class Node {
  constructor(tag='div') {this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.value='';this.hidden=false;this.textContent='';this.classList={add(){},remove(){}};}
  append(...nodes){this.children.push(...nodes);} replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(key,value){this[key]=value;}
}
function instance(remote=false) {
  const nodes = Object.fromEntries(['request','run','edited','query-path','response-as-of','empty-response','response-json','result-head','result-body','page-info'].map(key=>[`[data-sac-${key}]`,new Node()]));
  const x = new api.APIConsole({dataset:{apiBase:'/api/items'},querySelector:selector=>nodes[selector]});
  x.nodes=nodes;x.openapi=openapi(remote);x.domain={source:{fields:['id','due'],columns:{id:{type:'integer'},due:{type:'date'}}}};
  x.fields=api.collectFields(x.domain);x.fieldMap=new Map(x.fields.map(f=>[f.path,f]));x.filterFields=x.fields;x.filterFieldMap=x.fieldMap;
  x.state.selectedFields=[{id:'1',field:'id'}];x.remoteMode=remote;x.manifest={domain:{fingerprint:'fp'}};
  x.updateCurl=()=>{};x.setImportMessage=message=>{x.message=message;};x.switchResultTab=()=>{};
  return x;
}
function withDOM(fn) {const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};try{return fn();}finally{globalThis.document=previous;}}

test('As of adds and clears the bare and remote v1 query member beside last_7_days',()=>{
  for(const remote of [false,true]) {
    const x=instance(remote);x.state.asOf='2026-01-15';x.state.filters=[{id:'1',field:'due',op:'date_shortcut',value:'last_7_days'}];
    const payload=x.buildPayload(),query=remote?payload.query:payload;
    assert.equal(query.as_of,'2026-01-15');assert.deepEqual(query.filters,[{field:'due',op:'date_shortcut',value:'last_7_days'}]);
    x.changeAsOf('', 'flat');const cleared=x.buildPayload();assert.equal(Object.hasOwn(remote?cleared.query:cleared,'as_of'),false);
  }
});

test('pasted As of populates the chooser, URL request and retained draft, then survives a form edit',()=>{
  const x=instance(true),value='2026-01-15T14:30:00.123456789+02:00';
  const request={format:'selecto.remote-query',format_version:1,domain:{fingerprint:'fp'},query:{select:['id'],as_of:value}};
  const url=api.requestPayloadFromLocation({hash:`#request=${encodeURIComponent(JSON.stringify(request))}`});
  x.loadPayloadIntoChooser(url);assert.equal(x.state.asOf,value);x.state.limit=25;
  assert.equal(x.buildPayload().query.as_of,value);x.syncRequest(true);x.retainProfileDraft();
  assert.equal(x.profileDrafts.flat.state.asOf,value);assert.equal(JSON.parse(x.profileDrafts.flat.raw).query.as_of,value);
});

test('schema discovery follows local refs and allOf; hidden controls neither assume a global schema nor show on v2',()=>withDOM(()=>{
  const x=instance(true),slot=new Node();x.renderAsOf(slot,'flat');assert.equal(slot.hidden,false);
  assert.equal(slot.children[0].children[0].children[0].value,'');assert.equal(slot.children[0].children[1].textContent,'Today');
  x.openapi={components:openapi().components,paths:{}};x.renderAsOf(slot,'flat');assert.equal(slot.hidden,true);assert.equal(slot.children.length,0);
  assert.equal(x.supportsAsOf('root'),false);
}));

test('calendar, time and offset correctness go beyond the protocol shape pattern',()=>{
  for(const value of ['2026-01-15','2024-02-29','0001-01-01','2026-01-15T14:30:00','2026-01-15T14:30:00Z','2026-01-15T14:30:00.123456789-07:00'])assert.equal(c.assertAsOf(value),value);
  for(const value of ['',null,1,{},'today','0000-01-01','2026-02-29','2026-04-31','2026-13-01','2026-01-15T24:00:00Z','2026-01-15T00:60:00Z','2026-01-15T00:00:60Z','2026-01-15T00:00:00+24:00','2026-01-15T00:00:00+01:60','2026-01-15T00:00:00.1234567890Z'])assert.throws(()=>c.assertAsOf(value),/valid ISO/);
});

test('invalid builder date disables Run and manually pasted invalid dates are refused before transport',async()=>{
  const x=instance();x.state.asOf='2026-02-30';x.syncRequest(true);assert.equal(x.nodes['[data-sac-run]'].disabled,true);assert.match(x.message,/valid ISO/);
  let calls=0;const previousFetch=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error("Unexpected transport");};x.setStatus=()=>{};x.showLocalError=message=>{x.error=message;};
  x.state.rawDirty=true;x.nodes['[data-sac-request]'].value=JSON.stringify({select:['id'],as_of:'bad'});
  try {await x.run();assert.equal(calls,0);assert.match(x.error,/valid ISO/);} finally {globalThis.fetch=previousFetch;}
});

test('resource GET retains the POST clock privately and only sends it when the parameter is published',()=>{
  const x=instance();x.resourcePath='/api/items/{id}';x.state.queryMethod='get';x.state.resourceId='7';x.state.asOf='2026-01-15';
  assert.equal(x.supportsAsOf(),false);assert.deepEqual(x.buildResourceRequest().errors,[]);assert.doesNotMatch(x.buildResourceRequest().path,/as_of/);
  x.openapi.paths[x.resourcePath]={get:{parameters:[{in:'query',name:'as_of',schema:clockSchema}]}};
  assert.equal(x.supportsAsOf(),true);assert.match(x.buildResourceRequest().path,/as_of=2026-01-15/);
});

function aggregate() {
  const x=instance();x.aggregateFeatures={domain:{fingerprint:'fp'},revision:'rev',fields:[],limits:{},supports:{aggregate:true}};
  x.aggregateQueryPath='/api/aggregate';x.openapi.paths[x.aggregateQueryPath]=x.openapi.paths[x.queryPath];x.aggregateState=x.newAggregateState();x.queryProfile='aggregate';return x;
}
test('aggregate As of follows its route schema, imports and survives another builder edit',()=>{
  const x=aggregate();x.aggregateState.asOf='2026-01-15';const payload=x.buildAggregateRequest().request;
  assert.equal(payload.query.as_of,'2026-01-15');x.aggregateState=x.newAggregateState();x.loadPayloadIntoChooser(payload);
  assert.equal(x.aggregateState.asOf,'2026-01-15');x.aggregateState.aggregates[0].alias='n';assert.equal(x.buildAggregateRequest().request.query.as_of,'2026-01-15');
  delete x.openapi.paths[x.aggregateQueryPath];assert.equal(x.supportsAsOf('aggregate'),false);assert.match(x.buildAggregateRequest().errors.join(' '),/does not publish/);
});

test('nested As of survives query import, edits, URL state and private state codecs, and admits metadata echo',async()=>{
  const f=(await import('../packages/canonical-client/test/nested-fixture.mjs')).fixture(),x=instance(true);
  x.nestedDetailContext={...f.trusted,features:f.features,binding:e.nestedDetailBinding(f.features)};x.queryProfile='nested';
  const payload=c.buildNestedDetailRequest('fp',{...f.query,timezone:'UTC',as_of:'2026-01-15T12:00:00Z'},{features:f.features,context:f.context});
  x.loadPayloadIntoChooser(payload);assert.equal(x.nestedState.intent.as_of,payload.query.as_of);x.nestedState.intent.limit=10;
  assert.equal(x.buildPayload().query.as_of,payload.query.as_of);
  const encoded=e.encodeNestedDetailState(x.nestedState),decoded=e.decodeNestedDetailState(encoded);
  assert.equal(decoded.intent.as_of,payload.query.as_of);assert.equal(e.parseNestedDetailState(JSON.stringify(decoded),x.nestedDetailContext).intent.as_of,payload.query.as_of);
  f.result.meta.as_of=payload.query.as_of;assert.equal(c.assertNestedDetailResult(f.result,{features:f.features,context:f.context,query:payload.query}),f.result);
});

test('response clock reads only the success envelope meta.as_of and clears on another result',()=>withDOM(()=>{
  const x=instance(),clock=x.nodes['[data-sac-response-as-of]'];
  x.renderResponse({ok:true,meta:{as_of:'2026-01-15'},data:{columns:[],rows:[]}});assert.equal(clock.textContent,'As of 2026-01-15');assert.equal(clock.hidden,false);
  x.renderResponse({ok:true,data:{as_of:'wrong',columns:[],rows:[]}});assert.equal(clock.hidden,true);assert.equal(clock.textContent,'');
}));


test('input events update the generated cURL body and Today clears the control',()=>{
  const x=instance(),previous=globalThis.window;globalThis.window={location:{origin:'https://example.test'}};
  try {
    x.onInput({target:{matches:selector=>selector==='[data-sac-as-of]',dataset:{sacAsOf:'flat'},value:'2026-01-15T12:00:00-07:00'}});
    const request=x.nodes['[data-sac-request]'].value;
    assert.match(x.curlCommand(x.queryPath,request),/"as_of": "2026-01-15T12:00:00-07:00"/);
    const input={value:x.state.asOf},button={dataset:{sacAsOfClear:'flat'},parentElement:{querySelector:()=>input}};
    x.onClick({target:{closest:selector=>selector==='[data-sac-as-of-clear]'?button:null}});
    assert.equal(input.value,'');assert.equal(x.state.asOf,'');assert.equal(Object.hasOwn(JSON.parse(x.nodes['[data-sac-request]'].value),'as_of'),false);
  } finally {globalThis.window=previous;}
});
