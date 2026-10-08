import test from "node:test";
import assert from "node:assert/strict";
import {fixture} from "../../../test/root-fixture.mjs";
import {assertRootPredicateFeatures,assertRootScalar,assertRootPredicateQuery,buildRootPredicateRequest,parseCanonicalRequestText,parseStrictJSON,createCanonicalClient,safePath,assertRootPredicateResult} from "../dist/index.js";

test("features bind opaque IDs, canonical codecs and current publication without revision whitelist", () => {
  const {features,trusted} = fixture();
  assert.equal(assertRootPredicateFeatures(features,trusted),features);
  for (const change of [f=>f.domain.publication="other",f=>f.revision="old",f=>f.fields[0].path="missing",f=>f.fields[0].encoding="string",f=>f.fields[3].operators.push("gt"),f=>f.fields[1].id=f.fields[0].id,f=>f.default_select.push("missing"),f=>f.supports.not=true]) {
    const copy=structuredClone(features); change(copy); assert.throws(()=>assertRootPredicateFeatures(copy,trusted));
  }
  features.revision="new opaque publisher token"; trusted.revision=features.revision;
  assert.doesNotThrow(()=>assertRootPredicateFeatures(features,trusted));
});

test("strict raw JSON rejects duplicate decoded keys and malformed Unicode, preserves valid pairs and number lexemes", () => {
  for (const text of ['{"a":1,"a":2}','{"a":1,"\\u0061":2}','{"a":"\\ud800"}','{"a":"\\udc00"}','{"nested":{"a":1,"a":2}}','{"a":01}']) assert.throws(()=>parseStrictJSON(text));
  const parsed=parseStrictJSON('{"a":"\\ud83d\\ude00�","n":-0,"v":1e0}',{tokens:true});
  assert.equal(parsed.value.a,"😀�"); assert.equal(parsed.numberTokens.get("/v"),"1e0"); assert.ok(Object.is(parsed.value.n,-0));
  assert.throws(()=>parseStrictJSON('{"x":'+ '0'.repeat(1048576) +'}'),/byte limit/);
  for (const path of ["/api/%252e%252e/x","/api/%252fsecret","/api/%255csecret"]) assert.throws(()=>safePath(path));
});

test("five exact scalar types refuse precision, range, calendar and Unicode loss", () => {
  const {features} = fixture(); const field=(type)=>features.fields.find(f=>f.type===type);
  for (const value of ["1.0","1e0","-0","01","9223372036854775808",9007199254740992,null]) assert.throws(()=>assertRootScalar(value,field("integer")));
  assert.doesNotThrow(()=>assertRootScalar("-9223372036854775808",field("integer")));
  assert.doesNotThrow(()=>assertRootScalar("9007199254740993.000001",field("decimal")));
  for (const value of [0.1,"1e5",".2"]) assert.throws(()=>assertRootScalar(value,field("decimal")));
  for (const value of ["0000-01-01","2026-02-29"]) assert.throws(()=>assertRootScalar(value,field("date")));
  assert.doesNotThrow(()=>assertRootScalar("0001-01-01",field("date")));
  assert.throws(()=>assertRootScalar("false",field("boolean")));
  assert.throws(()=>assertRootScalar("x\0",field("string")));
  assert.doesNotThrow(()=>assertRootScalar("😀".repeat(4096),field("string")));
  assert.throws(()=>assertRootScalar("😀".repeat(4097),field("string")));
});

test("raw request keeps original valid text and refuses normalization of v2 integer tokens", () => {
  const {features,manifest} = fixture(); const query={select:["id"],where:{field:"id",op:"eq",value:1},limit:2};
  const raw=JSON.stringify(buildRootPredicateRequest("fp",query,{features,requestId:"proof"}),null,2);
  assert.equal(parseCanonicalRequestText(raw,{features,manifest}).raw,raw);
  for (const changed of [raw.replace('"format_version": 2','"format_version": 2.0'),raw.replace('"format_version": 2','"format_version": 2e0'),raw.replace('"value": 1','"value": 1.0'),raw.replace('"value": 1','"value": 1e0')]) assert.throws(()=>parseCanonicalRequestText(changed,{features,manifest}));
  assert.throws(()=>buildRootPredicateRequest("fp",query,{features,requestId:"é".repeat(65)}));
  assert.throws(()=>buildRootPredicateRequest("fp",query,{features,requestId:"a\nb"}));
  // Existing v1 numeric-one decoding remains distinct from strict v2.
  const v1='{"format":"selecto.remote-query","format_version":1.0,"domain":{"fingerprint":"fp"},"query":{"select":["id"]}}';
  assert.equal(parseCanonicalRequestText(v1,{features,manifest}).request.format_version,1);
});

