import test from "node:test";
import assert from "node:assert/strict";
import {fixture,objects} from "../../canonical-client/test/nested-fixture.mjs";
import * as e from "../dist/index.js";
import * as c from "@selecto/canonical-client";
function context() {const f=fixture();return {...f,...f.trusted,binding:e.nestedDetailBinding(f.features)};}
function fullIntent(x) {const i=e.createNestedDetailIntent(x.features);i.select=x.query.select.map(s=>Array.isArray(s)?s.map(p=>x.features.collections[0].fields.find(f=>f.path===p).id):x.features.root_fields.find(f=>f.path===s).id);return i;}
function thrown(call) {try{call();}catch(error){return error;}assert.fail("expected a refusal");}

test("nested refusal reasons follow actual validation origin and preserve precise field/context branches",()=>{
  const x=context(),i=fullIntent(x),state=intent=>JSON.stringify({format:"selecto.nested-detail-state",format_version:1,intent});
  for(const key of ["where","child_order_by","formatter"]){
    const bad={...i,[key]:{}};
    assert.equal(c.nestedDetailRefusal(thrown(()=>e.assertNestedDetailIntent(bad,x))).reason,"closed-intent-violation");
    assert.equal(c.nestedDetailRefusal(thrown(()=>e.decodeNestedDetailState(state(bad),x))).reason,"closed-intent-violation");
  }
  const extra={...i,extra:true};
  assert.equal(c.nestedDetailRefusal(thrown(()=>e.assertNestedDetailIntent(extra,x))).reason,"invalid-nested-intent");
  assert.equal(c.nestedDetailRefusal(thrown(()=>e.decodeNestedDetailState(state(extra),x))).reason,"invalid-nested-state");
  const invalid=structuredClone(i);invalid.filters=[{id:"typed",field:"opaque/amount",op:"eq",value:"not decimal"}];
  assert.equal(c.nestedDetailRefusal(thrown(()=>e.assertNestedDetailIntent(invalid,x))).reason,"invalid-nested-intent");
  assert.equal(c.nestedDetailRefusal(thrown(()=>e.assertNestedDetailIntent(invalid,x,{origin:"state"}))).reason,"invalid-nested-state");
  for(const [change,reason,code] of [[z=>z.binding.publication="old","stale-nested-context","stale_nested_detail_context"],[z=>z.collection_id="unknown","unpublished-field-id","invalid_field"],[z=>z.select[0]="unknown","unpublished-field-id","invalid_field"]]){
    const bad=structuredClone(i);change(bad);const error=thrown(()=>e.decodeNestedDetailState(state(bad),x));
    assert.equal(c.nestedDetailRefusal(error).reason,reason);assert.equal(error.code,code);assert.ok(error instanceof e.ExplorerIntentError);
  }
  assert.equal(c.nestedDetailRefusal(thrown(()=>e.assertNestedDetailIntent(i,{}))).reason,"nested-unavailable");
});

test("state byte caps are typed at the actual size branch without replacing syntax/Unicode errors",()=>{
  for(const raw of ["{",'\ufeff{}','{"x":"\\ud800"}',"x".repeat(65537),"é".repeat(32769)]){
    const original=thrown(()=>c.parseStrictJSON(raw,{tokens:true,maxBytes:65536})),error=thrown(()=>e.parseNestedDetailState(raw));
    assert.equal(error.constructor,original.constructor);assert.equal(error.code,original.code);assert.equal(error.message,original.message);
    assert.equal(c.nestedDetailRefusal(error).reason,original.validationReason==="utf8-byte-limit"?"state-limit":"invalid-nested-state");
  }
  const unicodeBeforeSize="\ud800"+"x".repeat(65537);
  assert.equal(c.nestedDetailRefusal(thrown(()=>e.parseNestedDetailState(unicodeBeforeSize))).reason,"invalid-nested-state");
  assert.equal(c.nestedDetailRefusal(thrown(()=>e.decodeNestedDetailState("%"))).reason,"invalid-nested-state");
  assert.equal(c.nestedDetailRefusal(thrown(()=>e.decodeNestedDetailState("x".repeat(65537)))).reason,"state-limit");
});

