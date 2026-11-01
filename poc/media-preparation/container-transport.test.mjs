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
function runtime(mode="normal") {
  const events=[]; let done; let alive=false;
  return {events,images:{base:"fake-image"},get running(){return alive;},
    start(options){assert.equal(options.enableInternet,false);assert.deepEqual(options.env,{});alive=true;events.push("start");},
    async setInactivityTimeout(ms){assert.ok(ms>5000);events.push("idle-policy");},
    signal(n){events.push("signal:"+n);done?.(137);},
    async destroy(){events.push("destroy");alive=false;done?.(137);},
    async exec(command,options){
      assert.deepEqual(command,["python3","/app/protocol.py"]); assert.equal(options.user,"65532:65532"); assert.deepEqual(Object.keys(options.env).sort(),["PYTHONDONTWRITEBYTECODE","TMPDIR"]);
      const size=await collect(options.stdin); assert.ok(size>job.declaredBytes); events.push("input-eof");
      const exitCode=new Promise(resolve=>{done=resolve;});
      const chunks=[packet(bytes(JSON.stringify(manifest()))),packet(new Uint8Array([4,5,6])),empty(),empty()];
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
  const c=runtime(mode);let current=true,selected=false,staged=0,checks=0;
  const permit={async assertCurrent(){checks++;if(!current)throw new Error("withdrawn");}};
  const sink={async stage(name,stream){assert.equal(name,"video.mp4");await collect(stream);staged++;},async commit(){await permit.assertCurrent();selected=true;},async retireUnselected(){if(!selected)staged=0;}};
  const transport=new ContainerTransport(c,{totalMs:300,idleMs:80,graceMs:1,cleanupMs:30,...options});
  return {c,transport,run:()=>createMediaService(transport).prepare(job,input(),permit,sink),state:()=>({selected,staged,checks}),withdraw(){current=false;}};
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
