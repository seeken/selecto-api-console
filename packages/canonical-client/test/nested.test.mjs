import test from "node:test";
import assert from "node:assert/strict";
import {fixture,objects} from "./nested-fixture.mjs";
import * as c from "../dist/index.js";
import {readFile} from "node:fs/promises";

test("native sorted-key nested fixed order is semantic and stays a closed PK ascending item",async()=>{
  const native=JSON.parse(await readFile(new URL("./fixtures/native-go-sorted-nested-features.json",import.meta.url),"utf8"));
  assert.deepEqual(Object.keys(native.collections[0].order_by[0]),["direction","field"]);
  assert.equal(c.assertNestedDetailFeatures(native),native);
  const {features,trusted}=fixture();
  for(const item of [{field:"lines.id",direction:"asc"},{direction:"asc",field:"lines.id"}]) {
    const f=structuredClone(features);f.collections[0].order_by=[item];assert.equal(c.assertNestedDetailFeatures(f,trusted),f);
  }
  const badOrders=[null,{},"lines.id",[],[{field:"lines.id",direction:"asc"},{field:"lines.id",direction:"asc"}],[null],[true],[[]],["lines.id"],[{field:"lines.id"}],[{direction:"asc"}],[{field:"lines.id",direction:"asc",extra:true}],[{direction:"asc",field:"lines.id",extra:true}],[{field:"lines.price",direction:"asc"}],[{field:"lines.id",direction:"desc"}],[{field:null,direction:"asc"}],[{field:"lines.id",direction:null}],[{field:1,direction:"asc"}],[{field:"lines.id",direction:true}]];
  for(const order of badOrders){const f=structuredClone(features);f.collections[0].order_by=order;assert.throws(()=>c.assertNestedDetailFeatures(f,trusted),c.CanonicalWireError);}
});

test("nested sidecar is a closed explicit v1 palette, bound to current authenticated discovery",()=>{
  const {features,trusted}=fixture();assert.equal(c.assertNestedDetailFeatures(features,trusted),features);
  for(const change of [f=>f.extra=true,f=>f.revision="",f=>f.domain.publication="other",f=>f.root_fields[0].nullable=true,f=>f.root_fields[0].encoding="string",f=>f.collections.push(f.collections[0]),f=>f.collections[0].fields[0].id=f.root_fields[0].id,f=>f.collections[0].fields[1].path="other.price",f=>f.collections[0].fields[0].nullable=true,f=>f.collections[0].result_id="else",f=>f.collections[0].default_select=["lines.unknown"],f=>f.defaults.select=["id"],f=>f.supports.partial_children=true,f=>f.limits.max_children_per_parent=21]){const copy=structuredClone(features);change(copy);assert.throws(()=>c.assertNestedDetailFeatures(copy,trusted));}
  const reduced=structuredClone(features);reduced.root_fields=reduced.root_fields.filter(f=>f.path!=="note");assert.doesNotThrow(()=>c.assertNestedDetailFeatures(reduced,trusted));
  const foreign=structuredClone(trusted);foreign.canonicalDomain.source.columns.id.nullable=true;assert.throws(()=>c.assertNestedDetailFeatures(features,foreign));
  const unsafe=structuredClone(trusted);unsafe.manifest.routes.at(-1).path="https://foreign.test/nested";assert.throws(()=>c.assertNestedDetailFeatures(features,unsafe));
});

test("selected context UTF8 is one canonical base64url layer; raw input keeps number tokens and bytes",()=>{
  const {features,context,query}=fixture();const encoded=c.encodeNestedDetailContext(context);assert.ok(!/[=+\/\s]/.test(encoded));assert.deepEqual(JSON.parse(Buffer.from(encoded,"base64url").toString("utf8")),context);
  const raw=JSON.stringify(c.buildNestedDetailRequest("fp",query,{features,context}),null,3);assert.equal(c.parseNestedDetailRequestText(raw,{features,context}).raw,raw);
  for(const bad of [raw.replace('"format_version": 1','"format_version": 1.0'),raw.replace('"limit": 25','"limit": 25e0'),raw.replace('"fp"','"stale"'),'\ufeff'+raw,raw.replace('"domain": {','"domain": {"fingerprint":"fp",')])assert.throws(()=>c.parseNestedDetailRequestText(bad,{features,context}));
  const filtered={select:["id",["lines.id"]],filters:[{field:"id",op:"eq",value:1}]};const text=JSON.stringify(c.buildNestedDetailRequest("fp",filtered,{features,context}));
  for(const token of ["1.0","1e0","9007199254740992"])assert.throws(()=>c.parseNestedDetailRequestText(text.replace('"value":1',`"value":${token}`),{features,context}));
  assert.doesNotThrow(()=>c.parseNestedDetailRequestText(text.replace('"value":1','"value":-0'),{features,context}));
});