test("nested discovery tags actual authentication and invalid capability failures without classifying transport failures",async()=>{
  const x=context();let mode="auth";
  const fetch=async(path)=>{
    if(mode==="network")throw new TypeError("authentication required in arbitrary transport text");
    if(mode==="auth")return Response.json({ok:false,error:{code:"authentication_required",message:"Authentication required.",details:{}}},{status:401});
    if(path==="/api/v1/selecto/catalog")return Response.json({format:"selecto.domain-catalog",format_version:1,domains:[x.entry]});
    if(path==="/api/pilot/manifest")return Response.json(x.manifest);
    if(path==="/api/pilot/domain")return Response.json(x.canonicalDomain);
    const bad=structuredClone(x.features);bad.supports.child_filtering=true;return Response.json(bad);
  };
  const client=e.createExplorerClient({fetch});
  await assert.rejects(client.getNestedDetailContext("pilot"),error=>error instanceof c.CanonicalHttpError&&error.status===401&&c.nestedDetailRefusal(error).reason==="authentication-required");
  mode="network";await assert.rejects(client.getNestedDetailContext("pilot"),error=>error instanceof TypeError&&c.nestedDetailRefusal(error)===null);
  mode="sidecar";await assert.rejects(client.getNestedDetailContext("pilot"),error=>error instanceof c.CanonicalWireError&&c.nestedDetailRefusal(error).reason==="nested-unavailable");
});

test("nested opaque selection and root text filters translate completely with no prefix assumptions",()=>{
  const x=context(),i=fullIntent(x);i.filters=[{id:"stable/1",field:"opaque/serial",op:"eq",value:"9007199254740993"},{id:"stable/2",field:"opaque/note",op:"is_null"}];i.order_by=[{field:"opaque/id",direction:"desc"}];const q=e.toNestedDetailQuery(i,x);assert.deepEqual(q.select,x.query.select);assert.equal(q.filters[0].value,"9007199254740993");assert.equal(q.filters[0].field,"serial");assert.deepEqual(q.filters[1],{field:"note",op:"is_null"});
  for(const change of [z=>z.extra=true,z=>z.collection_id="lines",z=>z.select[0]="id",z=>z.select[1]=[],z=>z.filters[0].field="kid/lines.id",z=>z.filters[0].value=1,z=>z.filters.push(z.filters[0]),z=>z.binding.feature_revision="old",z=>z.binding.publication="beta",z=>z.presentation.locale="fr-FR"]){const bad=structuredClone(i);change(bad);assert.throws(()=>e.toNestedDetailQuery(bad,x));}
});

test("typed mapping retains root and child codecs/nullability, complete metadata and empty headers",()=>{
  const x=context(),i=fullIntent(x);const mapped=e.toNestedDetailExplorerResult(x.result,i,x);assert.equal(mapped.metadata.canonical.profile,"canonical_nested_detail.v1");assert.deepEqual(mapped.metadata.canonical.nestedContext,x.context);const child=mapped.columns[1];assert.equal(child.type,"nested");assert.equal(child.complete,true);assert.equal(child.nestedFields[1].encoding,"decimal-string");assert.equal(child.nestedFields[4].nullable,true);assert.equal(mapped.rows[0][child.id][0]["kid/lines.serial"],"9007199254740993");assert.equal(mapped.rows[1][child.id].length,0);assert.equal(mapped.rows[0]["opaque/amount"],"12.500000");
  const empty=structuredClone(x.result);empty.data.rows=[];empty.data.row_count=0;assert.equal(e.toNestedDetailExplorerResult(empty,i,x).columns[1].nestedFields.length,6);
  const obj=objects(x.result);i.row_format="objects";assert.deepEqual(e.toNestedDetailExplorerResult(obj,i,x).rows,mapped.rows);
  obj.data.rows[0].lines=null;assert.throws(()=>e.toNestedDetailExplorerResult(obj,i,x));
});

