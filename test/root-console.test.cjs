const test = require("node:test");
const assert = require("node:assert/strict");
const {APIConsole,normalizeAPIBase,requestPayloadFromLocation} = require("../dist/selecto-api-console.js");

async function instance() {
  const {fixture}=await import("./root-fixture.mjs");const data=fixture();
  const console=new APIConsole({dataset:{apiBase:"/api/items"}});
  data.context.manifest=data.manifest; console.remoteMode=true; console.manifest=data.manifest; console.rootPredicateContext=data.context;
  const nodes={"[data-sac-request]":{value:""},"[data-sac-root-state]":{value:""},"[data-sac-root-mode]":{value:"flat"},"[data-sac-edited]":{hidden:true},".sac-builder":{hidden:false},"[data-sac-run]":{disabled:false,classList:{add(){},remove(){}}},"[data-sac-run-label]":{textContent:"Run query"},"[data-sac-cancel-query]":{hidden:true}};
  console.root.querySelector=selector=>nodes[selector];const messages=[],rendered=[];console.setImportMessage=(text,kind)=>messages.push({text,kind});console.setStatus=()=>{};console.updateCurl=()=>{};console.renderResponse=payload=>rendered.push(payload);console.showLocalError=text=>messages.push({text,kind:"error"});
  console.freshRootContext=async()=>data.context;
  return {console,nodes,messages,rendered,...data};
}

test("Console root handoff preserves complete bound tree and makes flat chooser visibly unavailable",async()=>{
  const {console,nodes,state,context}=await instance();const raw=JSON.stringify(state);
  assert.deepEqual(requestPayloadFromLocation({hash:`#request=${encodeURIComponent(raw)}`}),state);
  assert.equal(await console.restoreRootState(raw),true);assert.equal(nodes[".sac-builder"].hidden,true);
  const parsed=JSON.parse(nodes["[data-sac-request]"].value);assert.equal(parsed.format_version,2);assert.deepEqual(parsed.query.where,globalThis.SelectoExplorerClient.toRootPredicateQuery(state.intent,context).where);
  assert.equal(nodes["[data-sac-root-state]"].value,raw);assert.equal(nodes["[data-sac-root-mode]"].value,"root");
  const before=nodes["[data-sac-request]"].value;assert.equal(console.loadRequestIntoChooser(),false);assert.equal(nodes["[data-sac-request]"].value,before);
});

test("Console invalid state/raw text remains visible and never emits default or normalized query",async()=>{
  const {console,nodes,state,messages}=await instance();const changed=structuredClone(state);changed.intent.binding.publication="other";
  const raw=JSON.stringify(changed);assert.equal(await console.restoreRootState(raw),false);assert.equal(nodes["[data-sac-request]"].value,raw);assert.ok(messages.at(-1).text.includes("blocked"));
  let posts=0;console.canonicalClient={queryText(){posts++;},queryRootPredicate(){posts++;}};
  await console.run();assert.equal(posts,0);assert.equal(nodes["[data-sac-request]"].value,raw);
  nodes["[data-sac-request]"].value='{"format_version":2,"format_version":1}';await console.run();assert.equal(posts,0);
});

test("Console v2 raw editor transports original text after fresh context without a chooser roundtrip",async()=>{
  const {console,nodes,features,manifest}=await instance();const query={select:["id"],where:{or:[{field:"id",op:"eq",value:"2"}]},limit:2,offset:0};
  const raw=JSON.stringify(globalThis.SelectoCanonicalClient.buildRootPredicateRequest("fp",query,{features}),null,3);nodes["[data-sac-request]"].value=raw;
  const received=[];console.canonicalClient={async queryText(m,text,options){received.push({m,text,options});return {ok:true,data:{rows:[[2]]}};}};
  await console.run();assert.equal(received.length,1);assert.equal(received[0].text,raw);assert.equal(received[0].m,manifest);assert.equal(received[0].options.features,features);
});

test("Console blocks saved scope after fresh tenant switch and retains the original state",async()=>{
  const {console,nodes,state,context}=await instance();await console.restoreRootState(JSON.stringify(state));const raw=nodes["[data-sac-request]"].value;
  const changed=structuredClone(context);changed.features.domain.publication="scope-B";changed.domain.publication="scope-B";console.freshRootContext=async()=>changed;
  let posts=0;console.canonicalClient={queryText(){posts++;}};await console.run();assert.equal(posts,0);assert.equal(nodes["[data-sac-request]"].value,raw);assert.deepEqual(console.rootState,state);
});

test("Console rejects recursively encoded traversal at its entry point",()=>{
  for(const value of ["/api/%252e%252e/private","/api/%252fprivate","/api/%255cprivate"])assert.throws(()=>normalizeAPIBase(value));
});

test("standalone classic bundle exposes the same public root functions as installed ESM sources",async()=>{
  const canonical=await import("../packages/canonical-client/dist/index.js");
  const explorer=await import("../packages/explorer-client/dist/index.js");
  for(const [module,browser] of [[canonical,globalThis.SelectoCanonicalClient],[explorer,globalThis.SelectoExplorerClient]]) {
    assert.deepEqual(Object.keys(browser).sort(),Object.keys(module).sort());
    for(const name of Object.keys(module))assert.equal(typeof browser[name],typeof module[name]);
  }
});

test("Console measures the original encoded root URL component, not only decoded JSON length",async()=>{
  const {state}=await instance();state.intent.predicate={kind:"tree",tree:{field:"title",op:"eq",value:'"'.repeat(16384)}};
  const raw=JSON.stringify(state),encoded=encodeURIComponent(raw);assert.ok(raw.length<65536);assert.ok(encoded.length>65536);
  assert.throws(()=>requestPayloadFromLocation({hash:`#request=${encoded}`}),/encoded state exceeds 64KiB/);
});

test("Console refuses Save/Copy when raw query or state diverges from the restored full intent",async()=>{
  const {console,nodes,state,messages}=await instance();await console.restoreRootState(JSON.stringify(state));
  nodes["[data-sac-request]"].value=nodes["[data-sac-request]"].value.replace('"limit": 2','"limit": 1');await console.rootStateAction("link");
  assert.match(messages.at(-1).text,/State and query editor differ/);
  nodes["[data-sac-request]"].value=console.rootStateRequestText;
  const changed=structuredClone(state);changed.intent.offset=2;nodes["[data-sac-root-state]"].value=JSON.stringify(changed);await console.rootStateAction("save");
  assert.match(messages.at(-1).text,/State and query editor differ/);
  assert.deepEqual(console.rootState,state);
});

test("a late Console restore cannot overwrite a subsequent raw editor or state edit",async()=>{
  for(const selector of ["[data-sac-request]","[data-sac-root-state]"]) {
    const {console,nodes,state,context}=await instance();let release;
    console.freshRootContext=()=>new Promise(resolve=>release=resolve);
    const pending=console.restoreRootState(JSON.stringify(state));
    const edited=JSON.stringify({...state,intent:{...state.intent,offset:1}});
    nodes[selector].value=edited;
    console.onInput({target:{matches:value=>value===selector}});
    release(context);assert.equal(await pending,false);
    assert.equal(nodes[selector].value,edited);assert.equal(console.rootState,null);
    if(selector==="[data-sac-request]") {
      console.freshRootContext=async()=>context;const emitted=[];
      console.canonicalClient={async queryRootPredicate(_manifest,query){emitted.push(query);return {ok:true,data:{rows:[]}};}};
      await console.run();assert.equal(emitted.length,1);assert.equal(emitted[0].offset,1);
    }
  }
});
