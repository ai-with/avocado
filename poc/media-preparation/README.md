# 379/380 local media preparation POC

Private Worker/Container media preparation for AIWITH-379/380. Compute, the
app-owned adapter and operational activation are separate concerns. Local Docker,
Workerd RPC and synthetic-media checks passed. These compute checks created no
Cloud resource, subscription or credential and used no real AI, Meta, SMS, email
or browser. Cloud processing time and production behavior remain **unmeasured**.
This directory supplies separate local and private production configurations.
Operational activation is performed separately by Root.

## What runs locally

```sh
python3 -B poc/media-preparation/test_runner.py --report poc/media-preparation/results.json
python3 -B poc/media-preparation/test_protocol.py
node --experimental-strip-types --test poc/media-preparation/*.test.mjs
```

The native tests generate one-second 320×180 H.264 MP4s with a sine audio track,
a silent audio track, and no audio track. A 600MiB MP4 `free` box is sparse/zero
padding around that tiny movie. It verifies >500MiB streaming and cleanup only.
**It is not a real high-entropy 500MiB movie benchmark or a Cloud latency estimate.**
`results.json` records actual local Python/FFmpeg versions, ARM host, sizes and times.
No input/output movie is retained in the worktree by the tests.

Manual LOCAL file invocation (output directory is operator-owned, never R2):

```sh
python3 -B poc/media-preparation/runner.py \
  --input /path/to/synthetic.mp4 --declared-bytes BYTE_COUNT --output-dir /tmp/media-poc-output
```

The Docker image defaults to idle `sleep infinity`; it is not a CLI ENTRYPOINT.
For a direct local protocol test, override explicitly with
`docker run --rm -i --network none --entrypoint python3 LOCAL_IMAGE /app/protocol.py`
and send the framed owned-synthetic input. A direct runner invocation similarly
uses `--entrypoint python3 LOCAL_IMAGE /app/runner.py ...` with only Root's owned
test output arrangement. The private DO continues to use fixed `exec()` argv.

The standalone named WorkerEntrypoint was typechecked with repository-pinned
TypeScript `7.0.2` / Workers types `5.20261014.1`; Node tests use built-in APIs.
The exact host FFmpeg/ffprobe tested is `8.1.1`, Python `3.13.3`.
The Docker recipe pins FFmpeg `8.1.1` and the SHA256 of its official source archive.
The official 11,709,440-byte tarball was streamed once to calculate that checksum.
The image was built locally for Linux/amd64. The release recipe now pins the
official Python manifest digest supplied/reviewed by Root; the earlier local
proof used the same version tag. OS/x264 package versions are not frozen. Record
the final built image digest for each release. Local Linux limits were tested;
actual Cloud resource enforcement remains unmeasured.

The build context is this POC directory, with a deny-by-default `.dockerignore`
allowing only the Dockerfile and its two Python sources. Never use repository-root
context. Local build command:

```sh
docker build --platform linux/amd64 -f poc/media-preparation/Dockerfile \
  -t avocado-media-poc:local poc/media-preparation
```

## Data path and fixed limits

1. The existing application remains the only owner of R2/D1 and originals.
   It passes a byte stream and an opaque generation/consent/source-ETag identity
   through a private Service Binding RPC. No arbitrary URL, object key, bucket
   credential, API token, or `TOKEN_ENC_KEY` enters compute.
2. Input is counted in chunks of at most 1MiB and spooled to a private seekable
   temporary file. Limit is **2GiB (2×1024³ bytes), 180 seconds of media**, matching
   `src/shared/guides.ts`. Full input buffering and `tee()` are avoided. Seekable
   disk is necessary for MP4 metadata at the end; this is streamed spooling, not
   a promise that arbitrary MP4 can be decoded from a non-seekable pipe.
3. ffprobe uses at most 8MiB probe buffering, 5 seconds analysis, 2,500 probe
   packets, 64KiB output and a 10-second process deadline. These are probing
   budgets, **not a guarantee it reads only 8MiB of the whole file**. Output must
   contain duration, physical size and a complete unique stream list matching
   `nb_streams`. One video, zero/one audio, ≤4096×4096, ≤60fps, ≤8 audio channels,
   and ≤192kHz input audio are accepted. Unknown/unsupported layouts fail closed.