test("isolated strict snapshot preserves all state, URI tokens and Console query while refusing drift",()=>{
  const x=context(),i=fullIntent(x);i.select.reverse();i.filters=[{id:"text-id",field:"opaque/note",op:"eq",value:"😀&+%/"}];i.limit=2;i.offset=2;i.order_by=[{field:"opaque/id",direction:"desc"}];const s={format:"selecto.nested-detail-state",format_version:1,intent:i};const encoded=e.encodeNestedDetailState(s);assert.deepEqual(e.decodeNestedDetailState(encoded,x),s);assert.deepEqual(e.decodeNestedDetailState(JSON.stringify(s),x),s);
  const url=e.nestedDetailConsoleHref("/console/index.html?api=%2Fapi%2Fpilot",s);assert.ok(url.startsWith("/console/index.html?api=%2Fapi%2Fpilot#nested_request="));assert.deepEqual(e.decodeNestedDetailState(new URLSearchParams(url.split("#")[1]).get("nested_request"),x),s);
  const raw=JSON.stringify(s);for(const bad of [encodeURIComponent(encoded),raw.replace('"offset":2','"offset":2e0'),raw.replace('"format_version":1','"format_version":1.0'),raw.replace('"mode":"nested"','"mode":"nested","mode":"nested"'),raw.replace('"domain_id":"pilot"','"domain_id":"pilot","\\u0064omain_id":"pilot"'),raw.replace('"feature_revision"','"feature_revisionx"'),raw.replace('pub/alpha','pub/beta')])assert.throws(()=>e.decodeNestedDetailState(bad,x));assert.throws(()=>e.nestedDetailConsoleHref("https://foreign.test/console",s));assert.throws(()=>e.nestedDetailConsoleHref("/console#request=old",s));
});

test("share64KiB cap is independent of supported execution1MiB with20 full text filters",()=>{
  const x=context(),i=fullIntent(x);i.filters=Array.from({length:20},(_,j)=>({id:`f${j}`,field:"opaque/note",op:"eq",value:"x".repeat(16384)}));assert.doesNotThrow(()=>e.toNestedDetailQuery(i,x));assert.doesNotThrow(()=>c.buildNestedDetailRequest("fp",e.toNestedDetailQuery(i,x),{features:x.features,context:x.context}));assert.throws(()=>e.encodeNestedDetailState({format:"selecto.nested-detail-state",format_version:1,intent:i}));
});

test("fresh discovery every execution rejects authenticated publication drift before POST",async()=>{
  const x=context();let pub="pub/alpha",posts=0,gets=[];
  const fetch=async(path,init={})=>{gets.push(path);const f=structuredClone(x.features);f.domain.publication=pub;if(path==="/api/v1/selecto/catalog")return Response.json({format:"selecto.domain-catalog",format_version:1,domains:[{...x.entry,publication:pub}]});if(path==="/api/pilot/manifest")return Response.json(x.manifest);if(path==="/api/pilot/domain")return Response.json(x.canonicalDomain);if(path==="/api/pilot/nested")return Response.json(f);if(path==="/api/pilot/query"){posts++;return Response.json(x.result);}throw new Error(path);};
  const client=e.createExplorerClient({fetch});const current=await client.getNestedDetailContext("pilot"),i=fullIntent(x);await client.executeNestedDetailIntent(i);assert.equal(posts,1);assert.equal(current.binding.publication,"pub/alpha");assert.equal(gets.filter(p=>p==="/api/v1/selecto/catalog").length,2);
  pub="pub/beta";await assert.rejects(client.executeNestedDetailIntent(i),error=>error.code==="stale_nested_detail_context");assert.equal(posts,1);
});
