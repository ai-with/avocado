import test from "node:test";
import assert from "node:assert/strict";
import { ContainerTransport } from "./container-transport.ts";
import { createMediaService } from "./private-rpc.mjs";
const job = { jobId:"12345678-1234-1234-1234-123456789abc", generation:1, consentId:"synthetic", sourceEtag:"immutable", declaredBytes:3 };
const bytes = value => new TextEncoder().encode(value);
const packet = data => { const p=new Uint8Array(4+data.length); new DataView(p.buffer).setUint32(0,data.length); p.set(data,4); return p; };
const empty = () => packet(new Uint8Array());
const input = () => new ReadableStream({type:"bytes",start(c){c.enqueue(new Uint8Array([1,2,3]));c.close();}});
const manifest = () => ({v:1,generation:1,consentId:"synthetic",sourceEtag:"immutable",inputBytes:3,inputSha256:"a".repeat(64),durationS:1,audio:{state:"none",proof:"complete_probe_and_video_decode_no_audio"},artifacts:[{name:"video.mp4",bytes:3,sha256:"b".repeat(64)}]});
const delay = ms => new Promise(resolve=>setTimeout(resolve,ms));
async function collect(stream) { let total=0; for await(const chunk of stream)total+=chunk.length; return total; }
function runtime(mode="normal",actualJob=job) {
  const events=[],inputFrames=[]; let done; let alive=false;
  return {events,inputFrames,images:{base:"fake-image"},get running(){return alive;},
    start(options){assert.equal(options.instance,"standard-2");assert.equal(options.enableInternet,false);assert.deepEqual(options.env,{});alive=true;events.push("start");},
    async setInactivityTimeout(ms){assert.ok(ms>5000);events.push("idle-policy");},
    signal(n){events.push("signal:"+n);done?.(137);},
    async destroy(){events.push("destroy");alive=false;done?.(137);},
    async exec(command,options){
      assert.deepEqual(command,["python3","/app/protocol.py"]); assert.equal(options.user,"65532:65532"); assert.deepEqual(Object.keys(options.env).sort(),["PYTHONDONTWRITEBYTECODE","TMPDIR"]);
      let size=0,first=true,eof=false;
      for await(const chunk of options.stdin) {
        const n=new DataView(chunk.buffer,chunk.byteOffset,chunk.byteLength).getUint32(0);assert.equal(chunk.length,n+4);size+=chunk.length;
        if(first){first=false;assert.equal(JSON.parse(new TextDecoder().decode(chunk.subarray(4))).declaredBytes,actualJob.declaredBytes);}
        else if(n)inputFrames.push(n);else eof=true;
      }
      assert.ok(size>actualJob.declaredBytes);assert.equal(eof,true);events.push("input-eof");
      const exitCode=new Promise(resolve=>{done=resolve;});
      const chunks=[packet(bytes(JSON.stringify({...manifest(),inputBytes:actualJob.declaredBytes}))),packet(new Uint8Array([4,5,6])),empty(),empty()];
      if(mode==="trailing")chunks.push(new Uint8Array([99]));
      if(mode==="missing-footer")chunks.pop();
      let index=0, sent=false;
      const stdout=new ReadableStream({type:"bytes",async pull(c){
        if(!sent && mode==="compute-delay"){sent=true;await delay(40);}
        if(["stall","ignore-term-stall"].includes(mode) && index===1){await new Promise(()=>{});return;}
        if(index<chunks.length){c.enqueue(chunks[index++]);return;}
        done(mode==="exit1"?1:0);c.close();
      },cancel(){events.push("stdout-cancel");if(mode!=="ignore-term-stall")done(137);}});
      const stderr=new ReadableStream({type:"bytes",start(c){if(mode==="stderr-overflow")c.enqueue(new Uint8Array(65537));c.close();},cancel(){events.push("stderr-cancel");}});
      return {stdin:null,stdout,stderr,pid:1,isPty:false,exitCode,kill(n){events.push("kill:"+n);if(mode!=="ignore-term-stall")done(143);},output(){throw new Error("buffered output forbidden");},resize(){throw new Error("pty forbidden");}};
    }};
}
function setup(mode="normal",options={}) {
  const c=runtime(mode),logs=[];let current=true,selected=false,staged=0,checks=0;
  const permit={async assertCurrent(){checks++;if(!current)throw new Error("withdrawn");}};
  const sink={async stage(name,stream){assert.equal(name,"video.mp4");await collect(stream);staged++;},async commit(){await permit.assertCurrent();selected=true;},async retireUnselected(){if(!selected)staged=0;}};
  const transport=new ContainerTransport(c,{totalMs:300,idleMs:80,graceMs:1,cleanupMs:30,log:record=>logs.push(record),...options});
  return {c,transport,logs,run:(source=input())=>createMediaService(transport).prepare(job,source,permit,sink),state:()=>({selected,staged,checks}),withdraw(){current=false;}};
}
test("native API options/stream framing, zero public ports, whole-container cleanup",async()=>{
  const s=setup();await s.run();assert.equal(s.state().selected,true);assert.ok(s.c.events.includes("destroy"));
});
test("last output waits for exit0/footer/EOF; all late failures prevent commit",async()=>{
  for(const mode of ["exit1","missing-footer","trailing","stderr-overflow"]){const s=setup(mode);await assert.rejects(s.run());assert.equal(s.state().selected,false);assert.equal(s.state().staged,0);assert.ok(s.c.events.includes("destroy"));}
});
test("compute time greater than IO idle is valid",async()=>{
  const s=setup("compute-delay",{idleMs:15});await s.run();assert.equal(s.state().selected,true);
});
test("stalled output is bounded and kills child namespace",async()=>{
  const s=setup("stall",{idleMs:20});await assert.rejects(s.run());assert.equal(s.state().selected,false);assert.ok(s.c.events.includes("destroy"));
});
test("one active job and explicit cancel, no cancellation of another job ID",async()=>{
  const s=setup("stall",{idleMs:200});const pending=s.run();await delay(5);
  await assert.rejects(s.transport.run(job,input(),{check:async()=>{},force:async()=>{},cancel(){}}),/container_busy/);
  await s.transport.cancel("different");assert.ok(!s.c.events.includes("destroy"));await s.transport.cancel(job.jobId);await assert.rejects(pending);assert.equal(s.state().selected,false);
});
test("total deadline applies even during quiet compute",async()=>{
  const s=setup("compute-delay",{totalMs:10,idleMs:200});await assert.rejects(s.run());assert.equal(s.state().selected,false);assert.ok(s.c.events.includes("destroy"));
});
test("ignored SIGTERM escalates to whole-container SIGKILL/destroy",async()=>{
  const s=setup("ignore-term-stall",{idleMs:20});await assert.rejects(s.run());
  assert.ok(s.c.events.includes("kill:15"));assert.ok(s.c.events.includes("signal:9"));assert.ok(s.c.events.includes("destroy"));assert.equal(s.state().selected,false);
});
test("fixed phase records distinguish completed transfer, quiet compute and final exit failure",async()=>{
  const normal=setup();await normal.run();
  assert.deepEqual(normal.logs.map(r=>r.event),["start_requested","input_eof","exec_ready","manifest","completed"]);
  assert.equal(normal.logs.find(r=>r.event==="input_eof").inputBytes,3);
  assert.equal(normal.logs.find(r=>r.event==="input_eof").phase,"compute");
  const quiet=setup("compute-delay",{totalMs:10,idleMs:200});await assert.rejects(quiet.run());
  assert.deepEqual(quiet.logs.filter(r=>r.event==="abort").map(r=>[r.phase,r.code,r.inputBytes]),[["compute","job_timeout",3]]);
  const late=setup("exit1");await assert.rejects(late.run());
  assert.deepEqual(late.logs.filter(r=>r.event==="abort").map(r=>[r.phase,r.code]),[["output","process_failed"]]);
  for(const record of [...normal.logs,...quiet.logs,...late.logs]) {
    assert.ok(Object.keys(record).every(k=>["event","phase","elapsedMs","inputBytes","code"].includes(k)));
    assert.ok(Number.isSafeInteger(record.elapsedMs)&&record.elapsedMs>=0);
  }
});
test("input stall and raw provider errors emit no identifiers; a failing logger cannot fail a job",async()=>{
  const stalled=setup("normal",{totalMs:10,idleMs:200});
  await assert.rejects(stalled.run(new ReadableStream({type:"bytes",start(c){c.enqueue(new Uint8Array([1,2,3]));}})));
  assert.equal(stalled.logs.some(r=>r.event==="input_eof"),false);
  assert.deepEqual(stalled.logs.filter(r=>r.event==="abort").map(r=>[r.phase,r.code,r.inputBytes]),[["input","job_timeout",3]]);
  const raw=setup();raw.c.exec=async()=>{throw Error("https://private.invalid/key?token=SECRET userId=private submissionId=private");};
  await assert.rejects(raw.run());
  assert.deepEqual(raw.logs.filter(r=>r.event==="abort").map(r=>[r.phase,r.code]),[["startup","container_preparation_failed"]]);
  assert.equal(/https|SECRET|private|userId|submissionId|sourceEtag|consentId|jobId/.test(JSON.stringify(raw.logs)),false);
  const unobservable=setup("normal",{log(){throw Error("logger unavailable");}});await unobservable.run();assert.equal(unobservable.state().selected,true);
});
test("607918275 virtual input bytes in 16KiB source chunks become exactly 580 native payload frames",async()=>{
  const total=607918275,MIB=1024**2,large={...job,declaredBytes:total};let sent=0,pulls=0,selected=false;
  const source=new ReadableStream({type:"bytes",pull(c){pulls++;const n=Math.min(16384,total-sent);if(!n){c.close();return;}sent+=n;c.enqueue(new Uint8Array(n));}});
  const c=runtime("normal",large),logs=[];
  const transport=new ContainerTransport(c,{totalMs:10000,idleMs:5000,log:r=>logs.push(r)});
  const permit={async assertCurrent(){}};
  const sink={async stage(_,stream){await collect(stream);},async commit(){selected=true;},async retireUnselected(){}};
  await createMediaService(transport).prepare(large,source,permit,sink);
  assert.equal(selected,true);assert.equal(sent,total);assert.equal(pulls,Math.ceil(total/16384)+1);
  assert.equal(c.inputFrames.length,Math.ceil(total/MIB));assert.equal(c.inputFrames.length,580);
  assert.equal(c.inputFrames.reduce((a,b)=>a+b,0),total);assert.ok(c.inputFrames.every(n=>n<=MIB));
  assert.equal(logs.find(r=>r.event==="input_eof").inputBytes,total);
});
test("batched input still rejects a one-byte truncation and one-byte excess before publish",async()=>{
  const MIB=1024**2,large={...job,declaredBytes:MIB+7};
  for(const delta of [-1,1]) {
    let remaining=large.declaredBytes+delta,selected=false;
    const source=new ReadableStream({type:"bytes",pull(c){const n=Math.min(257,remaining);if(!n){c.close();return;}remaining-=n;c.enqueue(new Uint8Array(n));}});
    const c=runtime("normal",large),transport=new ContainerTransport(c,{totalMs:1000,log(){}});
    await assert.rejects(createMediaService(transport).prepare(large,source,{async assertCurrent(){}},
      {async stage(_,stream){await collect(stream);},async commit(){selected=true;},async retireUnselected(){}}));
    assert.equal(selected,false);assert.ok(c.events.includes("destroy"));
  }
});
