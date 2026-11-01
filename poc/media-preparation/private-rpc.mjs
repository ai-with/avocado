/** Private service contract. No URL, bucket key, API token, or master secret input.
 * executor.run is injected: the native Container DO implements it; tests fake the
 * Cloud API. Nothing is deployed. The app owns permit and sink RpcTargets.
 */
export const CAPS = Object.freeze({ inputBytes: 2 * 1024 ** 3, durationS: 180,
  videoBytes: 64 * 1024 ** 2, audioBytes: 6 * 1024 ** 2, chunkBytes: 1024 ** 2 });

export function publicFetch() { return new Response(null, { status: 404 }); }
const fail = (code) => { throw new Error(code); };
const exactKeys = (value, keys) => value && typeof value === "object"
  && Object.keys(value).sort().join() === [...keys].sort().join();

function countedStream(source, cap, expected, check, completed) {
  const reader = source.getReader(); let total = 0;
  return new ReadableStream({ type: "bytes",
    async pull(controller) {
      try {
        await check(); const item = await reader.read();
        if (item.done) {
          if (total !== expected) fail("stream_incomplete");
          completed(); reader.releaseLock(); controller.close(); return;
        }
        if (!(item.value instanceof Uint8Array) || item.value.byteLength > CAPS.chunkBytes) fail("stream_chunk_limit");
        total += item.value.byteLength;
        if (total > cap || total > expected) fail("stream_size_limit");
        controller.enqueue(item.value);
      } catch (error) {
        await reader.cancel().catch(() => {}); controller.error(error);
      }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
}

function validateManifest(manifest, job, outputs) {
  if (!manifest || manifest.v !== 1 || manifest.generation !== job.generation
    || manifest.consentId !== job.consentId || manifest.sourceEtag !== job.sourceEtag
    || manifest.inputBytes !== job.declaredBytes || !/^[a-f0-9]{64}$/.test(manifest.inputSha256)
    || !Number.isFinite(manifest.durationS) || manifest.durationS <= 0 || manifest.durationS > CAPS.durationS
    || !Array.isArray(manifest.artifacts)) fail("manifest_incomplete");
  const audio = manifest.audio;
  if (!audio || !["present", "none"].includes(audio.state)) fail("audio_unavailable");
  if (audio.state === "none" && audio.proof !== "complete_probe_and_video_decode_no_audio") fail("audio_unavailable");
  if (audio.state === "present" && (audio.sampleRate !== 16000 || !Number.isFinite(audio.durationS)
    || audio.durationS <= 0 || audio.durationS > CAPS.durationS + .1)) fail("audio_unavailable");
  const names = audio.state === "present" ? ["audio.wav", "video.mp4"] : ["video.mp4"];
  if (manifest.artifacts.length !== names.length || !exactKeys(outputs, names)) fail("output_not_allowed");
  const seen = new Set();
  for (const item of manifest.artifacts) {
    const cap = item.name === "audio.wav" ? CAPS.audioBytes : CAPS.videoBytes;
    if (!names.includes(item.name) || seen.has(item.name) || !Number.isSafeInteger(item.bytes)
      || item.bytes <= 0 || item.bytes > cap || !/^[a-f0-9]{64}$/.test(item.sha256)) fail("output_not_allowed");
    seen.add(item.name);
  }
}

export function createMediaService(executor, { now = Date.now, cadenceMs = 10000, permitTimeoutMs = 5000 } = {}) {
  return { async prepare(job, source, permit, sink) {
    if (!exactKeys(job, ["jobId", "generation", "consentId", "sourceEtag", "declaredBytes"])
      || !/^[a-f0-9-]{36}$/.test(job.jobId) || !Number.isSafeInteger(job.generation) || job.generation < 0
      || typeof job.consentId !== "string" || !job.consentId || job.consentId.length > 100
      || typeof job.sourceEtag !== "string" || !job.sourceEtag || job.sourceEtag.length > 200
      || !Number.isSafeInteger(job.declaredBytes) || job.declaredBytes <= 0 || job.declaredBytes > CAPS.inputBytes) fail("job_invalid");
    job = Object.freeze({ ...job });
    let last = -Infinity, pending = null, cancelled = false;
    const check = (force = false) => {
      if (cancelled) return Promise.reject(new Error("job_cancelled"));
      if (pending) return pending;
      if (!force && now() - last < cadenceMs) return Promise.resolve();
      last = now();
      let timer;
      pending = Promise.race([Promise.resolve().then(() => permit.assertCurrent(job)),
        new Promise((_, no) => { timer = setTimeout(() => no(new Error("permit_timeout")), permitTimeoutMs); })])
        .finally(() => { clearTimeout(timer); pending = null; });
      return pending;
    };
    const gate = { check: () => check(), force: () => check(true), cancel() { cancelled = true; } };
    let inputComplete = false;
    try {
      await check(true);
      const input = countedStream(source, CAPS.inputBytes, job.declaredBytes, check, () => { inputComplete = true; });
      const result = await executor.run(job, input, gate);
      if (!inputComplete) fail("input_incomplete");
      validateManifest(result.manifest, job, result.outputs);
      for (const metadata of result.manifest.artifacts) {
        await check(true); let complete = false;
        const cap = metadata.name === "audio.wav" ? CAPS.audioBytes : CAPS.videoBytes;
        await sink.stage(metadata.name,
          countedStream(result.outputs[metadata.name], cap, metadata.bytes, check, () => { complete = true; }), metadata);
        if (!complete) fail("output_incomplete");
      }
      await result.finished;
      await check(true);
      // Sink commits under its OWN atomic consent/generation/source identity CAS.
      // A lost ACK is uncertain: retirement must never erase a selected result.
      await sink.commit(result.manifest);
      return result.manifest;
    } catch (error) {
      gate.cancel();
      await executor.cancel?.(job.jobId).catch(() => {});
      await sink.retireUnselected().catch(() => {});
      throw error;
    }
  } };
}
