import test from "node:test";
import assert from "node:assert/strict";
import {fixture} from "../../../test/root-fixture.mjs";
import {toRootPredicateQuery,assertRootPredicateIntent,parseRootPredicateState,encodeRootPredicateState,decodeRootPredicateState,validateRootPredicateFeaturesAndMap,createExplorerClient} from "../dist/index.js";

test("root authoring maps only opaque field paths and preserves singleton/repeated tree structure",()=>{
  const {intent,context}=fixture(); const query=toRootPredicateQuery(intent,context);
  assert.deepEqual(query.where,{or:[{and:[{field:"id",op:"gte",value:"2"},{field:"active",op:"eq",value:true}]},{field:"note",op:"is_null"}]});
  assert.deepEqual(query.select,["id","name","amount","active","note","large","due"]);
  assert.equal(query.timezone,"UTC"); assert.equal(Object.hasOwn(query,"filters"),false);
  intent.predicate={kind:"tree",tree:{and:[{field:"unrelated/ID-9",op:"eq",value:"2"}]}};
  assert.deepEqual(toRootPredicateQuery(intent,context).where,{and:[{field:"id",op:"eq",value:"2"}]});
  intent.predicate={kind:"absent"}; assert.equal(Object.hasOwn(toRootPredicateQuery(intent,context),"where"),false);
});

test("complete root state round-trips exact types/presentation and blocks every changed binding",()=>{
  const {state,context}=fixture(); assert.deepEqual(decodeRootPredicateState(encodeRootPredicateState(state),context),state);
  for (const key of Object.keys(state.intent.binding)) {
    const copy=structuredClone(state);copy.intent.binding[key]="changed";assert.throws(()=>assertRootPredicateIntent(copy.intent,context));
  }
  for (const mutate of [s=>s.format_version=2,s=>s.extra=true,s=>s.intent.predicate.tree={and:[]},s=>s.intent.predicate.tree={field:"unrelated/ID-9",op:"eq",value:2},s=>s.intent.predicate.tree={field:"optional",op:"is_null",value:null},s=>s.intent.select=["source.id"]]) {const copy=structuredClone(state);mutate(copy);assert.throws(()=>parseRootPredicateState(JSON.stringify(copy),context));}
  const raw=JSON.stringify(state);
  assert.throws(()=>parseRootPredicateState(raw.replace('"format_version":1','"format_version":1.0')));
  assert.throws(()=>parseRootPredicateState(raw.replace('"format_version":1','"format_version":1,"format_version":1')));
  const copy=structuredClone(state);copy.intent.predicate={kind:"tree",tree:{field:"title",op:"eq",value:"😀�"}};
  assert.deepEqual(parseRootPredicateState(JSON.stringify(copy),context),copy);
  assert.throws(()=>parseRootPredicateState(JSON.stringify(copy).replace("😀�","\\ud800"),context));
});

test("transparent pure facade returns actual validated features and mapped fields",()=>{
  const {features,trusted}=fixture();const tree={field:"unrelated/ID-9",op:"eq",value:"2"};
  assert.deepEqual(validateRootPredicateFeaturesAndMap(features,trusted,["unrelated/ID-9"],tree),{validated_features:features,translated_select:["id"],translated_where:{field:"id",op:"eq",value:"2"}});
  assert.throws(()=>validateRootPredicateFeaturesAndMap(features,trusted,["source.id"],tree));
});

test("query clones author intent before fresh discovery and refuses tenant/revision drift without POST",async()=>{
  const {features,intent,manifest}=fixture();let publication="scope-A",revision="opaque-current",release;const posts=[];
  const metadata={format:"selecto.explorer-metadata",format_version:1,domain:features.domain,label:"Items",fields:features.fields.map(({operators,...field})=>field),default_select:features.default_select,query:{profile:"remote_query.v1",operators:["eq"],limits:{max_limit:100,max_offset:100000,max_filters:20},supports:{detail:true,nested:false,recursive_filters:false,aggregates:false}},services:{}};
  const canonicalDomain={domain_fingerprint:"fp",source:{fields:features.fields.map(f=>f.path),columns:Object.fromEntries(features.fields.map(({path,type,encoding,nullable})=>[path,{type,encoding,nullable}]))}};
  const client=createExplorerClient({baseUrl:"/api/items",catalogPath:"/catalog",fetch:async(path,init)=>{
    if(path==="/catalog") {if(release) await release;return Response.json({format:"selecto.domain-catalog",format_version:1,domains:[{id:"items",label:"Items",publication,manifest:"/manifest",explorer_metadata:"/metadata"}]});}
    if(path==="/manifest") return Response.json(manifest);
    if(path==="/metadata") return Response.json({...metadata,domain:{...features.domain,publication}});
    if(path==="/api/items/domain") return Response.json(canonicalDomain);
    if(path==="/api/items/features") return Response.json({...features,revision,domain:{...features.domain,publication}});
    posts.push(JSON.parse(init.body));return Response.json({ok:true,data:{format:"selecto.remote-query-result",format_version:1,domain:{fingerprint:"fp"},columns:features.fields.map(f=>({id:f.path,field:f.path,label:f.label,type:f.type,encoding:f.encoding,nullable:f.nullable})),rows:[],row_count:0,page:{limit:2,offset:0,has_more:false}}});
  }});
  let unblock;release=new Promise(resolve=>unblock=resolve);const pending=client.executeRootPredicateIntent(intent);intent.limit=1;unblock();await pending;
  assert.equal(posts[0].query.limit,2); assert.equal(posts[0].format_version,2);
  publication="scope-B";await assert.rejects(client.executeRootPredicateIntent(intent));assert.equal(posts.length,1);
  publication="scope-A";revision="changed";await assert.rejects(client.executeRootPredicateIntent(intent));assert.equal(posts.length,1);
});

test("preserved flat snapshot maps to existing v1 without wrapping twenty leaves",async()=>{
  const {flatSnapshotToRequest,toCanonicalQuery}=await import("../dist/index.js");const {features}=fixture();
  const snapshot={version:2,domainId:"items",view:"detail",state:{selected:["unrelated/ID-9"],orderBy:[],groupBy:[],aggregates:[]},filters:{conjunction:"and",items:Array.from({length:20},(_,i)=>({id:String(i),field:"unrelated/ID-9",operator:"equals",value:1}))},page:{number:1,size:100},presentation:{timezone:"UTC",locale:"en-US"},publication:{fingerprint:"fp",publication:"scope-A"}};
  const request=flatSnapshotToRequest(snapshot);assert.equal(request.schema,"selecto.spa.query-request/v1");assert.equal(Object.hasOwn(request,"version"),false);assert.equal(request.filters,snapshot.filters);
  const metadata={format:"selecto.explorer-metadata",format_version:1,domain:features.domain,label:"Items",fields:features.fields,default_select:features.default_select,query:{profile:"remote_query.v1",operators:["eq"],limits:{max_limit:100,max_offset:100000,max_filters:20},supports:{detail:true,nested:false,recursive_filters:false,aggregates:false}},services:{}};
  const query=toCanonicalQuery(request,metadata);assert.equal(query.filters.length,20);assert.equal(query.filters[0].value,1);assert.equal(Object.hasOwn(query,"where"),false);
  assert.throws(()=>flatSnapshotToRequest({...snapshot,where:{and:[]}}));
});