4. Audio becomes 16kHz mono signed-16-bit WAV, ≤6MiB (180 seconds is about
   5.76MB), compatible with `storeAudio` and the current ≤30MiB audio route.
   Silent samples with an audio track stay **present**. Probe/decode failure,
   incomplete JSON, truncation and timeout are never reported as no audio.
   No-audio is returned only after a complete zero-audio probe and successful
   full video decode/derived-output verification.
5. Video becomes H.264/AAC MP4 in a ≤1280×720 box, 30fps, ≤64MiB. Target maximum
   video rate is 2.4Mbps and AAC 96kbps; output duration and dimensions are probed.
   Tiny/already optimized originals can yield a larger derivative: local results
   make no universal size-reduction claim. The original bytes are never replaced.
6. Each FFmpeg process is bounded to 180 seconds; CLI total deadline is 240 seconds
   (media duration and processing time are separate limits). Logs are bounded and
   exceptions expose fixed codes. Linux children have 768MiB address-space and
   output-file limits. Probe/decoder/encoder and simple/complex filter pools are
   explicitly one thread. Root's first actual Linux 1GiB/PIDs64 run exposed
   unbounded default filter threads despite codec `-threads 1`; the bounded Linux
   before/after rerun is the regression evidence, not a flag-string unit test.
   Linux child env fixes `MALLOC_ARENA_MAX=2`: after filter bounding, Root observed
   glibc virtual-arena exhaustion under the same 768MiB AS/1GiB Docker/PIDs64.
   An owned 594,520,009-byte diagnostic passed in 23.993s with this allocator
   control alone. Root then rebuilt the normal Linux/amd64 image and verified
   both owned fixtures under the same limits: FFV1 26.893s and MP4 56.143s, exact
   input/output hashes, footer/EOF and exit0, no diagnostic override.
   No memory, address-space or PID limit was loosened.
   Input, WAV and MP4 use private temporary paths and clean up
   on success, exception, withdrawal, generation change and SIGTERM/SIGALRM.
   SIGKILL/host loss cannot run `finally`; a future container supervisor must stop
   the per-job instance and deal with stale job directories before reuse.

## Private contract and privacy fence

`worker-entrypoint.ts` exports a named `MediaPreparation` WorkerEntrypoint; every
public HTTP fetch returns 404. `private-rpc.mjs` permits only the exact job shape
and the two named outputs `audio.wav`/`video.mp4`. RPC input/output is size counted;
unknown or incomplete manifests are rejected. The application supplies an
authoritative permit and staged-output sink capability, not general bucket access.
Output staging must register exact immutable keys in the application's durable
purge ledger **before** R2 PUT. Its commit must repeat consent/generation/source
identity checks in the same native D1 batch as selecting the result. Retirement
must preserve an already selected result after a lost acknowledgement.

The local fake publishers test revoke/change between transfer and commit, missing
output, truncated input, ambiguous audio, and lost commit acknowledgement. Native
tests prove the input SHA256 remains identical and temporary files are removed.
They do not prove a real Cloud D1/R2 transaction or provider erasure latency.

### Concrete native Container transport

The private entrypoint routes to one constant DO name. That DO uses
`container-transport.ts` and the built-in `ctx.container` API, with no new SDK
dependency. `start()` receives the configured digest reference, `enableInternet:
false`, empty env, and **standard-1 (½vCPU/4GiB/8GB)**. The pinned native API and
official scheduling-policy contract do not accept `basic`; no cast bypasses that.
The durable-object policy has no `max_instances` limit, so the single route and
per-DO lease/busy ownership enforce one job for this private application path.

`exec()` starts fixed `python3 /app/protocol.py`, with explicitly selected env,
stdin/stdout/stderr pipes and no HTTP port or shell. The binary protocol carries
a ≤4KiB job header and ≤1MiB chunks; zero terminators plus actual EOF are required.
Python validates input size and the same FFmpeg rules above. Output begins with
a ≤16KiB manifest; each named artifact has bounded chunks and a zero terminator.
The **last output does not close** until a final zero, stdout EOF, bounded stderr,
process exit 0 and complete Container teardown are known. Late exit1, missing
footer, trailing bytes and stderr overflow prevent app commit.

Authoritative permit RPC is cached for a fixed 10-second cadence, plus forced
start/stage/commit boundaries (≤28 callback checks over a 240-second/two-output
job; a virtual 2GiB test verifies this without a 2GiB allocation). Every chunk
still checks local cancellation and byte bounds. Service observation is the
10-second cadence plus the 5-second permit deadline and scheduling. The separate
app adapter caches DB authority for 20 seconds, so combined observation is
conservatively up to 20+10+5 seconds plus scheduling. Final app commit must always
use its own uncached atomic CAS.

