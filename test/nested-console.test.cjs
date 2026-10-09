const test = require('node:test');
const assert = require('node:assert/strict');
require('../dist/selecto-api-console.js');
const {APIConsole, nestedStateFromLocation} = require('../src/selecto-api-console.js');
const c = globalThis.SelectoCanonicalClient, e = globalThis.SelectoExplorerClient;

async function instance() {
  const x = (await import('../packages/canonical-client/test/nested-fixture.mjs')).fixture();
  const context = {...x.trusted, features:x.features, binding:e.nestedDetailBinding(x.features)};
  const intent = e.createNestedDetailIntent(x.features);
  intent.select=x.query.select.map(item=>Array.isArray(item)?item.map(path=>x.features.collections[0].fields.find(f=>f.path===path).id):x.features.root_fields.find(f=>f.path===item).id);
  const state={format:'selecto.nested-detail-state',format_version:1,intent};
  const nodes={};
  for(const key of ['request','nested-state','root-state','root-mode','edited','run','run-label','cancel-query','post-editor-actions','response-json','empty-response','page-info','query-path'])nodes[`[data-sac-${key}]`]={value:'',hidden:false,disabled:false,textContent:'',classList:{add(){},remove(){}}};
  nodes['.sac-builder']={hidden:false};
  const console=new APIConsole({dataset:{apiBase:'/api/pilot'},querySelector:selector=>nodes[selector]});
  console.remoteMode=true;console.manifest=x.manifest;console.explorerClient={};console.nestedDomainId='pilot';console.nestedDetailContext=context;console.queryProfile='nested';console.nestedState=state;
  console.renderNestedBuilder=()=>{};console.renderAll=()=>console.syncRequest(true);console.updateCurl=()=>{};
  const messages=[],rendered=[];console.setImportMessage=(message,kind)=>messages.push({message,kind});console.setStatus=()=>{};console.renderResponse=payload=>rendered.push(payload);console.showLocalError=message=>messages.push({message,kind:'error'});
  console.freshNestedContext=async()=>context;console.syncNestedRequest();
  return {...x,console,nodes,messages,rendered,context,state};
}

class FakeNode {
  constructor(tag){this.tag=tag;this.children=[];this.textContent='';this.dataset={};this.attributes={};}
  append(...nodes){this.children.push(...nodes);}
  replaceChildren(...nodes){this.children=[...nodes];}
  setAttribute(key,value){this.attributes[key]=value;}
  add(option){this.children.push(option);}
}
function texts(node){return [node.textContent,...node.children.flatMap(texts)];}

test('isolated nested URL state refuses duplicates, unknown slots and extra URI layers',async()=>{
  const {state}=await instance();const raw=e.encodeNestedDetailState(state),slots=new URLSearchParams();slots.set('nested_request',raw);
  assert.deepEqual(nestedStateFromLocation({hash:`#${slots}`}).state,state);
  assert.equal(nestedStateFromLocation({hash:'#request=basic'}),null);
  for(const hash of [`#${slots}&nested_request=x`,`#${slots}&request=old`,`#${slots}&other=1`,`#nested_request=${encodeURIComponent(encodeURIComponent(raw))}`])assert.throws(()=>nestedStateFromLocation({hash}));
});

test('restore preserves complete ordered intent without executing and rejects changed principal',async()=>{
  const x=await instance();let posts=0;x.console.canonicalClient={queryNestedDetailText(){posts++;}};
  const raw=JSON.stringify(x.state);assert.equal(await x.console.restoreNestedState(raw),true);assert.equal(posts,0);assert.deepEqual(x.console.nestedState,x.state);
  assert.deepEqual(JSON.parse(x.nodes['[data-sac-request]'].value).query,e.toNestedDetailQuery(x.state.intent,x.context));
  const stale=structuredClone(x.state);stale.intent.binding.publication='other';const text=JSON.stringify(stale);
  assert.equal(await x.console.restoreNestedState(text),false);await x.console.run();assert.equal(posts,0);assert.equal(x.nodes['[data-sac-request]'].value,text);assert.match(x.messages.at(-1).message,/blocked/);
});

