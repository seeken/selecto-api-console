const test = require('node:test');
const assert = require('node:assert/strict');
const api = require('../dist/selecto-api-console.js');
const c = globalThis.SelectoCanonicalClient, e = globalThis.SelectoExplorerClient;
class Node {
  constructor(tag='div') {this.tagName=tag.toUpperCase();this.children=[];this.dataset={};this.value='';this.textContent='';this.classList={add(){},remove(){}};}
  append(...nodes){for(const node of nodes){node.parentElement=this;this.children.push(node);}} add(node){this.append(node);if(node.selected)this.value=node.value;}
  replaceChildren(...nodes){this.children=[];this.append(...nodes);} setAttribute(k,v){this[k]=v;}
  matches(selector){const m=/^\[data-([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);if(!m)return false;const k=m[1].replace(/-([a-z])/g,(_,s)=>s.toUpperCase());return Object.hasOwn(this.dataset,k)&&(m[2]===undefined||this.dataset[k]===m[2]);}
  closest(s){return this.matches(s)?this:this.parentElement?.closest(s)||null;}
  querySelector(s){for(const child of this.children){if(child.matches(s))return child;const result=child.querySelector(s);if(result)return result;}return null;}
  focus(){globalThis.document.activeElement=this;}
}
function withDOM(fn){const doc=globalThis.document,opt=globalThis.Option;globalThis.document={createElement:tag=>new Node(tag)};globalThis.Option=class extends Node {constructor(text,value,defaultSelected,selected){super('option');this.textContent=text;this.value=value;this.selected=selected;}};try{return fn();}finally{globalThis.document=doc;globalThis.Option=opt;}}
function instance(remote=false, published=true) {
  const nodes=Object.fromEntries(['filters','request','run','run-label','cancel-query','edited','query-path','curl','response-status','response-as-of','empty-response','response-json','result-head','result-body','page-info'].map(k=>[`[data-sac-${k}]`,new Node()]));
  const x=new api.APIConsole({dataset:{apiBase:'/api/items'},querySelector:s=>nodes[s]});x.nodes=nodes;
  x.openapi={components:{schemas:{SelectoFilter:{$ref:'#/components/schemas/Filter'},Filter:{allOf:[{properties:{op:{enum:['eq','ne',...(published?['on']:[])]}}}]}}}};
  x.domain={source:{fields:['id','pickup','due','at','naive','utc'],columns:{id:{type:'integer'},pickup:{type:'epoch_datetime'},due:{type:'date'},at:{type:'datetime'},naive:{type:'naive_datetime'},utc:{type:'utc_datetime'}}}};
  x.fields=api.collectFields(x.domain);x.fieldMap=new Map(x.fields.map(f=>[f.path,f]));x.filterFields=x.fields;x.filterFieldMap=x.fieldMap;
  x.state.selectedFields=[{id:'1',field:'id'}];x.remoteMode=remote;x.manifest={domain:{fingerprint:'fp'}};
  x.updateCurl=()=>{};x.setImportMessage=message=>{x.message=message;};x.switchResultTab=()=>{};
  return x;
}
const filter=(value='2026-01-15',field='pickup')=>({id:'1',field,op:'on',value});
const query=x=>{const p=x.buildPayload();return x.remoteMode?p.query:p;};
const part=(x,name)=>x.nodes['[data-sac-filters]'].querySelector(`[data-sac-period-part="${name}"]`);
function edit(x,name,value,event='onInput'){const target=part(x,name);assert.ok(target,name);target.value=value;x[event]({target});}

test('period discovery follows refs and allOf; only temporal fields opt in and on follows equals',()=>{
  for(const published of [false,true]) {
    const x=instance(false,published);
    for(const f of x.fields){const ops=x.queryFilterOperators(f,'flat');assert.equal(ops.includes('on'),published&&f.type!=='integer');if(ops.includes('on'))assert.equal(ops.indexOf('on'),ops.indexOf('eq')+1);}
    assert.deepEqual(api.operatorsForType('date'),x.queryFilterOperators(x.fieldMap.get('due'), 'flat').filter(op=>op!=='on'));
  }
});

test('new epoch datetime filter defaults to on Day, while equality retains raw epoch seconds',()=>withDOM(()=>{
  for(const published of [false,true]) {
    const x=instance(false,published);x.changed=()=>{x.renderFilters();x.syncRequest(true);};
    const button=new Node('button');button.dataset.sacAddFilter='pickup';x.onClick({target:button});
    assert.equal(x.state.filters[0].op,published?'on':'eq');
    if(published){assert.equal(part(x,'precision').value,'day');assert.equal(part(x,'value').type,'date');edit(x,'value','2026-01-15');assert.equal(query(x).filters[0].value,'2026-01-15');}
    x.state.filters[0].op='eq';x.state.filters[0].value='1768471200';x.renderFilters();
    assert.equal(x.nodes['[data-sac-filters]'].querySelector('[data-sac-filter-value]').type,'number');
    assert.deepEqual(query(x).filters,[{field:'pickup',op:'eq',value:'1768471200'}]);
  }
}));

const cases=[['year','2026','text'],['month','2026-01','month'],['day','2026-01-15','date'],['hour','2026-01-15T10','date'],['minute','2026-01-15T10:30','datetime-local']];
for(const [precision,value,type] of cases) test(`${precision} native control emits an exact period and pasted requests survive edits, URLs, drafts and curl`,()=>withDOM(()=>{
  const previous=globalThis.window;globalThis.window={location:{origin:'https://example.test'}};
  try {for(const remote of [false,true]) {
    const x=instance(remote);x.state.filters=[filter()];x.renderFilters();edit(x,'precision',precision,'onChange');
    assert.equal(part(x,'value').type,type);if(precision==='minute')assert.equal(part(x,'value').step,'60');
    edit(x,'value',precision==='hour'?value.slice(0,10):value);if(precision==='hour')edit(x,'hour','10','onChange');
    assert.deepEqual(query(x).filters,[{field:'pickup',op:'on',value}]);
    const q={select:['id'],filters:[{field:'pickup',op:'on',value}]};
    const request=remote?{format:'selecto.remote-query',format_version:1,domain:{fingerprint:'fp'},query:q}:q;
    x.loadPayloadIntoChooser(api.requestPayloadFromLocation({hash:`#request=${encodeURIComponent(JSON.stringify(request))}`}));x.renderFilters();
    assert.equal(part(x,'precision').value,precision);assert.equal(part(x,'value').value,precision==='hour'?value.slice(0,10):value);
    x.state.limit=25;x.syncRequest(true);x.retainProfileDraft();
    assert.equal(query(x).filters[0].value,value);assert.equal(x.profileDrafts.flat.state.filters[0].value,value);
    assert.ok(x.curlCommand(x.queryPath,x.nodes['[data-sac-request]'].value).includes(`"value": "${value}"`));
    assert.match(x.nodes['[data-sac-filters]'].querySelector('[data-sac-period-hint]').textContent,/Matches .*API's time zone/);
  }} finally {globalThis.window=previous;}
}));

test('date fields offer only Year Month Day, and imported subday periods are refused',()=>withDOM(()=>{
  const x=instance();x.state.filters=[filter('2026-01','due')];x.renderFilters();
  assert.deepEqual(part(x,'precision').children.map(n=>n.value),['year','month','day']);
  assert.throws(()=>x.loadPayloadIntoChooser({select:['id'],filters:[{field:'due',op:'on',value:'2026-01-15T10'}]}),/valid calendar period/);
}));

test('malformed and impossible imported or manual periods are refused before transport; invalid builder disables Run',async()=>{
  const x=instance();let calls=0;const previous=globalThis.fetch;globalThis.fetch=async()=>{calls++;throw new Error('transport');};
  x.setStatus=()=>{};x.showLocalError=message=>{x.error=message;};
  try {for(const value of ['2026-13','2026-01-15T10:30:00','2026-01-15T10:30+02:00','2026-02-30','2026-02-29','0000','2026-01-15T24','2026-01-15T10:60',2026,null,{},[],'2026\n']) {
    const request={select:['id'],filters:[{field:'pickup',op:'on',value}]};
    assert.throws(()=>x.loadPayloadIntoChooser(request),/valid calendar period/);
    x.state.rawDirty=true;x.nodes['[data-sac-request]'].value=JSON.stringify(request);await x.run();assert.match(x.error,/valid calendar period/);
    x.state.filters=[filter(value)];x.syncRequest(true);assert.equal(x.nodes['[data-sac-run]'].disabled,true);
  }}finally{globalThis.fetch=previous;}
  assert.equal(calls,0);
  for(const [published,field] of [[false,'pickup'],[true,'id']]) {const y=instance(false,published);assert.throws(()=>y.loadPayloadIntoChooser({select:['id'],filters:[{field,op:'on',value:'2026'}]}),/not available/);}
});

function aggregate() {
  const x=instance();x.aggregateFeatures={domain:{fingerprint:'fp'},revision:'rev',fields:x.fields.map(f=>({...f,id:f.path,collection:null,filterable:true,operators:['eq','on'],aggregates:[]})),limits:{},supports:{aggregate:true}};
  x.aggregateState=x.newAggregateState();x.queryProfile='aggregate';return x;
}
test('aggregate imports and builder controls preserve period filters and reject invalid manual Run',async()=>withDOM(async()=>{
  const x=aggregate();x.aggregateState.filters=[filter('2026-01')];let model=x.buildAggregateRequest();assert.deepEqual(model.errors,[]);
  x.loadPayloadIntoChooser(model.request);x.aggregateState.aggregates[0].alias='n';assert.deepEqual(x.buildAggregateRequest().request.query.filters,model.request.query.filters);
  x.loadPayloadIntoChooser({...model.request,query:{...model.request.query,filters:[]}});assert.deepEqual(x.buildAggregateRequest().request.query.filters,[]);
  x.loadPayloadIntoChooser(model.request);
  const list=x.nodes['[data-sac-filters]'];x.renderFilters(list,x.aggregateState.filters,'aggregate');edit(x,'value','2026-02');
  assert.equal(x.buildAggregateRequest().request.query.filters[0].value,'2026-02');
  x.aggregateState.filters[0].value='2026-13';assert.match(x.buildAggregateRequest().errors.join(' '),/valid calendar period/);
  x.setStatus=()=>{};x.showLocalError=m=>{x.error=m;};x.state.rawDirty=true;
  x.nodes['[data-sac-request]'].value=JSON.stringify({...model.request,query:{...model.request.query,filters:[{field:'pickup',op:'on',value:'2026-13'}]}});
  await x.runAggregate();assert.match(x.error,/valid calendar period/);
}));

test('nested date parent filters retain advertised on periods through state codecs and edits',async()=>{
  const f=(await import('../packages/canonical-client/test/nested-fixture.mjs')).fixture(),x=instance(true);
  f.features.root_fields.find(f=>f.path==='due').operators.splice(1,0,'on');
  x.nestedDetailContext={...f.trusted,features:f.features,binding:e.nestedDetailBinding(f.features)};x.queryProfile='nested';
  const request=c.buildNestedDetailRequest('fp',{...f.query,timezone:'UTC',filters:[{field:'due',op:'on',value:'2026-01'}]},{features:f.features,context:f.context});
  x.loadPayloadIntoChooser(request);assert.equal(x.buildPayload().query.filters[0].value,'2026-01');
  const state=e.parseNestedDetailState(JSON.stringify(e.decodeNestedDetailState(e.encodeNestedDetailState(x.nestedState))),x.nestedDetailContext);assert.equal(state.intent.filters[0].value,'2026-01');
  withDOM(()=>{
    const filter=x.nestedState.intent.filters[0],field=f.features.root_fields.find(f=>f.path==='due'),row=new Node();row.dataset.filterId=filter.id;row.dataset.filterProfile='nested';row.append(x.periodControl(filter,field));
    const target=row.querySelector('[data-sac-period-part="value"]');target.value='2026-02';x.onInput({target});assert.equal(x.buildPayload().query.filters[0].value,'2026-02');
    target.value='2026-13';x.onInput({target});assert.equal(x.nodes['[data-sac-run]'].disabled,true);
  });
  x.nestedState.intent.filters[0].value="2026-01";x.openapi={};assert.throws(()=>x.buildPayload(),/not available/);
});