test("groups retain repeated leaves and count every node before simplification",()=>{
  const {features}=fixture(); const leaf={field:"id",op:"eq",value:"2"};
  assert.doesNotThrow(()=>assertRootPredicateQuery({select:["id"],where:{and:Array.from({length:19},()=>leaf)}},features));
  assert.throws(()=>assertRootPredicateQuery({select:["id"],where:{and:Array.from({length:20},()=>leaf)}},features));
  assert.doesNotThrow(()=>assertRootPredicateQuery({select:["id"],where:{or:[{and:[{or:[leaf]}]}]}},features));
  for (const where of [{and:[]},{or:[]},{and:[{or:[]}]},{and:[leaf],or:[leaf]},{field:"id",op:"is_null",value:null},{or:[leaf,{field:"secret",op:"eq",value:"x"}]},{and:[{or:[{and:[{or:[leaf]}]}]}]}]) assert.throws(()=>assertRootPredicateQuery({select:["id"],where},features));
});

test("root transport sends original bytes with abort and validates exact selection codecs",async()=>{
  const {features,manifest}=fixture(); const query={select:["id","amount"],limit:2,offset:0}; const raw=JSON.stringify(buildRootPredicateRequest("fp",query,{features}),null,3);
  const result={ok:true,data:{format:"selecto.remote-query-result",format_version:1,domain:{fingerprint:"fp"},columns:features.fields.filter(f=>query.select.includes(f.path)).map(f=>({id:f.path,field:f.path,label:f.label,type:f.type,encoding:f.encoding,nullable:f.nullable})),rows:[[2,"9007199254740993.001"]],row_count:1,page:{limit:2,offset:0,has_more:false}}};
  const signal=new AbortController().signal; const seen=[]; const client=createCanonicalClient({baseUrl:"/api/items",fetch:async(path,init)=>{seen.push({path,init});return Response.json(result);}});
  await client.queryText(manifest,raw,{features,signal}); assert.equal(seen[0].init.body,raw);assert.equal(seen[0].init.signal,signal);assert.equal(seen[0].init.redirect,"error");
  for (const mutate of [r=>r.data.columns.reverse(),r=>r.data.columns[1].encoding="json",r=>r.data.columns[0].nullable=true,r=>r.data.rows[0][1]=0.1,r=>r.data.page.offset=1]) {const copy=structuredClone(result);mutate(copy);assert.throws(()=>assertRootPredicateResult(copy,{fingerprint:"fp",query,features}));}
});

test("root results reuse v1 codecs without request string quotas or int64 input admission",()=>{
  const {features}=fixture();const query={select:["name","large"],limit:100,offset:0};
  const response={ok:true,data:{format:"selecto.remote-query-result",format_version:1,domain:{fingerprint:"fp"},columns:features.fields.filter(f=>query.select.includes(f.path)).map(f=>({id:f.path,field:f.path,label:f.label,type:f.type,encoding:f.encoding,nullable:f.nullable})),rows:[["x".repeat(16385),"9223372036854775808"]],row_count:1,page:{limit:100,offset:0,has_more:false}}};
  assert.doesNotThrow(()=>assertRootPredicateResult(response,{fingerprint:"fp",query,features}));
  response.data.rows[0][1]="not an integer";assert.throws(()=>assertRootPredicateResult(response,{fingerprint:"fp",query,features}));
  response.data.rows[0][1]="9223372036854775808";response.data.columns[1].encoding="json";assert.throws(()=>assertRootPredicateResult(response,{fingerprint:"fp",query,features}));
});
