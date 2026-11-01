import test from 'node:test';
import assert from 'node:assert/strict';
import { BoundedByteReader } from './byte-reader.ts';
const MIB = 1024 ** 2;

test('default fallback coalesces tiny chunks without read-ahead and cancels once', async () => {
  let offset = 0, pulls = 0, cancelled = 0;
  const source = new ReadableStream({ pull(c) {
    pulls++; const n = Math.min(257, 2 * MIB + 7 - offset);
    if (!n) { c.close(); return; }
    const bytes = new Uint8Array(n); for (let i = 0; i < n; i++) bytes[i] = (offset + i) % 251;
    offset += n; c.enqueue(bytes);
  }, cancel() { cancelled++; } }, { highWaterMark: 0 });
  const reader = new BoundedByteReader(source); assert.equal(pulls, 0);
  const first = await reader.read(MIB); assert.equal(first.value.length, MIB);
  for (let i = 0; i < first.value.length; i++) assert.equal(first.value[i], i % 251);
  const before = pulls; await new Promise(resolve => setImmediate(resolve)); assert.equal(pulls, before);
  await reader.cancel(); await reader.cancel(); assert.equal(cancelled, 1);
});
test('Cloudflare readAtLeast uses returned detached view and retains partial EOF plus explicit EOF', async () => {
  let offset = 0, released = 0; const requests = [];
  const byob = { async readAtLeast(min, view) {
    assert.equal(min, view.length); assert.ok(view.length <= MIB); requests.push(min);
    const moved = structuredClone(view, { transfer: [view.buffer] }); assert.equal(view.byteLength, 0);
    const n = Math.min(min, MIB + 7 - offset);
    for (let i = 0; i < n; i++) moved[i] = (offset + i) % 251;
    offset += n;
    return n ? { value: moved.subarray(0, n), done: false } : { value: undefined, done: true };
  }, releaseLock() { released++; }, async cancel() {} };
  const reader = new BoundedByteReader({ getReader(options) { assert.equal(options.mode, 'byob'); return byob; } });
  const first = await reader.read(MIB), last = await reader.read(MIB);
  assert.equal(first.value.length, MIB); assert.equal(last.value.length, 7);
  for (let i = 0; i < last.value.length; i++) assert.equal(last.value[i], (MIB + i) % 251);
  assert.equal((await reader.read(1)).done, true); assert.deepEqual(requests, [MIB, MIB, 1]);
  reader.releaseLock(); assert.equal(released, 1);
});
test('Node byte producer close-only EOF works via default fallback; oversized default chunks fail', async () => {
  let sent = false;
  const reader = new BoundedByteReader(new ReadableStream({ type: 'bytes', pull(c) {
    if (sent) { c.close(); return; } sent = true; c.enqueue(new Uint8Array([1, 2, 3]));
  } }));
  assert.deepEqual((await reader.read(MIB)).value, new Uint8Array([1, 2, 3]));
  assert.equal((await reader.read(1)).done, true); reader.releaseLock();
  const large = new BoundedByteReader(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(MIB + 1)); c.close(); } }));
  await assert.rejects(large.read(MIB), /stream_chunk_limit/); await large.cancel();
});
test('cancelling a pending batch rejects the read and cancels upstream once', async () => {
  let pulls=0,cancelled=0,waiting;
  const pendingPull=new Promise(resolve=>{waiting=resolve;});
  const source=new ReadableStream({pull(c){
    if(++pulls===1)c.enqueue(new Uint8Array([1,2,3]));
    else{waiting();return new Promise(()=>{});}
  },cancel(){cancelled++;}},{highWaterMark:0});
  const reader=new BoundedByteReader(source),read=reader.read(MIB);
  const rejected=assert.rejects(read,/stream_cancelled/);
  await pendingPull;await Promise.all([reader.cancel(),reader.cancel()]);await rejected;
  assert.equal(cancelled,1);assert.equal(pulls,2);
});