I/O stalls are bounded to 15 seconds, while quiet FFmpeg compute has the full
240-second job budget. Python I/O timers disarm back to the total deadline during
compute. Container inactivity is set to job+cleanup+5 seconds, not a risky 5-second
compute timeout. Explicit cancellation requests SIGTERM, escalates to whole-
container SIGKILL/destroy, and cancels source/readers. No process `output()` call
buffers a movie. RPC disconnect itself is not a request abort signal: explicit
`cancel(jobId)`, permit failure, local watchdogs and a persisted DO alarm bound it.

`job-ownership.ts` is the actual DO coordinator: unique lease token, one cleanup
promise, and transactional token-CAS marker/alarm deletion. Alarm→new job→old
finally is tested to preserve the new marker, alarm, busy owner and container.
Unknown teardown retains a dirty lease and blocks new jobs instead of guessing
that an old writer stopped. A rejected cleanup promise stays rejected: alarm
re-entry does not blindly retry it. DO recreation/recovery is required to destroy
the orphan before new work. This is a deliberate availability limitation.
Container snapshots/FUSE are never used. The next instance starts from its image;
protocol startup additionally sweeps only its private stale directory prefix.
Cloud physical erase timing and DO restart/alarm behavior are not measured here.

The runtime API's `user` option is **not a security sandbox** with the
durable-object policy. The boundaries are the isolated VM, no credentials or
resource bindings in the image, no Internet, exact input/output capabilities,
and the app's atomic selection/purge checks.

Native SDK support was checked in repository-pinned workers-types
`5.20261014.1` (`Container`/`ExecProcess`, index.d.ts 3958–4000) and strict TS passed.
The native options/methods are typed; wire JSON is runtime-validated. Actual
Cloud exec/pipe semantics, alarms and resource enforcement remain untested.

The current pipeline already has consent/purge fencing, analysis generations and
15-minute claims (`pipeline/analysis.ts`), immutable audio writes plus retirement
(`lib/audio-write.ts`), and a three-minute wait for browser analysis (`pipeline/run.ts`).
The current 500MiB limit is browser audio decode memory, separate from the existing
2GiB upload allowance. A later integration needs a preparation job/claim before
STT, reuse of `storeAudio`, and a separate compressed-artifact selection/ledger.
`validMediaKey`, withdrawal enumeration, retirement and orphan cleanup must be
extended together before a compressed key is accepted. No production schema or
pipeline change is included here. Browser frame extraction is also unchanged.
In particular, inserting server audio rotates the analysis generation; it cannot
be bolted into an old claim as if that claim remained current. Preparation must
settle before STT claims its fresh generation, and must not race the existing
three-minute browser-analysis wait.

## Current official options, reviewed 2026-11-01

| Option | Fit and limits | Cost/control consequence |
|---|---|---|
| Stream MP4 + M4A | Upload <30GB; asynchronously generate `default` MP4 and `audio` M4A, then poll ready. Input original cannot be downloaded exactly. | Storage prepaid $5/month per 1,000 stored minutes; delivery $1/1,000 minutes. MP4 download delivery is billed; M4A-specific billing is not explicitly described on the cited pricing page. |
| Containers + FFmpeg | `basic`: ¼vCPU, 1GiB RAM, 4GB disk; `lite`'s 2GB disk cannot hold a full 2GiB spool plus image/output. Linux/amd64 image required. | Workers Paid required. Included 25GiB-hours memory, 375vCPU-minutes and 200GB-hours disk; overage $0.0000025/GiB-second, $0.000020/vCPU-second, $0.00000007/GB-second. Workers/DO/logs/network are additional. |

Stream would add a provider video UID and copies requiring signed access and a
durable deletion/retry ledger. It has documented video-and-copies deletion; merely
deleting a download is insufficient. M4A would still need conversion for the
current WAV consumer. Containers better match deterministic WAV/MP4 parameters
and existing R2 originals, at the cost of owning process isolation and lifecycle.
No published Cloud encoding-time SLA was used to claim a three-minute completion.

