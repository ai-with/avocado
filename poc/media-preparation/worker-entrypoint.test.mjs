import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Exercise the actual entrypoint/DO orchestration with only the platform bases
// replaced. The real JobOwnership and ContainerTransport are imported normally.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { shortCircuit: true,
    url: 'data:text/javascript,' + encodeURIComponent(`
      class Base { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }
      export class DurableObject extends Base {}
      export class WorkerEntrypoint extends Base {}
    `) };
  return next(specifier, context);
} });
const { MediaContainer, MediaPreparation } = await import('./worker-entrypoint.ts');
const job = { jobId: '12345678-1234-1234-1234-123456789abc', generation: 1,
  consentId: 'synthetic', sourceEtag: 'local-immutable', declaredBytes: 3 };
function storage() {
  let marker, alarm = null;
  const tx = { async get() { return marker; }, async put(_, value) { marker = structuredClone(value); },
    async delete() { marker = undefined; }, async setAlarm(value) { alarm = value; }, async deleteAlarm() { alarm = null; } };
  return { get: tx.get, async transaction(fn) { return fn(tx); },
    snapshot: () => ({ marker: structuredClone(marker), alarm }) };
}
test('healthy singleton contention is an explicit busy result without touching owner or capabilities', async () => {
  const s = storage(), boot = []; let starts = 0, destroys = 0, execs = 0;
  const ctx = { storage: s, blockConcurrencyWhile(fn) { boot.push(fn()); },
    container: { async destroy() { destroys++; }, start() { starts++; }, async exec() { execs++; throw Error('unexpected_exec'); } } };
  const container = new MediaContainer(ctx, {}); await Promise.all(boot);
  let entered, finish;
  const ready = new Promise(resolve => { entered = resolve; });
  const hold = new Promise((_, reject) => { finish = reject; });
  const first = container.prepare(job, new ReadableStream({ type: 'bytes' }),
    { async assertCurrent() { entered(); await hold; } },
    { async stage() { throw Error('unexpected_stage'); }, async commit() { throw Error('unexpected_commit'); }, async retireUnselected() {} });
  const firstRejected = assert.rejects(first, /owned_test_stop/);
  await ready;
  const before = s.snapshot(), beforeDestroys = destroys;
  let reads = 0, cancels = 0, permits = 0, sinks = 0;
  const source = new ReadableStream({ type: 'bytes', pull() { reads++; }, cancel() { cancels++; } });
  const entrypoint = new MediaPreparation({}, { CONTAINERS: { getByName(name) {
    assert.equal(name, 'media-preparation-singleton-v1'); return container;
  } } });
  const result = await entrypoint.prepare({ ...job, jobId: '22345678-1234-1234-1234-123456789abc' }, source,
    { async assertCurrent() { permits++; } },
    { async stage() { sinks++; }, async commit() { sinks++; }, async retireUnselected() { sinks++; } });
  assert.deepEqual(result, { status: 'busy' });
  assert.equal(reads, 0); assert.equal(cancels, 1); assert.equal(permits, 0); assert.equal(sinks, 0);
  assert.equal(starts, 0); assert.equal(execs, 0); assert.equal(destroys, beforeDestroys);
  assert.deepEqual(s.snapshot(), before);
  finish(Error('owned_test_stop')); await firstRejected;
  assert.equal(s.snapshot().marker, undefined); assert.equal(s.snapshot().alarm, null);
  // A retry after release reaches its own permit, rather than remaining busy.
  let retryPermit = 0;
  await assert.rejects(entrypoint.prepare(job, new ReadableStream({ type: 'bytes' }),
    { async assertCurrent() { retryPermit++; throw Error('retry_acquired'); } },
    { async stage() {}, async commit() {}, async retireUnselected() {} }), /retry_acquired/);
  assert.equal(retryPermit, 1); assert.equal(s.snapshot().marker, undefined);
});