test('malformed state and late restore edits stay visible and blocked',async()=>{
  const x=await instance();assert.equal(await x.console.restoreNestedState('{"format":'),false);assert.equal(x.nodes['[data-sac-request]'].value,'{"format":');
  let release;x.console.freshNestedContext=()=>new Promise(resolve=>release=resolve);const pending=x.console.restoreNestedState(JSON.stringify(x.state));
  x.nodes['[data-sac-request]'].value='edited';x.console.onInput({target:{matches:s=>s==='[data-sac-request]'}});release(x.context);
  assert.equal(await pending,false);assert.equal(x.nodes['[data-sac-request]'].value,'edited');assert.equal(x.console.nestedState,null);
});

test('nested raw Run retains all original valid bytes and validates typed response before mapping',async()=>{
  const x=await instance(),raw=JSON.stringify(c.buildNestedDetailRequest('fp',{...x.query,timezone:'UTC'},{features:x.features,context:x.context.features && c.nestedDetailContext(x.features)}),null,3)+'\n';
  x.nodes['[data-sac-request]'].value=raw;x.console.state.rawDirty=true;const received=[];
  x.console.canonicalClient={async queryNestedDetailText(manifest,text,options){received.push({manifest,text,options});return x.result;}};
  await x.console.run();assert.equal(received.length,1);assert.equal(received[0].text,raw);assert.equal(received[0].manifest,x.manifest);assert.deepEqual(received[0].options.context,c.nestedDetailContext(x.features));
  assert.equal(x.console.nestedResult.columns[1].nestedFields[1].encoding,'decimal-string');assert.equal(x.console.nestedResult.rows[0]['opaque/amount'],'12.500000');assert.equal(x.console.nestedResult.metadata.canonical.completeChildren,true);
});

test('nested manual malformed, duplicate, numeric and unsupported request controls emit no POST',async()=>{
  for(const mutate of [raw=>raw.replace('"format_version": 1','"format_version": 1,"format_version": 1'),raw=>raw.replace('"limit": 25','"limit": 25e0'),raw=>raw.replace('"limit": 25','"limit": 25.0'),raw=>raw.replace('"select": [','"where": {}, "select": ['),raw=>raw.replace('"fp"','"other"'),()=>'{']) {
    const x=await instance();let posts=0;x.console.canonicalClient={queryNestedDetailText(){posts++;}};const raw=mutate(x.nodes['[data-sac-request]'].value);x.nodes['[data-sac-request]'].value=raw;x.console.state.rawDirty=true;
    await x.console.run();assert.equal(posts,0);assert.equal(x.nodes['[data-sac-request]'].value,raw);assert.equal(x.rendered.length+x.messages.length>0,true);
  }
});

test('fresh publication/revision drift and authentication failure retain draft with no POST',async()=>{
  for(const mutation of [f=>f.domain.publication='beta',f=>f.domain.fingerprint='other',f=>f.revision='old',()=>{throw new Error('401 unauthenticated');}]){
    const x=await instance(),raw=x.nodes['[data-sac-request]'].value;let posts=0;x.console.canonicalClient={queryNestedDetailText(){posts++;}};
    x.console.freshNestedContext=async()=>{const changed=structuredClone(x.context);mutation(changed.features);return changed;};await x.console.run();assert.equal(posts,0);assert.equal(x.nodes['[data-sac-request]'].value,raw);assert.deepEqual(x.console.nestedState,x.state);
  }
});

test('empty/malformed collections refuse whole response and never produce nested metadata',async()=>{
  const x=await instance(),bad=structuredClone(x.result);bad.data.rows[0][1]=null;x.console.canonicalClient={async queryNestedDetailText(){return bad;}};await x.console.run();assert.equal(x.console.nestedResult,null);assert.equal(x.rendered.at(-1).ok,false);
});