test("nested field scalars retain fixed codecs/calendar/range and refuse lossy alternatives",()=>{
  const {features}=fixture();const f=p=>features.root_fields.find(f=>f.path===p);
  for(const [path,values] of [["id",[1.2,9007199254740992,"1",null]],["amount",[0.1,"0.1","1e0","01.000000","1.0000000"]],["serial",[7,"-0","01","9223372036854775808"]],["due",["0000-01-01","2026-02-29", "2026-01-01T00:00:00Z"]],["active",["true",1]],["note",["\0","\ud800"]]])for(const v of values)assert.throws(()=>c.assertNestedDetailScalar(v,f(path)));
  for(const [p,v]of [["amount","9007199254740993.123456"],["serial","-9223372036854775808"],["due","0001-01-01"],["due","9999-12-31"],["note",null],["note","😀".repeat(4096)]])assert.doesNotThrow(()=>c.assertNestedDetailScalar(v,f(p)));
  assert.doesNotThrow(()=>c.assertNestedDetailScalar("-0.000000",f("amount"),"author",{author:true}));assert.throws(()=>c.assertNestedDetailScalar("-0",f("id"),"author",{author:true}));
});

test("complete typed children validate selection, empty metadata and every width/key/codec atomically",()=>{
  const {features,context,query,result}=fixture();const options={features,context,query};assert.equal(c.assertNestedDetailResult(result,options),result);
  const obj=objects(result);assert.doesNotThrow(()=>c.assertNestedDetailResult(obj,{...options,query:{...query,row_format:"objects"}}));
  const empty=structuredClone(result);empty.data.rows=[];empty.data.row_count=0;assert.doesNotThrow(()=>c.assertNestedDetailResult(empty,options));
  for(const change of [r=>r.data.subtables={},r=>r.data.subtables.lines.complete=false,r=>r.data.subtables.lines.columns.reverse(),r=>r.meta.selecto_nested_detail.revision="other",r=>r.data.columns[1].nullable=true,r=>r.data.columns[0].encoding="decimal-string",r=>r.data.rows[0][1]=null,r=>r.data.rows[0][1][0].pop(),r=>r.data.rows[0][1][0][0]=1.5,r=>r.data.rows[0][1][0][1]="0.1",r=>r.data.rows[0][1][0][2]=7,r=>r.data.rows[0][1][0][3]="0000-01-01",r=>r.data.rows[0][1][0][5]="true",r=>r.data.rows[0][1]=Array.from({length:21},()=>r.data.rows[0][1][0]),r=>r.data.row_count=0]){const copy=structuredClone(result);change(copy);assert.throws(()=>c.assertNestedDetailResult(copy,options));}
  const wrong=objects(result);wrong.data.rows[0].lines[0].unexpected="extra";assert.throws(()=>c.assertNestedDetailResult(wrong,{...options,query:{...query,row_format:"objects"}}));
  const parsed=c.parseStrictJSON(JSON.stringify(result).replace('[[11,','[[11e0,'),{tokens:true});assert.throws(()=>c.assertNestedDetailResult(parsed.value,{...options,numberTokens:parsed.numberTokens}));
  const invalidEmpty=structuredClone(empty);invalidEmpty.data.subtables.lines.columns=[];assert.throws(()=>c.assertNestedDetailResult(invalidEmpty,options));
});

