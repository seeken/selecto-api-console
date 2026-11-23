const test = require('node:test');
const assert = require('node:assert/strict');
const {APIConsole} = require('../dist/selecto-api-console.js');
function instance() {
  const x = new APIConsole({dataset:{apiBase:'/api/items'}});
  x.domain = {source:{primary_key:'id',fields:['id'],columns:{id:{type:'integer'}}},writes:{
    operations:{update:{enabled:1,returning:['id']}},fields:{},relationships:{detail:{
      writable:1,cardinality:'one',ownership:'owned',direction:'has_one',allowed_ops:['insert','update','delete'],domain:{
        source:{fields:['id','message'],columns:{id:{type:'integer'},message:{type:'string'}}},
        writes:{operations:{insert:{enabled:1},update:{enabled:1},delete:{enabled:1}},fields:{message:{insertable:1,updatable:1}}}
      }}}}};
  Object.assign(x.writeState,{operation:'update',filters:[{field:'id',op:'eq',value:'42'}],relationships:{detail:{
    enabled:true,operation:'insert',assignments:{message:'Delivery instruction'},included:{message:true},returning:[]}}});
  return x;
}
class Node {
  constructor(tag){this.tag=tag;this.children=[];this.dataset={};this.textContent='';}
  append(...children){this.children.push(...children);} replaceChildren(...children){this.children=children;}
  add(option){this.children.push(option);} get options(){return this.children;}
}
function dom(fn) {
  const doc=global.document,option=global.Option;
  global.document={createElement:tag=>new Node(tag),createTextNode:text=>({textContent:text,children:[],dataset:{}})};
  global.Option=class extends Node {constructor(text,value,_default,selected){super('option');this.textContent=text;this.value=value;this.selected=selected;}};
  try{return fn();}finally{global.document=doc;global.Option=option;}
}
const all = node => [node,...node.children.flatMap(all)];
function rendered(x) {const target=new Node('div');x.renderWriteRelationships(target);return all(target);}

test('relationship-only update sends empty root assignments with a complete nested insert',()=>{
  const x=instance(),built=x.buildWriteRequest();
  assert.deepEqual(built.errors,[]);
  assert.deepEqual(built.payload,{operation:'update',assignments:{},filters:[{field:'id',op:'eq',value:42}],expected_count:1,
    relationships:{detail:{operation:'insert',assignments:{message:'Delivery instruction'}}}});
  x.loadWritePayloadIntoForm(built.payload);assert.deepEqual(x.buildWriteRequest(),built);
});

test('root update with neither an assignment nor an enabled related record explains what is missing',()=>{
  const x=instance();x.writeState.relationships.detail.enabled=false;
  assert.deepEqual(x.buildWriteRequest().errors,['Choose at least one assignment or related record.']);
  assert.deepEqual(x.buildWriteRequest().payload.assignments,{});
});

test('root assignment remains sufficient and a related insert/update still needs its own assignment',()=>{
  const x=instance();x.domain.source.fields.push('name');x.domain.source.columns.name={type:'string'};x.domain.writes.fields.name={updatable:true};
  x.writeState.included.name=true;x.writeState.assignments.name='Item';x.writeState.relationships.detail.enabled=false;
  assert.deepEqual(x.buildWriteRequest().errors,[]);
  for(const operation of ['insert','update']) {
    Object.assign(x.writeState.relationships.detail,{enabled:true,operation,included:{},assignments:{}});
    assert.match(x.buildWriteRequest().errors.join(' '),/Detail requires at least one assignment/);
  }
});

test('related delete sends exactly an operation and ignores retained field and returning state',()=>{
  const x=instance();Object.assign(x.writeState.relationships.detail,{operation:'delete',returning:['id']});
  const built=x.buildWriteRequest();assert.deepEqual(built.errors,[]);assert.deepEqual(built.payload.relationships,{detail:{operation:'delete'}});
  x.loadWritePayloadIntoForm(built.payload);assert.deepEqual(x.buildWriteRequest(),built);
});

test('related delete renders Delete without assignment fields or a returning chooser',()=>dom(()=>{
  const x=instance();x.writeState.relationships.detail.operation='delete';const nodes=rendered(x);
  assert.deepEqual(nodes.find(n=>n.dataset.sacWriteRelationshipOperation==='detail').options.map(n=>n.textContent),['Insert','Update','Delete']);
  assert.equal(nodes.some(n=>Object.hasOwn(n.dataset,'sacWriteRelationshipField')),false);
  assert.equal(nodes.some(n=>Object.hasOwn(n.dataset,'sacWriteRelationshipInclude')),false);
  assert.equal(nodes.some(n=>Object.hasOwn(n.dataset,'sacWriteRelationshipReturning')),false);
}));

test('related operations require both allowed_ops and enabled nested writes and Delete requires root update',()=>dom(()=>{
  for(const exclusion of ['allowed_ops','enabled','root_insert']) {
    const x=instance(),spec=x.domain.writes.relationships.detail;
    if(exclusion==='allowed_ops')spec.allowed_ops=['insert','update'];
    if(exclusion==='enabled')spec.domain.writes.operations.delete.enabled=false;
    if(exclusion==='root_insert'){x.domain.writes.operations.insert={enabled:true};x.writeState.operation='insert';}
    const nodes=rendered(x),ops=nodes.find(n=>n.dataset.sacWriteRelationshipOperation==='detail').options.map(n=>n.value);
    assert.equal(ops.includes('delete'),false);if(exclusion==='root_insert')assert.deepEqual(ops,['insert']);
    x.writeState.relationships.detail.operation='delete';assert.match(x.buildWriteRequest().errors.join(' '),/does not allow delete/);
    assert.throws(()=>x.writeStateFromPayload({operation:x.writeState.operation,assignments:{},filters:x.writeState.operation==='update'?[{field:'id',op:'eq',value:42}]:undefined,relationships:{detail:{operation:'delete'}}}),/does not allow delete/);
  }
}));

test('unsupported related insert is not offered or admitted even when nested operations enable it',()=>dom(()=>{
  const x=instance();x.domain.writes.relationships.detail.allowed_ops=['update'];
  const nodes=rendered(x);assert.deepEqual(nodes.find(n=>n.dataset.sacWriteRelationshipOperation==='detail').options.map(n=>n.value),['update']);
  x.writeState.relationships.detail.operation='insert';assert.match(x.buildWriteRequest().errors.join(' '),/does not allow insert/);
}));

test('related delete imports never silently drop assignments or returning',()=>{
  const x=instance(),previous=structuredClone(x.writeState);
  for(const extra of [{assignments:{}},{returning:['id']}]) {
    assert.throws(()=>x.loadWritePayloadIntoForm({operation:'update',filters:[{field:'id',op:'eq',value:42}],relationships:{detail:{operation:'delete',...extra}}}),/delete accepts only an operation/);
    assert.deepEqual(x.writeState,previous);
  }
});

test('the empty contract message remains only for domains without enabled root operations',()=>dom(()=>{
  const x=instance(),target=new Node('div');x.root.querySelector=selector=>selector==='[data-sac-write-builder]'?target:null;x.syncWriteRequest=()=>{};
  x.renderWritePanel();assert.equal(all(target).some(n=>n.textContent.includes('does not publish any governed write operations')),false);
  x.domain.writes.operations.update.enabled=0;x.renderWritePanel();assert.equal(all(target).some(n=>n.textContent==='This domain does not publish any governed write operations.'),true);
}));