test('mode change blocks pending discovery POST and pending response render',async()=>{
  for(const phase of ['discovery','response']){
    const x=await instance();let release,posts=0;const rendered=x.rendered;
    if(phase==='discovery')x.console.freshNestedContext=()=>new Promise(resolve=>release=resolve);
    x.console.canonicalClient={queryNestedDetailText(){posts++;return phase==='response'?new Promise(resolve=>release=resolve):x.result;}};
    const run=x.console.run();await Promise.resolve();await x.console.selectQueryProfile('flat');release(phase==='discovery'?x.context:x.result);await run;
    assert.equal(posts,phase==='discovery'?0:1);assert.equal(rendered.length,0);assert.equal(x.console.nestedResult,null);assert.equal(x.console.queryProfile,'flat');
  }
});

test('basic/root/nested drafts remain independent across explicit mode switches',async()=>{
  const x=await instance(),nested=x.nodes['[data-sac-request]'].value;
  x.console.profileDrafts.flat={raw:'basic exact',rawDirty:true,state:{...x.console.state,selectedFields:[{id:'legacy',field:'id'}]}};
  x.console.profileDrafts.root={raw:'root exact',rawDirty:true};await x.console.selectQueryProfile('flat');assert.equal(x.nodes['[data-sac-request]'].value,'basic exact');assert.equal(x.console.state.selectedFields[0].id,'legacy');
  await x.console.selectQueryProfile('root');assert.equal(x.nodes['[data-sac-request]'].value,'root exact');await x.console.selectQueryProfile('nested');assert.equal(x.nodes['[data-sac-request]'].value,nested);assert.deepEqual(x.console.nestedState,x.state);
});

test('save/private uses isolated storage, removes share payload and never executes',async()=>{
  const x=await instance(),saved=new Map(),urls=[];const before={location:global.location,localStorage:global.localStorage,history:global.history};
  global.location={href:'https://app.test/console?api=%2Fapi%2Fpilot#nested_request=old'};global.localStorage={setItem:(k,v)=>saved.set(k,v),getItem:k=>saved.get(k)};global.history={state:{unrelated:1},replaceState:(state,title,url)=>urls.push({state,url})};
  try{await x.console.nestedStateAction('save');assert.equal(saved.size,1);assert.ok(saved.has('selecto.console.nested-state:/api/pilot'));assert.equal(new URL(urls[0].url).hash,'');let posts=0;x.console.canonicalClient={queryNestedDetailText(){posts++;}};await x.console.nestedStateAction('private');assert.equal(posts,0);assert.deepEqual(x.console.nestedState,x.state);
    x.nodes['[data-sac-request]'].value+=' ';await x.console.nestedStateAction('save');assert.match(x.messages.at(-1).message,/differ/);
  }finally{Object.assign(global,before);}
});

test('share64KiB cap does not reduce the execution1MiB bound',async()=>{
  const x=await instance();x.state.intent.filters=Array.from({length:20},(_,i)=>({id:`f${i}`,field:'opaque/note',op:'eq',value:'x'.repeat(16384)}));x.console.syncNestedRequest();let posts=0;x.console.canonicalClient={async queryNestedDetailText(){posts++;return x.result;}};await x.console.run();assert.equal(posts,1);assert.throws(()=>e.encodeNestedDetailState(x.state));
});

test('root/child reorder, stable filters and empty selection are retained rather than repaired',async()=>{
  const x=await instance();x.console.nestedAction({dataset:{sacNestedAction:'up',index:'1',group:'select'}});assert.ok(Array.isArray(x.state.intent.select[0]));x.console.nestedAction({dataset:{sacNestedAction:'down',index:'0',group:'children'}});assert.equal(x.state.intent.select[0][0],'kid/lines.price');
  x.console.nestedAction({dataset:{sacNestedAction:'add-filter',index:'0',group:'filters'}});x.console.nestedAction({dataset:{sacNestedAction:'add-filter',index:'0',group:'filters'}});assert.notEqual(x.state.intent.filters[0].id,x.state.intent.filters[1].id);
  x.state.intent.select[0]=[];x.console.nestedChanged(()=>{});assert.deepEqual(x.state.intent.select[0],[]);assert.equal(x.nodes['[data-sac-run]'].disabled,true);let posts=0;x.console.canonicalClient={queryNestedDetailText(){posts++;}};await x.console.run();assert.equal(posts,0);
});