test("unsupported or malformed query semantics cannot disappear at the selected seam",()=>{
  const {features,query}=fixture();
  for(const bad of [{...query,where:{and:[]}},{...query,select:["id"]},{...query,select:["id",[]]},{...query,select:["id",["lines.id"],["lines.price"]]},{...query,select:["id","id",["lines.id"]]},{...query,filters:[{field:"lines.price",op:"eq",value:"1"}]},{...query,filters:[{field:"id",op:"is_null",value:null}]},{...query,filters:[{field:"active",op:"gt",value:true}]},{...query,limit:26},{...query,offset:null},{...query,row_format:null},{...query,order_by:[{field:"id",direction:"asc"},{field:"id",direction:"desc"}]}])assert.throws(()=>c.assertNestedDetailQuery(bad,features));
});

test("actual transport selects header without v2, forwards valid raw text and rejects raw response lexical drift",async()=>{
  const {features,context,query,result,manifest}=fixture();let calls=[];let raw=JSON.stringify(result);const fetch=async(path,init)=>{calls.push({path,init});return new Response(raw,{status:200,headers:{"content-type":"application/json"}});};const client=c.createCanonicalClient({fetch});const text=JSON.stringify(c.buildNestedDetailRequest("fp",query,{features,context}),null,2);const signal=new AbortController().signal;
  await client.queryNestedDetailText(manifest,text,{features,context,signal});assert.equal(calls[0].init.body,text);assert.equal(calls[0].init.signal,signal);assert.equal(calls[0].init.headers.get("Selecto-Nested-Detail-Context"),c.encodeNestedDetailContext(context));assert.equal(calls[0].init.credentials,"same-origin");
  raw=raw.replace('[[11,','[[11.0,');await assert.rejects(client.queryNestedDetailText(manifest,text,{features,context}));
  const before=calls.length;await assert.rejects(client.queryNestedDetailText(manifest,text.replace('"format_version": 1','"format_version": 1e0'),{features,context}));assert.equal(calls.length,before);
});

test("selected transport preserves BOM for strict refusal and validates selected error status/context",async()=>{
  const {features,context,query,result,manifest}=fixture();let body="\ufeff"+JSON.stringify(result),status=200;const client=c.createCanonicalClient({fetch:async()=>new Response(body,{status})});await assert.rejects(client.queryNestedDetail(manifest,query,{features,context}));
  body=JSON.stringify({ok:false,error:{code:"invalid_query",message:"Refused",details:{}},meta:{selecto_nested_detail:context}});status=422;await assert.rejects(client.queryNestedDetail(manifest,query,{features,context}),e=>e instanceof c.CanonicalHttpError&&e.status===422);
  status=500;await assert.rejects(client.queryNestedDetail(manifest,query,{features,context}),e=>e instanceof c.CanonicalWireError);
  status=422;body=body.replace('"pub/alpha"','"other"');await assert.rejects(client.queryNestedDetail(manifest,query,{features,context}),e=>e instanceof c.CanonicalWireError);
});

test("nested discovery preserves exact response version tokens and safe absence/auth failures",async()=>{
  const {features,manifest}=fixture();let body=JSON.stringify(features),status=200;const client=c.createCanonicalClient({fetch:async()=>new Response(body,{status})});assert.deepEqual(await client.nestedDetailFeatures(manifest),features);
  body=body.replace('"format_version":1','"format_version":1e0');await assert.rejects(client.nestedDetailFeatures(manifest));
  const missing=structuredClone(manifest);missing.routes.pop();await assert.rejects(client.nestedDetailFeatures(missing));
  status=401;body=JSON.stringify({ok:false,error:{code:"authentication_required",message:"Auth",details:{}}});await assert.rejects(client.nestedDetailFeatures(manifest),e=>e instanceof c.CanonicalHttpError&&e.status===401);
});

test("sidecar requires whole encoded context to fit, independently of per-token bounds",()=>{
  const {features}=fixture();const tabs=structuredClone(features);tabs.revision="\t".repeat(1024);assert.doesNotThrow(()=>c.assertNestedDetailFeatures(tabs));assert.ok(c.encodeNestedDetailContext(c.nestedDetailContext(tabs)).length<=8192);
  const c0=structuredClone(features);c0.revision="\x01".repeat(1024);assert.throws(()=>c.assertNestedDetailFeatures(c0),/header limit/);
  const all=structuredClone(features);for(const key of ["fingerprint","publication"])all.domain[key]="\x01".repeat(1024);all.revision="\x01".repeat(1024);assert.throws(()=>c.assertNestedDetailFeatures(all),/header limit/);
});
