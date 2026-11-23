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
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}} replaceChildren(...nodes){this.children=[];this.append(...nodes);}
  setAttribute(key,value){this[key]=value;}
  matches(selector){
    const match=/^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if(!match)return false;
    const key=match[1].replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase());
    return Object.hasOwn(this.dataset,key)&&(match[2]===undefined||this.dataset[key]===match[2]);
  }
  closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)||null;}
  querySelector(selector){for(const child of this.children){if(child.matches(selector))return child;const found=child.querySelector(selector);if(found)return found;}return null;}
  focus(){globalThis.document.activeElement=this;}
}
function instance(remote=false, options={}) {
  const nodes = Object.fromEntries(['request','run','run-label','cancel-query','edited','query-path','curl','response-status','response-as-of','empty-response','response-json','result-head','result-body','page-info'].map(key=>[`[data-sac-${key}]`,new Node()]));
  const x = new api.APIConsole({dataset:{apiBase:'/api/items'},querySelector:selector=>nodes[selector]},options);
  x.nodes=nodes;x.openapi=openapi(remote);x.domain={source:{fields:['id','due'],columns:{id:{type:'integer'},due:{type:'date'}}}};
  x.fields=api.collectFields(x.domain);x.fieldMap=new Map(x.fields.map(f=>[f.path,f]));x.filterFields=x.fields;x.filterFieldMap=x.fieldMap;
  x.state.selectedFields=[{id:'1',field:'id'}];x.remoteMode=remote;x.manifest={domain:{fingerprint:'fp'}};
  x.updateCurl=()=>{};x.setImportMessage=message=>{x.message=message;};x.switchResultTab=()=>{};
  return x;
}
function withDOM(fn) {const previous=globalThis.document;globalThis.document={createElement:tag=>new Node(tag)};try{return fn();}finally{globalThis.document=previous;}}
const part=(slot,name)=>slot.querySelector(`[data-sac-as-of-part="${name}"]`);
function edit(x,slot,name,value,event='onInput'){const target=part(slot,name);target.value=value;x[event]({target});return target;}
function click(x,slot,selector){x.onClick({target:slot.querySelector(selector)});}

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
  assert.equal(part(slot,'date').value,'');assert.equal(part(slot,'date').type,'date');
  assert.equal(slot.querySelector('[data-sac-as-of-clear]').textContent,'Today');
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
test('aggregate As of follows its route schema, imports and survives another builder edit',()=>withDOM(()=>{
  const x=aggregate();x.aggregateState.asOf='2026-01-15';const payload=x.buildAggregateRequest().request;
  assert.equal(payload.query.as_of,'2026-01-15');x.aggregateState=x.newAggregateState();x.loadPayloadIntoChooser(payload);
  assert.equal(x.aggregateState.asOf,'2026-01-15');x.aggregateState.aggregates[0].alias='n';assert.equal(x.buildAggregateRequest().request.query.as_of,'2026-01-15');
  const slot=new Node();x.renderAsOf(slot,'aggregate');edit(x,slot,'date','2026-10-31');
  assert.equal(x.buildAggregateRequest().request.query.as_of,'2026-10-31');
  click(x,slot,'[data-sac-as-of-toggle]');edit(x,slot,'zone','utc','onChange');
  assert.equal(x.buildAggregateRequest().request.query.as_of,'2026-10-31T00:00:00Z');
  click(x,slot,'[data-sac-as-of-clear]');assert.equal(Object.hasOwn(x.buildAggregateRequest().request.query,'as_of'),false);
  x.aggregateState.asOf='2026-01-15';
  delete x.openapi.paths[x.aggregateQueryPath];assert.equal(x.supportsAsOf('aggregate'),false);assert.match(x.buildAggregateRequest().errors.join(' '),/does not publish/);
}));

test('nested As of survives query import, edits, URL state and private state codecs, and admits metadata echo',async()=>{
  const f=(await import('../packages/canonical-client/test/nested-fixture.mjs')).fixture(),x=instance(true);
  x.nestedDetailContext={...f.trusted,features:f.features,binding:e.nestedDetailBinding(f.features)};x.queryProfile='nested';
  const payload=c.buildNestedDetailRequest('fp',{...f.query,timezone:'UTC',as_of:'2026-01-15T12:00:00Z'},{features:f.features,context:f.context});
  x.loadPayloadIntoChooser(payload);assert.equal(x.nestedState.intent.as_of,payload.query.as_of);x.nestedState.intent.limit=10;
  assert.equal(x.buildPayload().query.as_of,payload.query.as_of);
  const encoded=e.encodeNestedDetailState(x.nestedState),decoded=e.decodeNestedDetailState(encoded);
  assert.equal(decoded.intent.as_of,payload.query.as_of);assert.equal(e.parseNestedDetailState(JSON.stringify(decoded),x.nestedDetailContext).intent.as_of,payload.query.as_of);
  f.result.meta.as_of=payload.query.as_of;assert.equal(c.assertNestedDetailResult(f.result,{features:f.features,context:f.context,query:payload.query}),f.result);
  withDOM(()=>{
    const slot=new Node();x.renderAsOf(slot,'nested');edit(x,slot,'time','13:45');
    assert.equal(x.buildPayload().query.as_of,'2026-01-15T13:45:00Z');
    click(x,slot,'[data-sac-as-of-toggle]');assert.equal(x.buildPayload().query.as_of,'2026-01-15');
    click(x,slot,'[data-sac-as-of-clear]');assert.equal(Object.hasOwn(x.buildPayload().query,'as_of'),false);
  });
});