test('complete typed nested tables use exact DOM text, empty children and zero-parent schema headers',async()=>{
  const x=await instance(),before=global.document;global.document={createElement:tag=>new FakeNode(tag)};
  try{const result=e.toNestedDetailExplorerResult(x.result,x.state.intent,x.context),head=new FakeNode('thead'),body=new FakeNode('tbody');x.console.renderNestedResponse(result,head,body);
    assert.ok(texts(head).includes('lines.price'));for(const value of ['12.500000','0.100000','9007199254740993','0001-01-01','9999-12-31','NULL','false','<b>\u2028&😀','No children',''])assert.ok(texts(body).includes(value),value);
    const empty={...result,rows:[]};head.replaceChildren();body.replaceChildren();x.console.renderNestedResponse(empty,head,body);assert.ok(texts(head).includes('lines.note'));assert.ok(texts(body).includes('No rows'));
  }finally{global.document=before;}
});

test('new draft does not reuse stale state, and mounted domain binding cannot change through restore',async()=>{
  const x=await instance();x.state.intent.binding.publication='stale';x.console.nestedBlocked=true;
  x.console.profileDrafts.nested={raw:'stale text',rawDirty:true};await x.console.selectQueryProfile('nested',true);
  assert.equal(x.console.nestedState.intent.binding.publication,'pub/alpha');assert.equal(x.console.nestedBlocked,false);
  x.console.freshNestedContext=APIConsole.prototype.freshNestedContext;
  let gets=0;x.console.explorerClient={getNestedDetailContext(){gets++;return x.context;}};
  const other=structuredClone(x.state);other.intent.binding.domain_id='other';assert.equal(await x.console.restoreNestedState(JSON.stringify(other)),false);assert.equal(gets,0);
});

test('private/save discovery race, raw paging and cancellation preserve edited state',async()=>{
  const x=await instance();let release;x.console.freshNestedContext=()=>new Promise(resolve=>release=resolve);
  const pending=x.console.nestedStateAction('save');x.nodes['[data-sac-nested-state]'].value+=' ';release(x.context);await pending;assert.match(x.messages.at(-1).message,/changed during discovery/);
  x.console.state.rawDirty=true;const offset=x.state.intent.offset;x.console.nestedAction({dataset:{sacNestedAction:'next',index:'0',group:'page'}});assert.equal(x.state.intent.offset,offset);assert.match(x.messages.at(-1).message,/manual JSON/);
});

test('visible nested builder uses only opaque descriptor IDs and retains selected child order',async()=>{
  const x=await instance(),before={document:global.document,Option:global.Option};
  global.document={createElement:tag=>new FakeNode(tag)};global.Option=function(text,value,_default,selected){const option=new FakeNode('option');option.textContent=text;option.value=value;option.selected=selected;return option;};
  const panel=new FakeNode('section');const select=x.console.root.querySelector;x.console.root.querySelector=selector=>selector==='[data-sac-nested-builder]'?panel:select(selector);x.console.renderNestedBuilder=APIConsole.prototype.renderNestedBuilder;
  try{x.console.renderNestedBuilder();const all=[];function walk(n){all.push(n);n.children.forEach(walk);}walk(panel);const controls=all.filter(n=>n.dataset.sacNestedControl);assert.ok(controls.some(n=>n.dataset.sacNestedControl==='add-root'));assert.ok(controls.some(n=>n.dataset.sacNestedControl==='add-child'));assert.ok(texts(panel).includes('Complete nested Detail'));assert.deepEqual(x.state.intent.select[1],['kid/lines.id','kid/lines.price','kid/lines.serial','kid/lines.due','kid/lines.note','kid/lines.enabled']);
    x.console.nestedBlocked=true;x.console.renderNestedBuilder();assert.ok(texts(panel).includes('Start new nested draft'));
  }finally{Object.assign(global,before);}
});

