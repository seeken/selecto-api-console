import test from "node:test";
import assert from "node:assert/strict";
import {fixture,objects} from "../../canonical-client/test/nested-fixture.mjs";
import * as e from "../dist/index.js";
import * as c from "@selecto/canonical-client";
function context() {const f=fixture();return {...f,...f.trusted,binding:e.nestedDetailBinding(f.features)};}
function fullIntent(x) {const i=e.createNestedDetailIntent(x.features);i.select=x.query.select.map(s=>Array.isArray(s)?s.map(p=>x.features.collections[0].fields.find(f=>f.path===p).id):x.features.root_fields.find(f=>f.path===s).id);return i;}

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
