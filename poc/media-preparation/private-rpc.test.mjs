import test from "node:test";
import assert from "node:assert/strict";
import { createMediaService, publicFetch, CAPS } from "./private-rpc.mjs";
const job = { jobId: "12345678-1234-1234-1234-123456789abc", generation: 1,
  consentId: "synthetic", sourceEtag: "immutable-local", declaredBytes: 3 };
const stream = (bytes) => new ReadableStream({ type: "bytes", start(c) { c.enqueue(new Uint8Array(bytes)); c.close(); } });
async function consume(source) { let size = 0; for await (const bytes of source) size += bytes.byteLength; return size; }
function setup(mode = "normal") {
  let current = true, selected = false, stages = 0, calls = 0;
  const permit = { async assertCurrent() { if (!current) throw new Error("withdrawn_or_generation_changed"); } };
  const sink = { async stage(name, source) { assert.equal(name, "video.mp4"); await consume(source); stages++;
      if (mode === "withdraw") current = false; },
    async commit() { await permit.assertCurrent(); selected = true; if (mode === "lost_ack") throw new Error("publish_unknown"); },
    async retireUnselected() { if (!selected) stages = 0; } };
  const executor = { async run(j, source) { calls++; await consume(source);
    return { manifest: { v: 1, generation: j.generation, consentId: j.consentId, sourceEtag: j.sourceEtag,
      inputBytes: j.declaredBytes, inputSha256: "a".repeat(64), durationS: 1,
      audio: mode === "ambiguous" ? { state: "none", proof: "decode_failed" }
        : { state: "none", proof: "complete_probe_and_video_decode_no_audio" },
      artifacts: [{ name: "video.mp4", bytes: mode === "partial" ? 5 : 3, sha256: "b".repeat(64) }] },
      outputs: { "video.mp4": stream([4, 5, 6]) } }; } };
  return { run: (j = job, input = stream([1, 2, 3])) => createMediaService(executor).prepare(j, input, permit, sink),
    state: () => ({ current, selected, stages, calls }) };
}
test("all public HTTP paths return 404", () => {
  for (const method of ["GET", "POST", "PUT", "DELETE"]) assert.equal(publicFetch(new Request("https://unused.test/debug", { method })).status, 404);
});
test("only exact input and two named capabilities; no arbitrary URL/key", async () => {
  const s = setup(); await assert.rejects(s.run({ ...job, sourceUrl: "https://blocked.invalid" }), /job_invalid/);
  await assert.rejects(s.run({ ...job, declaredBytes: CAPS.inputBytes + 1 }), /job_invalid/);
  assert.equal(s.state().calls, 0); await s.run(); assert.equal(s.state().selected, true);
});
test("unknown/truncated input and incomplete output never publish", async () => {
  const short = setup(); await assert.rejects(short.run(job, stream([1])), /stream_incomplete/); assert.equal(short.state().selected, false);
  const partial = setup("partial"); await assert.rejects(partial.run(), /stream_incomplete/); assert.equal(partial.state().stages, 0);
});
test("decode failure cannot become no-audio", async () => {
  const s = setup("ambiguous"); await assert.rejects(s.run(), /audio_unavailable/); assert.equal(s.state().selected, false);
});
test("withdrawal/generation CAS between transfer and commit retires staged only", async () => {
  const s = setup("withdraw"); await assert.rejects(s.run(), /withdrawn_or_generation_changed/); assert.deepEqual(s.state(), { current: false, selected: false, stages: 0, calls: 1 });
});
test("lost publish acknowledgement preserves already selected artifact", async () => {
  const s = setup("lost_ack"); await assert.rejects(s.run(), /publish_unknown/); assert.equal(s.state().selected, true); assert.equal(s.state().stages, 1);
});
test("2GiB virtual byte stream bounds remote permits to cadence plus boundaries", async () => {
  let remaining=CAPS.inputBytes,clock=0,calls=0,selected=false,maxChunk=0;
  const large={...job,declaredBytes:CAPS.inputBytes};
  const virtual=new ReadableStream({type:"bytes",pull(c){
    if(!remaining){c.close();return;}
    const n=Math.min(CAPS.chunkBytes,remaining);remaining-=n;clock+=239000/(CAPS.inputBytes/CAPS.chunkBytes);maxChunk=Math.max(maxChunk,n);c.enqueue(new Uint8Array(n));
  }});
  const permit={async assertCurrent(){calls++;}};
  const executor={async run(j,source){let count=0;for await(const bytes of source)count+=bytes.length;assert.equal(count,CAPS.inputBytes);
    return {manifest:{v:1,generation:j.generation,consentId:j.consentId,sourceEtag:j.sourceEtag,inputBytes:j.declaredBytes,inputSha256:"a".repeat(64),durationS:180,audio:{state:"present",sampleRate:16000,durationS:180},artifacts:[{name:"audio.wav",bytes:3,sha256:"c".repeat(64)},{name:"video.mp4",bytes:3,sha256:"b".repeat(64)}]},outputs:{"audio.wav":stream([7,8,9]),"video.mp4":stream([1,2,3])}};}};
  const sink={async stage(_,source){await consume(source);},async commit(){selected=true;},async retireUnselected(){}};
  await createMediaService(executor,{now:()=>clock}).prepare(large,virtual,permit,sink);
  assert.equal(selected,true);assert.equal(maxChunk,1024**2);assert.ok(calls<=28);assert.ok(calls>=20);
});