test('retained stale draft exposes explicit New draft and refreshes only after its actual click',async()=>{
  const x=await instance(),before={document:global.document,Option:global.Option};
  global.document={createElement:tag=>new FakeNode(tag)};global.Option=function(text,value,_default,selected){const option=new FakeNode('option');option.textContent=text;option.value=value;option.selected=selected;return option;};
  const panel=new FakeNode('section'),select=x.console.root.querySelector;
  x.console.root.querySelector=selector=>selector==='[data-sac-nested-builder]'?panel:select(selector);
  x.console.renderNestedBuilder=APIConsole.prototype.renderNestedBuilder;
  const calls=[],fetch=async(path,init={})=>{calls.push({path,method:init.method||'GET'});if(path==='/api/v1/selecto/catalog')return Response.json({format:'selecto.domain-catalog',format_version:1,domains:[x.entry]});if(path===x.entry.manifest)return Response.json(x.manifest);if(path==='/api/pilot/domain')return Response.json(x.canonicalDomain);if(path==='/api/pilot/nested')return Response.json(x.features);throw new Error(path);};
  x.console.explorerClient=e.createExplorerClient({fetch});x.console.freshNestedContext=APIConsole.prototype.freshNestedContext;
  try{
    // The draft stays as authored; only the independently served current
    // publication changes, as on a principal/publication transition.
    x.entry.publication='pub/new';x.manifest.domain.publication='pub/new';x.features.domain.publication='pub/new';
    const retained=x.nodes['[data-sac-nested-state]'].value;
    x.console.renderNestedBuilder();const all=[];function walk(n){all.push(n);n.children.forEach(walk);}walk(panel);
    const button=all.find(n=>Object.hasOwn(n.dataset,'sacNestedNew'));
    assert.ok(button,'existing retained draft must expose a real New draft control');
    assert.equal(calls.length,0);assert.equal(x.nodes['[data-sac-nested-state]'].value,retained);
    await x.console.onClick({target:{closest:selector=>selector==='[data-sac-nested-new]'?button:null}});
    assert.deepEqual(calls.map(v=>v.path),['/api/v1/selecto/catalog',x.entry.manifest,'/api/pilot/domain','/api/pilot/nested']);
    assert.ok(calls.every(v=>v.method==='GET'));assert.equal(x.console.nestedBlocked,false);
    assert.equal(x.console.nestedState.intent.binding.publication,x.features.domain.publication);
    assert.notEqual(x.nodes['[data-sac-nested-state]'].value,retained);
    assert.equal(x.console.profileDrafts.nested,undefined);
  }finally{Object.assign(global,before);}
});

test('explicit New draft retains a blocked state when fresh discovery is refused and never posts',async()=>{
  const x=await instance();let discoveries=0,posts=0;
  x.console.freshNestedContext=async()=>{discoveries++;throw new Error('Current publication unavailable');};
  x.console.canonicalClient={queryNestedDetailText(){posts++;}};
  x.console.nestedBlocked=true;
  await x.console.onClick({target:{closest:selector=>selector==='[data-sac-nested-new]'?{}:null}});
  assert.equal(discoveries,1);assert.equal(posts,0);assert.equal(x.console.nestedState,null);assert.equal(x.console.nestedBlocked,true);
  assert.match(x.messages.at(-1).message,/Current publication unavailable/);
});

