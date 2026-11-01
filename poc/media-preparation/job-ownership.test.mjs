import test from 'node:test';
import assert from 'node:assert/strict';
import { ActiveJobBusy, JobOwnership } from './job-ownership.ts';
function storage() {
  let marker,alarm=null;
  const tx={async get(){return marker;},async put(_,v){marker=structuredClone(v);},async delete(){marker=undefined;},async setAlarm(v){alarm=v;},async deleteAlarm(){alarm=null;}};
  return {get:tx.get,async transaction(fn){return fn(tx);},snapshot:()=>({marker:structuredClone(marker),alarm})};
}
test('alarm -> new job -> late old finally preserves new marker/alarm/busy/container',async()=>{
  const s=storage(),owners=new JobOwnership(s,()=>0);let stopA=0,stopB=0;
  const a=await owners.acquire('A',100,{async cancel(){stopA++;}});
  await owners.expire(101,lease=>lease.resource.cancel(),async()=>{throw Error('unexpected orphan');});
  assert.equal(stopA,1);assert.equal(owners.current(),null);
  const b=await owners.acquire('B',500,{async cancel(){stopB++;}});const before=s.snapshot();
  await owners.release(a,async()=>{throw Error('stale cleanup must NEVER run');});
  assert.deepEqual(s.snapshot(),before);assert.equal(owners.current(),b);assert.equal(stopB,0);
  assert.throws(()=>owners.assert(a),/stale/);await assert.rejects(owners.acquire('C',600,{}),ActiveJobBusy);
  await owners.release(b,()=>b.resource.cancel());assert.equal(stopB,1);assert.equal(s.snapshot().marker,undefined);
});
test('failed cleanup retains owner and durable guard; acquire cannot overwrite it',async()=>{
  const s=storage(),owners=new JobOwnership(s,()=>0);const a=await owners.acquire('A',100,{});const before=s.snapshot();
  await assert.rejects(owners.release(a,async()=>{throw Error('destroy unknown');}));
  assert.deepEqual(s.snapshot(),before);assert.equal(owners.current(),a);
  await assert.rejects(owners.acquire('B',200,{}),error=>!(error instanceof ActiveJobBusy)&&error.message==='container_cleanup_pending');
});
test('expired owner cannot start after a delayed permit, stale alarm cannot erase a new lease',async()=>{
  const s=storage(),owners=new JobOwnership(s,()=>0);const a=await owners.acquire('A',100,{});
  await owners.release(a,async()=>{});const b=await owners.acquire('B',500,{});
  assert.throws(()=>owners.assert(a),/stale/);await owners.expire(200,async()=>{throw Error('early cleanup');},async()=>{});
  assert.equal(owners.current(),b);assert.equal(s.snapshot().marker.token,b.token);assert.equal(s.snapshot().alarm,3500);
});
test('expired, reserving and recovering owners are not healthy-busy results',async()=>{
  let clock=0;const s=storage(),owners=new JobOwnership(s,()=>clock);
  const a=await owners.acquire('A',100,{});clock=100;
  await assert.rejects(owners.acquire('B',200,{}),error=>!(error instanceof ActiveJobBusy)&&error.message==='container_cleanup_pending');
  await owners.release(a,async()=>{});
  let unblock;const base=s.transaction;s.transaction=async fn=>{await new Promise(resolve=>{unblock=resolve;});return base(fn);};
  const reservation=owners.acquire('C',300,{});
  await assert.rejects(owners.acquire('D',300,{}),error=>!(error instanceof ActiveJobBusy)&&error.message==='container_cleanup_pending');
  unblock();await reservation;s.transaction=base;
  await owners.release(owners.current(),async()=>{});
  let finish;const recovery=owners.recover(()=>new Promise(resolve=>{finish=resolve;}));
  await new Promise(resolve=>setImmediate(resolve));
  await assert.rejects(owners.acquire('E',300,{}),error=>!(error instanceof ActiveJobBusy)&&error.message==='container_cleanup_pending');
  finish();await recovery;
});
