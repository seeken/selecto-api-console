import test from 'node:test';
import assert from 'node:assert/strict';
import {assertPeriodOn, buildRemoteRequest, buildExplorerRequest, assertNestedDetailFeatures, assertNestedDetailQuery} from '../dist/index.js';
import {fixture} from './nested-fixture.mjs';

test('period validation enforces calendar precision and accepts the contract space spelling',()=>{
  for(const type of ['datetime','naive_datetime','utc_datetime','epoch_datetime']) {
    for(const value of ['0001','0099-02','2024-02-29','9999','2026-01','2026-01-15T10','2026-01-15T10:30']) assert.equal(assertPeriodOn(value,type),value);
    assert.equal(assertPeriodOn('2026-01-15 10:30',type),'2026-01-15T10:30');
  }
  for(const type of ['date','integer','string','boolean'])assert.throws(()=>assertPeriodOn('2026-01-15T10',type),/valid calendar period/);
  for(const value of [null,2026,[],{},'0000','2026-02-29','2026-13','2026-02-30','2026-01-15T24','2026-01-15T10:60','2026-01-15T10:30:00','2026-01-15T10:30+02:00'])assert.throws(()=>assertPeriodOn(value,'datetime'),/valid calendar period/);
});

test('canonical request builders validate period leaves inside boolean groups',()=>{
  const filters=[{any:[{field:'due',op:'on',value:'2026-01'}]}];
  assert.deepEqual(buildRemoteRequest('fp',{select:['id'],filters}).query.filters,filters);
  assert.throws(()=>buildRemoteRequest('fp',{select:['id'],filters:[{all:[{field:'due',op:'on',value:'2026-13'}]}]}),/valid calendar period/);
  const features={domain:{fingerprint:'fp'},revision:'rev',fields:[{path:'due',type:'date',operators:['eq','on']}]};
  assert.deepEqual(buildExplorerRequest(features,{select:['due'],filters}).query.filters,filters);
  assert.throws(()=>buildExplorerRequest(features,{select:['due'],filters:[{field:'due',op:'on',value:'2026-01-15T10'}]}),/valid calendar period/);
  features.fields[0].operators=['eq'];assert.throws(()=>buildExplorerRequest(features,{select:['due'],filters}),/not published/);
});

test('nested date inventory may publish on while legacy and non-temporal inventories stay closed',()=>{
  const f=fixture(),due=f.features.root_fields.find(f=>f.path==='due');
  assert.equal(assertNestedDetailFeatures(f.features),f.features);
  due.operators.splice(1,0,'on');assert.equal(assertNestedDetailFeatures(f.features),f.features);
  assertNestedDetailQuery({...f.query,filters:[{field:'due',op:'on',value:'2026-01'}]},f.features);
  for(const value of ['2026-13','2026-01-15T10'])assert.throws(()=>assertNestedDetailQuery({...f.query,filters:[{field:'due',op:'on',value}]},f.features),/valid calendar period/);
  f.features.root_fields.find(f=>f.path==='id').operators.push('on');assert.throws(()=>assertNestedDetailFeatures(f.features),/operator inventory/);
});