test('selected transport refreshes all discovery and sends original raw body with exact context header',async()=>{
  const x=await instance(),calls=[];const fetch=async(path,init={})=>{
    calls.push({path,init});if(path==='/api/v1/selecto/catalog')return Response.json({format:'selecto.domain-catalog',format_version:1,domains:[x.entry]});
    if(path===x.entry.manifest)return Response.json(x.manifest);if(path==='/api/pilot/domain')return Response.json(x.canonicalDomain);if(path==='/api/pilot/nested')return Response.json(x.features);if(path==='/api/pilot/query')return Response.json(x.result);throw new Error(path);
  };
  x.console.explorerClient=e.createExplorerClient({fetch});x.console.canonicalClient=c.createCanonicalClient({fetch});x.console.freshNestedContext=APIConsole.prototype.freshNestedContext;
  const raw=x.nodes['[data-sac-request]'].value+'\n';x.nodes['[data-sac-request]'].value=raw;x.console.state.rawDirty=true;await x.console.run();
  assert.deepEqual(calls.slice(0,4).map(v=>v.path),['/api/v1/selecto/catalog',x.entry.manifest,'/api/pilot/domain','/api/pilot/nested']);
  const posts=calls.filter(v=>v.init.method==='POST');assert.equal(posts.length,1);assert.equal(posts[0].init.body,raw);assert.equal(new Headers(posts[0].init.headers).get('Selecto-Nested-Detail-Context'),c.encodeNestedDetailContext(c.nestedDetailContext(x.features)));assert.equal(x.console.nestedResult.metadata.canonical.profile,'canonical_nested_detail.v1');
});

test('actual selected JSON token validation refuses an integral-looking exponent response',async()=>{
  const x=await instance();x.console.canonicalClient=c.createCanonicalClient({fetch:async()=>new Response(JSON.stringify(x.result).replace('"rows":[[1,','"rows":[[1e0,'),{headers:{'content-type':'application/json'}})});
  await x.console.run();assert.equal(x.console.nestedResult,null);assert.equal(x.rendered.at(-1).ok,false);assert.match(x.rendered.at(-1).error.message,/invalid nested integer/);
});

test('first browser manual presentation requires explicit UTC and retains unsupported text without POST',async()=>{
  for(const timezone of ['America/New_York',null]){
    const x=await instance();const body=JSON.parse(x.nodes['[data-sac-request]'].value);if(timezone===null)delete body.query.timezone;else body.query.timezone=timezone;
    const raw=JSON.stringify(body,null,3);x.nodes['[data-sac-request]'].value=raw;x.console.state.rawDirty=true;let posts=0;x.console.canonicalClient={queryNestedDetailText(){posts++;}};await x.console.run();assert.equal(posts,0);assert.equal(x.nodes['[data-sac-request]'].value,raw);assert.match(x.rendered.at(-1).error.message,/explicit timezone UTC/);
  }
});

test('valid raw requests retain bytes and map omitted paging with published defaults',async()=>{
  for(const omitted of [['limit'],['offset'],['limit','offset']]){
    const x=await instance(),request=JSON.parse(x.nodes['[data-sac-request]'].value);
    for(const key of omitted)delete request.query[key];
    const raw=JSON.stringify(request,null,3)+'\n';x.nodes['[data-sac-request]'].value=raw;x.console.state.rawDirty=true;
    const sent=[];x.console.canonicalClient={async queryNestedDetailText(_manifest,text){sent.push(text);return x.result;}};
    await x.console.run();assert.deepEqual(sent,[raw]);assert.equal(x.nodes['[data-sac-request]'].value,raw);assert.equal(x.console.nestedResult.metadata.canonical.completeChildren,true);
    assert.equal(x.console.nestedResult.page.size,x.features.defaults.limit);
    assert.equal(x.console.nestedResult.page.number,1);
  }
});

