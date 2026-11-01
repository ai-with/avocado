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
function deferred() {
  let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};
}
function owned(value,dispose) { Object.defineProperty(value,Symbol.dispose,{value:dispose});return value; }
const sourceBytes=()=>new ReadableStream({type:'bytes',start(c){c.enqueue(new Uint8Array([1,2,3]));c.close();}});
async function consume(source) { let n=0;for await(const bytes of source)n+=bytes.length;return n; }
function manifest() { return {v:1,generation:1,consentId:job.consentId,sourceEtag:job.sourceEtag,inputBytes:3,inputSha256:'a'.repeat(64),durationS:1,
  audio:{state:'none',proof:'complete_probe_and_video_decode_no_audio'},artifacts:[{name:'video.mp4',bytes:3,sha256:'b'.repeat(64)}],elapsedS:1}; }
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
test('proxy retains owned callbacks and DO result until success, busy or error; bindings are never disposed',async()=>{
  for(const mode of ['success','busy','error']) {
    const entered=deferred(),finish=deferred(),disposed={permit:0,sink:0,result:0,binding:0,namespace:0,fetcher:0};
    const permit=owned({async assertCurrent(){assert.equal(disposed.permit,0);}},()=>{disposed.permit++;});
    const sink=owned({async stage(_,stream){assert.equal(disposed.sink,0);assert.equal(await consume(stream),3);},
      async commit(){assert.equal(disposed.sink,0);},async retireUnselected(){}},()=>{disposed.sink++;});
    const raw=owned(mode==='busy'?{status:'busy'}:manifest(),()=>{disposed.result++;if(mode==='success')raw.artifacts[0].bytes=999;});
    const fetcher=owned({async prepare(received,source,p,s){
      assert.equal(received,job);assert.equal(p,permit);assert.equal(s,sink);entered.resolve();await finish.promise;
      if(mode==='error')throw Error('owned_forward_error');
      if(mode==='success'){await p.assertCurrent(job);await s.stage('video.mp4',source);await s.commit(raw);}
      else await source.cancel();
      return raw;
    },async cancel(){}},()=>{disposed.fetcher++;});
    const namespace=owned({getByName(){return fetcher;}},()=>{disposed.namespace++;});
    const env=owned({CONTAINERS:namespace},()=>{disposed.binding++;});
    const entry=new MediaPreparation({},env),pending=entry.prepare(job,sourceBytes(),permit,sink);
    const outcome=mode==='error'?assert.rejects(pending,/owned_forward_error/):pending;
    await entered.promise;await permit.assertCurrent(job);
    assert.deepEqual(disposed,{permit:0,sink:0,result:0,binding:0,namespace:0,fetcher:0});finish.resolve();
    const result=await outcome;
    if(mode!=='error') {
      assert.notEqual(result,raw);assert.equal(Symbol.dispose in result,false);
      if(mode==='success')assert.equal(result.artifacts[0].bytes,3);else assert.deepEqual(result,{status:'busy'});
    }
    await entry.cancel(job.jobId);
    assert.deepEqual(disposed,{permit:1,sink:1,result:mode==='error'?0:1,binding:0,namespace:0,fetcher:0});
  }
});
test('DO busy/error cleanup disposes only that invocation capabilities, preserving the current owner',async()=>{
  const s=storage(),boot=[],entered=deferred(),finish=deferred(),retiring=deferred(),retired=deferred();
  const disposed={currentPermit:0,currentSink:0,otherPermit:0,otherSink:0};
  const ctx={storage:s,blockConcurrencyWhile(fn){boot.push(fn());},container:{async destroy(){}}};
  const container=new MediaContainer(ctx,{});await Promise.all(boot);
  const permit=owned({async assertCurrent(){assert.equal(disposed.currentPermit,0);entered.resolve();await finish.promise;}},()=>{disposed.currentPermit++;});
  const sink=owned({async stage(){throw Error('unexpected_stage');},async commit(){throw Error('unexpected_commit');},
    async retireUnselected(){assert.equal(disposed.currentSink,0);retiring.resolve();await retired.promise;assert.equal(disposed.currentSink,0);}},()=>{disposed.currentSink++;});
  const first=container.prepare(job,sourceBytes(),permit,sink),rejected=assert.rejects(first,/owned_do_error/);await entered.promise;
  const before=s.snapshot();
  const busy=await container.prepare({...job,jobId:'22345678-1234-1234-1234-123456789abc'},sourceBytes(),
    owned({async assertCurrent(){throw Error('unexpected_other_permit');}},()=>{disposed.otherPermit++;}),
    owned({async stage(){throw Error('unexpected_other_stage');},async commit(){throw Error('unexpected_other_commit');},async retireUnselected(){throw Error('unexpected_other_retire');}},()=>{disposed.otherSink++;}));
  assert.deepEqual(busy,{status:'busy'});assert.deepEqual(s.snapshot(),before);
  assert.deepEqual(disposed,{currentPermit:0,currentSink:0,otherPermit:1,otherSink:1});
  finish.reject(Error('owned_do_error'));await retiring.promise;
  assert.deepEqual(disposed,{currentPermit:0,currentSink:0,otherPermit:1,otherSink:1});assert.deepEqual(s.snapshot(),before);
  retired.resolve();await rejected;
  assert.deepEqual(disposed,{currentPermit:1,currentSink:1,otherPermit:1,otherSink:1});assert.equal(s.snapshot().marker,undefined);
});
test('DO preserves callbacks through output EOF, container cleanup and app commit without disposing native process',async()=>{
  const s=storage(),boot=[],cleaning=deferred(),cleaned=deferred(),committing=deferred(),committed=deferred();
  const disposed={permit:0,sink:0,process:0,container:0};let destroys=0,running=false;
  const packet=value=>{const b=new Uint8Array(value.length+4);new DataView(b.buffer).setUint32(0,value.length);b.set(value,4);return b;};
  const runtime=owned({images:{base:'fake-image'},get running(){return running;},start(){running=true;},async setInactivityTimeout(){},signal(){},
    async destroy(){running=false;if(++destroys>1){cleaning.resolve();await cleaned.promise;}},
    async exec(_,options){await consume(options.stdin);
      const chunks=[packet(new TextEncoder().encode(JSON.stringify(manifest()))),packet(new Uint8Array([4,5,6])),packet(new Uint8Array()),packet(new Uint8Array())];
      return owned({stdout:new ReadableStream({type:'bytes',start(c){for(const chunk of chunks)c.enqueue(chunk);c.close();}}),
        stderr:new ReadableStream({type:'bytes',start(c){c.close();}}),exitCode:Promise.resolve(0),kill(){},output(){throw Error('buffered_output');}},()=>{disposed.process++;});
    }},()=>{disposed.container++;});
  const ctx={storage:s,container:runtime,blockConcurrencyWhile(fn){boot.push(fn());}},container=new MediaContainer(ctx,{});await Promise.all(boot);
  const permit=owned({async assertCurrent(){assert.equal(disposed.permit,0);}},()=>{disposed.permit++;});
  const sink=owned({async stage(_,stream){assert.equal(disposed.sink,0);assert.equal(await consume(stream),3);},
    async commit(){assert.equal(disposed.sink,0);committing.resolve();await committed.promise;assert.equal(disposed.sink,0);},async retireUnselected(){}},()=>{disposed.sink++;});
  const pending=container.prepare(job,sourceBytes(),permit,sink);await cleaning.promise;
  assert.deepEqual(disposed,{permit:0,sink:0,process:0,container:0});cleaned.resolve();await committing.promise;
  assert.deepEqual(disposed,{permit:0,sink:0,process:0,container:0});committed.resolve();assert.equal((await pending).inputBytes,3);
  assert.deepEqual(disposed,{permit:1,sink:1,process:0,container:0});assert.equal(s.snapshot().marker,undefined);
});