test('response clock reads only the success envelope meta.as_of and clears on another result',()=>withDOM(()=>{
  const x=instance(),clock=x.nodes['[data-sac-response-as-of]'];
  x.renderResponse({ok:true,meta:{as_of:'2026-01-15'},data:{columns:[],rows:[]}});assert.equal(clock.textContent,'As of 2026-01-15');assert.equal(clock.hidden,false);
  x.renderResponse({ok:true,data:{as_of:'wrong',columns:[],rows:[]}});assert.equal(clock.hidden,true);assert.equal(clock.textContent,'');
}));


test('input events update the generated cURL body and Today clears the control',()=>withDOM(()=>{
  const x=instance(),previous=globalThis.window;globalThis.window={location:{origin:'https://example.test'}};
  try {
    x.state.asOf='2026-01-15T12:00:00-07:00';const slot=new Node();x.renderAsOf(slot,'flat');
    edit(x,slot,'time','12:00:00');
    const request=x.nodes['[data-sac-request]'].value;
    assert.match(x.curlCommand(x.queryPath,request),/"as_of": "2026-01-15T12:00:00-07:00"/);
    click(x,slot,'[data-sac-as-of-clear]');
    assert.equal(part(slot,'date').value,'');assert.equal(part(slot,'time'),null);
    assert.equal(x.state.asOf,'');assert.equal(Object.hasOwn(JSON.parse(x.nodes['[data-sac-request]'].value),'as_of'),false);
    assert.equal(globalThis.document.activeElement,part(slot,'date'));
  } finally {globalThis.window=previous;}
}));

test('date picker, optional seconds, explicit offset, UTC and removing time keep both request contracts',()=>withDOM(()=>{
  for(const remote of [false,true]) {
    const x=instance(remote),slot=new Node();x.renderAsOf(slot,'flat');
    const query=()=>{const payload=x.buildPayload();return remote?payload.query:payload;};
    edit(x,slot,'date','2026-10-31');assert.equal(query().as_of,'2026-10-31');
    assert.equal(slot.querySelector('[data-sac-as-of-summary]').textContent,'As of Sat 31 Oct 2026');
    click(x,slot,'[data-sac-as-of-toggle]');
    assert.equal(part(slot,'time').type,'time');assert.equal(part(slot,'time').step,'1');
    assert.equal(globalThis.document.activeElement,part(slot,'time'));assert.equal(part(slot,'offset').readOnly,true);
    edit(x,slot,'time','17:00');edit(x,slot,'zone','custom','onChange');edit(x,slot,'offset','-07:00');
    assert.equal(query().as_of,'2026-10-31T17:00:00-07:00');assert.equal(part(slot,'offset').readOnly,false);
    assert.equal(slot.querySelector('[data-sac-as-of-summary]').textContent,'As of 31 Oct 2026, 17:00 −07:00');
    edit(x,slot,'time','17:00:42');assert.equal(query().as_of,'2026-10-31T17:00:42-07:00');
    edit(x,slot,'zone','utc','onChange');assert.equal(query().as_of,'2026-10-31T17:00:42Z');
    assert.equal(part(slot,'offset').value,'Z');assert.equal(part(slot,'offset').readOnly,true);
    click(x,slot,'[data-sac-as-of-toggle]');assert.equal(query().as_of,'2026-10-31');assert.equal(part(slot,'time'),null);
    assert.equal(globalThis.document.activeElement,part(slot,'date'));
  }
}));

test('quick picks use an injected browser calendar across quarter, year, leap and week boundaries',()=>withDOM(()=>{
  const cases=[
    [new Date(2026,10,23,0,5),['2026-11-22','2026-11-22','2026-10-31','2026-09-30','2025-12-31']],
    [new Date(2026,3,1,23,55),['2026-03-31','2026-03-29','2026-03-31','2026-03-31','2025-12-31']],
    [new Date(2026,0,1,0,5),['2025-12-31','2025-12-28','2025-12-31','2025-12-31','2025-12-31']],
    [new Date(2024,2,3,12),['2024-03-02','2024-02-25','2024-02-29','2023-12-31','2023-12-31']],
  ];
  let now=cases[0][0];const x=instance(false,{now:()=>now}),slot=new Node();
  for(const [date,expected] of cases) {
    now=date;x.state.asOf='2000-01-01T12:00:00Z';x.renderAsOf(slot,'flat');
    for(const [i,pick] of ['yesterday','week','month','quarter','year'].entries()) {
      click(x,slot,`[data-sac-as-of-quick-pick="${pick}"]`);
      assert.equal(x.buildPayload().as_of,expected[i],`${date.toString()}: ${pick}`);
      assert.equal(part(slot,'time'),null);
    }
  }
}));