test('edited nested state remains visible and blocks Run until explicit successful restore or new draft',async()=>{
  for(const raw of ['{"format":"unknown"}','{',JSON.stringify((await instance()).state)]){
    const x=await instance();let posts=0;x.console.canonicalClient={async queryNestedDetailText(_manifest,text){
      posts++;const result=structuredClone(x.result),query=JSON.parse(text).query;
      if(query.select.length===2&&query.select[1].length===1){
        result.data.columns=result.data.columns.slice(0,2);result.data.rows=result.data.rows.map(row=>[row[0],row[1].map(child=>[child[0]])]);result.data.subtables.lines.columns=['lines.id'];
      }
      return result;
    }};
    x.nodes['[data-sac-nested-state]'].value=raw;x.console.onInput({target:{matches:s=>s==='[data-sac-nested-state]'}});
    assert.equal(x.console.nestedBlocked,true);assert.equal(x.nodes['[data-sac-run]'].disabled,true);
    await x.console.run();assert.equal(posts,0);assert.equal(x.nodes['[data-sac-nested-state]'].value,raw);assert.equal(x.console.nestedResult,null);assert.equal(x.nodes['[data-sac-run]'].disabled,true);
    if(raw.startsWith('{"format":"selecto.nested-detail-state"'))assert.equal(await x.console.restoreNestedState(raw),true);
    else await x.console.selectQueryProfile('nested',true);
    await x.console.run();assert.equal(posts,1);assert.ok(x.console.nestedResult);assert.equal(x.console.nestedBlocked,false);
  }
});

test('state edits cancel pending discovery and prevent a late response from replacing edited state',async()=>{
  for(const phase of ['discovery','response']){
    const x=await instance();let release,posts=0;
    if(phase==='discovery')x.console.freshNestedContext=()=>new Promise(resolve=>release=resolve);
    x.console.canonicalClient={queryNestedDetailText(){posts++;return phase==='response'?new Promise(resolve=>release=resolve):x.result;}};
    const pending=x.console.run();await Promise.resolve();const signal=x.console.queryController.signal;
    const raw='{"format":"unknown"}';x.nodes['[data-sac-nested-state]'].value=raw;x.console.onInput({target:{matches:s=>s==='[data-sac-nested-state]'}});
    assert.equal(signal.aborted,true);release(phase==='discovery'?x.context:x.result);await pending;
    assert.equal(posts,phase==='discovery'?0:1);assert.equal(x.rendered.length,0);assert.equal(x.console.nestedResult,null);assert.equal(x.nodes['[data-sac-nested-state]'].value,raw);assert.equal(x.nodes['[data-sac-run]'].disabled,true);
    await x.console.run();assert.equal(posts,phase==='discovery'?0:1);
  }
});

for(const [action,initialOffset,expectedOffset] of [['next',0,2],['previous',2,0]]){
  test(`rendered nested paging click ${action} performs one fresh validated dispatch at the changed offset`,async()=>{
    const x=await instance(),calls=[];x.state.intent.limit=2;x.state.intent.offset=initialOffset;x.console.syncNestedRequest();
    x.console.nestedResult={metadata:{canonical:{hasMore:true}}};
    const fetch=async(path,init={})=>{
      calls.push({path,method:init.method||'GET',body:init.body});
      if(path==='/api/v1/selecto/catalog')return Response.json({format:'selecto.domain-catalog',format_version:1,domains:[x.entry]});
      if(path===x.entry.manifest)return Response.json(x.manifest);
      if(path==='/api/pilot/domain')return Response.json(x.canonicalDomain);
      if(path==='/api/pilot/nested')return Response.json(x.features);
      if(path==='/api/pilot/query'){
        const query=JSON.parse(init.body).query,result=structuredClone(x.result);
        result.data.page={limit:query.limit,offset:query.offset,has_more:query.offset===0};return Response.json(result);
      }
      throw new Error(path);
    };
    x.console.explorerClient=e.createExplorerClient({fetch});x.console.canonicalClient=c.createCanonicalClient({fetch});x.console.freshNestedContext=APIConsole.prototype.freshNestedContext;
    await x.console.onClick({target:{closest:selector=>selector==='[data-sac-nested-action]'?{dataset:{sacNestedAction:action,index:'0',group:'page'}}:null}});
    const posts=calls.filter(call=>call.method==='POST');
    if(process.env.NESTED_PAGING_CONTROL_OUTPUT){const fs=require('node:fs');fs.mkdirSync(process.env.NESTED_PAGING_CONTROL_OUTPUT,{recursive:true});fs.writeFileSync(`${process.env.NESTED_PAGING_CONTROL_OUTPUT}/${action}.json`,JSON.stringify({scope:'source-only controlled fetch dispatch; no native/browser admission',action,initialOffset,actualOffset:x.state.intent.offset,calls,posts:posts.length,resultPresent:Boolean(x.console.nestedResult)},null,2)+'\n');}
    assert.equal(x.state.intent.offset,expectedOffset);assert.equal(posts.length,1);
    assert.deepEqual(calls.slice(0,4).map(v=>v.path),['/api/v1/selecto/catalog',x.entry.manifest,'/api/pilot/domain','/api/pilot/nested']);
    assert.equal(JSON.parse(posts[0].body).query.offset,expectedOffset);assert.equal(JSON.parse(posts[0].body).query.limit,2);
    assert.equal(x.console.nestedResult.page.number,expectedOffset/2+1);
  });
}