Container outbound-handler request bodies currently default to **100MiB**.
The proposed 64MiB video and 6MiB WAV fit individually; an original transfer via
such a path needs bounded multipart/chunk requests. Workers RPC supports byte
streams beyond its ordinary 32MiB serialized-value limit. Neither fact proves
the eventual Worker→Container bridge can carry 2GiB unchanged: that transport
uses ≤1MiB native exec stdin/stdout frames rather than that HTTP outbound path.
The concrete bridge has local native-protocol and fake-API tests, but the Cloud
streaming path is unmeasured; never expose an HTTP bypass.
Future container policy must set `enableInternet=false`, one active job/instance,
short idle stop, no rootfs secrets, no bucket mount, and no unrestricted outbound
proxy. The POC image has idle PID1 plus supervised CLIs, no private-port server.

Illustration only: a fully busy `basic` instance for 180 seconds would have
45 vCPU-seconds, 180GiB-seconds and 720GB-seconds: about **$0.0014004** overage
before allowances, startup/idle time, network, Workers, DO, logs and storage.
That `basic` figure is only a separate legacy-policy measurement candidate.
The **actual native prototype standard-1** at 180 seconds/full allocated CPU is
90vCPU-seconds +720GiB-seconds +1,440GB-seconds, or **$0.0037008** compute overage.
Both are rate calculations, **not measured runtime, per-job pricing, or a budget**.
Actual Cloud cold-start, transfer throughput, CPU throttling, peak memory, failure
rate, processing duration and billing remain unmeasured. Root subsequently verified
the existing account's Containers entitlement and standard-1 capacity through
read-only management GETs; no new plan, subscription or grants were created.

Primary references:

- [Stream download MP4/M4A](https://developers.cloudflare.com/stream/viewing-videos/download-videos/), [Stream pricing](https://developers.cloudflare.com/stream/pricing/), [Stream limits/original FAQ](https://developers.cloudflare.com/stream/faq/), [delete video and copies](https://developers.cloudflare.com/api/resources/stream/methods/delete/)
- [Containers pricing](https://developers.cloudflare.com/containers/platform/pricing/), [limits](https://developers.cloudflare.com/containers/platform/limits/), [outbound controls](https://developers.cloudflare.com/containers/configuration/outbound-traffic/), [Container setup/amd64](https://developers.cloudflare.com/containers/get-started/)
- [private Service Binding RPC](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/rpc/), [byte-stream RPC](https://developers.cloudflare.com/workers/runtime-apis/rpc/), [ffprobe official options](https://www.ffmpeg.org/ffprobe-all.html), [FFmpeg source releases](https://www.ffmpeg.org/releases/)
- [native Container API](https://developers.cloudflare.com/containers/api/durable-object-container/), [scheduling policy/basic limitations](https://developers.cloudflare.com/containers/configuration/scheduling-policy/), [local development](https://developers.cloudflare.com/containers/guides/local-dev/)

## Operational activation checks

- Cloud validation of the concrete native supervisor, including deployed
  disconnect/alarm/restart/teardown failures. Local Workerd RPC passed; these
  checks created no Cloud resources.
- App-owned atomic sink/consent-generation handling; no public debug route or
  shared master key. The application adapter is a separate integration task.
- Compressed-media manifest and exact-key purge integration, coexistence with
  browser audio, timeout/retry policy and immutable request identities.
- Real, licensed high-entropy >500MiB/2GiB edge samples and Cloud measurements.
- Review operational capacity, cost controls, deploy diff, final image digest,
  permissions and rollback. The existing Containers entitlement is verified;
  actual Cloud behavior and consumption still need bounded validation.

Separate Root-owned native measurements now also cover actual high-entropy
synthetic data: a 594,520,009-byte three-second 1080p FFV1+sine clip (15.021s ARM),
and a 607,918,275-byte thirty-second 1080p H.264/AAC clip (44.634s ARM). Original
SHA256 remained unchanged and derived hashes were checked. These are local
decode/transfer fixtures, not representative three-minute workloads or Cloud
benchmarks. Root retains their detailed evidence outside git.
Normal Linux/amd64 image runs subsequently passed both cases with network off,
no host mounts, Docker memory 1GiB/PIDs64 and child AS768MiB. These remain local
ARM-host/emulated-amd64 observations, not deployed Cloud timing or three-minute
capacity/performance evidence.

## Private production deploy and rollback

`wrangler.production.json` targets only `avocado-media-preparation` in the reviewed
account. It has no route, workers.dev/preview URL, secrets, R2/D1 bindings, outbound
proxy or HTTP probe. Both Worker and Container logs are disabled. The public
fetch handlers return 404. The application's separate Service Binding must select
the named `MediaPreparation` entrypoint; application config is managed by Root.

The native `durable_object` policy uses a SQLite export and named image `base`.
Do not add `max_instances`: this policy does not accept that control. The constant
DO name and ownership lease serialize this entrypoint's work. `ContainerTransport`
fixes standard-1, `enableInternet:false`, fixed exec argv and empty runtime env;
these are code controls, not implied by the Wrangler defaults. No normal HTTP
request can start a job.

From the release worktree root, use the repository-pinned Wrangler **4.151.0** CLI
and the dedicated Docker context. `MEDIA_WRANGLER_CLI` below is the absolute path
to that installed `node_modules/wrangler/wrangler-dist/cli.js` (the release worktree
may share the installation from the primary checkout):

```sh
node "$MEDIA_WRANGLER_CLI" deploy --dry-run \
  --config poc/media-preparation/wrangler.production.json \
  --outdir /tmp/OWNED-MEDIA-DRYRUN
```

This dry-run validates/bundles Worker configuration and can build a **local**
Docker image, but does not push/deploy to Cloudflare. The release configuration
passed Wrangler 4.151.0 dry-run; its dedicated image build reused the reviewed
compiler/runtime layers and Wrangler removed its temporary image tag. This does
not validate deployed Cloud execution. Root separately records the final
Linux/amd64 registry image digest, Worker version, git
revision and effective config. The Python base now pins manifest
`sha256:56a11364ffe0fee3bd60af6d6d5209eba8a99c2c16dc4c7c5861dc06261503cc`;
changing a FROM reference may rebuild the compiler layer. The compiler recipe and
verified FFmpeg source hash are unchanged. Debian/x264 dependencies still resolve
at build time, so preserve the resulting image digest for an exact rollback.

Root's actual deployment command, after review, is:

```sh
node "$MEDIA_WRANGLER_CLI" deploy \
  --config poc/media-preparation/wrangler.production.json
```

Keep application scheduling disabled until private compute deployment and a
bounded owned-synthetic Service Binding check succeed. No public probe or
additional HTTP authentication route is needed. First provision can take minutes;
CLI success alone is not evidence of media processing. Record input/output hashes,
limits and elapsed time separately; local timings above are not Cloud timings.

For rollback, first stop new preparation claims through Root's reviewed application
rollback. Cancel known active job IDs through the existing private RPC and confirm
teardown; an uncertain owner stays blocked for recovery. Do not delete its DO
storage, application staged-object/purge ledger or originals to clear a failure.
For a later compute release, redeploy the last verified compute code/config with
its exact saved managed-registry image digest in `images.base.image` instead of
rebuilding a historical Dockerfile against mutable OS packages. Review/dry-run
that complete combination before deploying it. Native-policy containers select
their image in `start()`; application-wide rollout flags are not its rollback
mechanism. A Worker-only version rollback is insufficient evidence that the
intended image was selected. On this first compute release there is no older
compute version: keep the app disabled while repairing the deployment.

Sources: [native scheduling policy](https://developers.cloudflare.com/containers/configuration/scheduling-policy/),
[image selection and rollout scope](https://developers.cloudflare.com/containers/configuration/rollouts/),
[deployment behavior](https://developers.cloudflare.com/containers/guides/deploy/).
No Cloud deploy or image push was performed when preparing this configuration.

## Optional Root-only local Service Binding smoke

`wrangler.local.example.json` is **local-only**, no account ID, remote bindings,
R2, D1, secrets or public worker URL. Do not deploy it. It is compatible with
Wrangler `4.151.0` (official local native-policy minimum is `4.136.0`). Root may
run the exact pinned CLI with `dev --local --ip 127.0.0.1 -c` this file after image
review. Wrangler built the dedicated context during the successful local smoke.
Miniflare automatically adds FUSE privileges on macOS's Docker VM; this code adds
no mounts/FUSE use. Local non-root behavior does not establish Cloud sandboxing.

For an actual caller, create a throwaway Worker **outside this repo**, e.g. under
`/tmp/avocado-media-probe-<random>/`, with a Service binding named `MEDIA` targeting
`avocado-media-poc-local`, entrypoint `MediaPreparation`. Its only HTTP test route
must reject non-`127.0.0.1`, accept only an owned synthetic body, use fake permit
and sink `RpcTarget`s, hash/count output streams without storing video, and call
`MEDIA.prepare` with the exact five job fields. Use the probe config as the first
`--config` and this POC config second so only the temporary loopback test worker
is reachable. The production/default POC fetch remains 404. Run with an empty
temporary XDG config (without changing HOME), no inherited Cloud credentials, and only the approved
local Docker socket; no host-secret mounts or remote bindings. This optional
loopback smoke passed for an owned 594,520,009-byte input in 27.442s, with six
permit callbacks, two output hashes, app-side commit and unchanged input SHA256.
This is local/emulated timing. The first smoke caught the pinned Workerd mapping
of `start.entrypoint` to Docker Cmd: the image now clears ENTRYPOINT and defaults
CMD to sleep. The successful rerun used that fix. No probe HTTP route is in the
committed application or compute worker source.
Stop if the local CLI asks for Cloud
authentication/provisioning instead of proceeding locally.

Minimal throwaway `/tmp/.../probe.mjs` (not a production Worker):

```js
import { RpcTarget } from "cloudflare:workers";
import { createHash } from "node:crypto";
class Permit extends RpcTarget {
  constructor(job) { super(); this.job = JSON.stringify(job); this.calls = 0; }
  async assertCurrent(job) {
    if (++this.calls > 30 || JSON.stringify(job) !== this.job) throw Error("local_permit");
  }
}
class Sink extends RpcTarget {
  constructor(permit) { super(); this.permit = permit; this.items = []; this.done = false; }
  async stage(name, source, metadata) {
    if (!["audio.wav", "video.mp4"].includes(name)) throw Error("local_output");
    const hash = createHash("sha256"); let size = 0;
    for await (const chunk of source) { size += chunk.byteLength; if (size > metadata.bytes) throw Error("local_size"); hash.update(chunk); }
    if (size !== metadata.bytes || hash.digest("hex") !== metadata.sha256) throw Error("local_hash");
    this.items.push(metadata);
  }
  async commit(manifest) { if (this.items.length !== manifest.artifacts.length) throw Error("local_incomplete"); this.done = true; }
  async retireUnselected() { if (!this.done) this.items = []; }
}
export default { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.hostname !== "127.0.0.1" || url.pathname !== "/local-smoke" || request.method !== "POST") return new Response(null, { status: 404 });
  const size = Number(request.headers.get("Content-Length"));
  if (!request.body || !Number.isSafeInteger(size) || size <= 0 || size > 2 * 1024 ** 3) return new Response(null, { status: 400 });
  const job = { jobId: crypto.randomUUID(), generation: 1, consentId: "local-owned", sourceEtag: "local-owned", declaredBytes: size };
  const permit = new Permit(job), sink = new Sink(permit);
  const result = await env.MEDIA.prepare(job, request.body, permit, sink);
  return Response.json({ done: sink.done, inputBytes: result.inputBytes, inputSha256: result.inputSha256, outputs: sink.items, permitCalls: permit.calls });
} };
```

Save beside it a temporary `probe.json` with `main:"probe.mjs"`, compatibility date
`2026-10-12`, `nodejs_compat`, `workers_dev:false`, and this binding:

```json
{"name":"media-probe-local-only","main":"probe.mjs","compatibility_date":"2026-10-12","compatibility_flags":["nodejs_compat"],"workers_dev":false,"services":[{"binding":"MEDIA","service":"avocado-media-poc-local","entrypoint":"MediaPreparation"}]}
```

Use the pinned Wrangler 4.151 CLI, an empty temporary XDG config, and Root's
already-reviewed local Docker socket. Example invocation (Root only):

```sh
node /PATH/TO/PINNED/node_modules/wrangler/wrangler-dist/cli.js dev --local \
  --ip 127.0.0.1 --port 8789 --config /tmp/OWNED-PROBE/probe.json \
  --config /tmp/avocado-379-media-poc/poc/media-preparation/wrangler.local.example.json
```

A Node CLI caller can `fetch("http://127.0.0.1:8789/local-smoke", {method:"POST",
headers:{"Content-Length":String(stat.size)}, body:createReadStream(ownedFixture),
duplex:"half"})`. Hash the same owned file before/after without buffering and
compare the returned input SHA256. No browser, app user, R2, D1 or real provider is
involved. Remove only Root's named temporary worker, local state and containers
after the smoke. Do not use `--remote` or expose the probe beyond loopback.

Pinned implementation evidence for the local entrypoint behavior:
[workerd v1.20261012.1 Docker create](https://github.com/cloudflare/workerd/blob/v1.20261012.1/src/workerd/server/container-client.c++#L1860).
It initializes Docker Cmd for that option and sets restart-on-failure. This local
implementation detail is distinct from the API documentation's image-entrypoint
override wording; no claim about deployed Cloud behavior is inferred from it.