test('adding time without a date uses injected today, and browser offsets follow the selected date and time',()=>withDOM(()=>{
  const previous=process.env.TZ;process.env.TZ='America/Denver';
  try {
    const x=instance(false,{now:()=>new Date(2026,0,15,17)}),slot=new Node();x.renderAsOf(slot,'flat');
    click(x,slot,'[data-sac-as-of-toggle]');assert.equal(x.state.asOf,'2026-01-15T00:00:00-07:00');
    edit(x,slot,'date','2026-07-15');assert.equal(x.state.asOf,'2026-07-15T00:00:00-06:00');
    x.renderAsOf(slot,'flat');assert.equal(part(slot,'zone').value,'browser');
    edit(x,slot,'date','2026-03-08');edit(x,slot,'time','01:30');assert.equal(x.state.asOf,'2026-03-08T01:30:00-07:00');
    edit(x,slot,'time','03:30');assert.equal(x.state.asOf,'2026-03-08T03:30:00-06:00');
    assert.equal(part(slot,'offset').value,'-06:00');
    const date=part(slot,'date');date.focus();edit(x,slot,'date','');assert.equal(x.state.asOf,'');
    assert.equal(part(slot,'date'),date);assert.equal(globalThis.document.activeElement,date);
    edit(x,slot,'date','2026-07-15');assert.equal(x.state.asOf,'2026-07-15T03:30:00-06:00');
  } finally {if(previous===undefined)delete process.env.TZ;else process.env.TZ=previous;}
}));

test('fractional imported values retain exact text through other form edits, drafts, URLs and the curl preview',()=>withDOM(()=>{
  const previous=globalThis.window;globalThis.window={location:{origin:'https://example.test'}};
  try {
    for(const remote of [false,true]) {
      const x=instance(remote),slot=new Node(),value='2026-01-15T10:30:00.123456+05:30';
      const query={select:['id'],as_of:value};
      const request=remote?{format:'selecto.remote-query',format_version:1,domain:{fingerprint:'fp'},query}:query;
      x.loadPayloadIntoChooser(api.requestPayloadFromLocation({hash:`#request=${encodeURIComponent(JSON.stringify(request))}`}));
      x.renderAsOf(slot,'flat');assert.equal(part(slot,'text').value,value);assert.equal(part(slot,'text').type,'text');
      assert.match(slot.children[0].children.at(-1).textContent,/kept exactly as imported/);
      x.updateCurl=api.APIConsole.prototype.updateCurl;
      const limit=new Node('input');limit.dataset.sacLimit='';limit.value='25';x.onInput({target:limit});
      x.renderAsOf(slot,'flat');x.retainProfileDraft();
      assert.equal(part(slot,'text').value,value);assert.equal(x.profileDrafts.flat.state.asOf,value);
      assert.equal(x.asOfValue(),value);assert.ok(x.nodes['[data-sac-curl]'].textContent.includes(`"as_of": "${value}"`));
      assert.match(slot.querySelector('[data-sac-as-of-summary]').textContent,/10:30:00\.123456 \+05:30/);
    }
  } finally {globalThis.window=previous;}
}));

test('fallback edits and incomplete explicit offsets disable Run; time can be removed from an incomplete edit',()=>withDOM(()=>{
  const x=instance(),slot=new Node();x.state.asOf='2026-01-15T10:30:00.123456+05:30';x.renderAsOf(slot,'flat');
  edit(x,slot,'text','2026-02-30');assert.equal(x.nodes['[data-sac-run]'].disabled,true);assert.match(x.message,/valid ISO/);
  edit(x,slot,'text','2026-01-15T10:30:00+05:30');assert.equal(x.nodes['[data-sac-run]'].disabled,false);
  x.renderAsOf(slot,'flat');assert.equal(part(slot,'offset').value,'+05:30');
  edit(x,slot,'offset','');assert.equal(x.nodes['[data-sac-run]'].disabled,true);
  click(x,slot,'[data-sac-as-of-toggle]');assert.equal(x.state.asOf,'2026-01-15');assert.equal(x.nodes['[data-sac-run]'].disabled,false);
  x.state.asOf='2026-01-15T10:30:00';x.renderAsOf(slot,'flat');assert.equal(part(slot,'text').value,x.state.asOf);
}));