test('paging refuses unresolved/manual/boundary drafts and refreshes drift/auth before any POST',async()=>{
  for(const scenario of ['blocked','missing','manual','no-more','over-offset','first-page','drift','auth']){
    const x=await instance();let posts=0;const before=x.nodes['[data-sac-request]'].value;
    x.console.canonicalClient={async queryNestedDetailText(){posts++;return x.result;}};
    x.console.nestedResult={metadata:{canonical:{hasMore:true}}};
    if(scenario==='blocked')x.console.nestedBlocked=true;
    if(scenario==='missing')x.console.nestedState=null;
    if(scenario==='manual'){x.nodes['[data-sac-request]'].value=before+' ';x.console.state.rawDirty=true;}
    if(scenario==='no-more')x.console.nestedResult.metadata.canonical.hasMore=false;
    if(scenario==='over-offset')x.state.intent.offset=100000;
    if(scenario==='drift')x.console.freshNestedContext=async()=>{const changed=structuredClone(x.context);changed.features.domain.publication='different';return changed;};
    if(scenario==='auth')x.console.freshNestedContext=async()=>{throw new Error('401 unauthenticated');};
    const offset=x.state.intent.offset;
    await x.console.nestedAction({dataset:{sacNestedAction:scenario==='first-page'?'previous':'next',index:'0',group:'page'}});
    assert.equal(posts,0,scenario);
    if(!['drift','auth'].includes(scenario))assert.equal(x.state.intent.offset,offset,scenario);
    if(scenario==='manual')assert.equal(x.nodes['[data-sac-request]'].value,before+' ');
    if(['drift','auth'].includes(scenario)){assert.equal(x.state.intent.binding.publication,'pub/alpha');assert.equal(x.console.nestedResult,null);assert.match(x.rendered.at(-1).error.message,scenario==='drift'?/publication or revision changed/:/401/);}
  }
});

test('paging cancels an older response and retains only the fresh page render',async()=>{
  const x=await instance();x.state.intent.limit=2;x.console.syncNestedRequest();let releaseA;const sent=[];
  x.console.canonicalClient={queryNestedDetailText(_manifest,text,options){const query=JSON.parse(text).query;sent.push({query,signal:options.signal});const result=structuredClone(x.result);result.data.page={limit:query.limit,offset:query.offset,has_more:query.offset===0};return sent.length===1?new Promise(resolve=>releaseA=()=>resolve(result)):Promise.resolve(result);}};
  const a=x.console.run();while(!releaseA)await Promise.resolve();
  x.console.nestedResult={metadata:{canonical:{hasMore:true}}};
  await x.console.nestedAction({dataset:{sacNestedAction:'next',index:'0',group:'page'}});
  assert.equal(sent.length,2);assert.equal(sent[0].signal.aborted,true);assert.equal(sent[1].query.offset,2);assert.equal(x.console.nestedResult.page.number,2);
  const rendered=x.rendered.length;releaseA();await a;assert.equal(x.rendered.length,rendered);assert.equal(x.console.nestedResult.page.number,2);
});
