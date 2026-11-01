/// <reference lib="esnext.disposable" />
// Private native Container worker; deployment configuration lives beside it.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { createMediaService, publicFetch } from "./private-rpc.mjs";
import { ContainerTransport, type Job } from "./container-transport.ts";
import { ActiveJobBusy, JobOwnership } from "./job-ownership.ts";

type Permit = { assertCurrent(job: Job): Promise<void> };
type Manifest = { v: number; generation: number; consentId: string; sourceEtag: string; inputBytes: number;
  inputSha256: string; durationS: number; audio: { state: string; sampleRate?: number; durationS?: number; proof?: string };
  artifacts: { name: string; bytes: number; sha256: string }[]; elapsedS: number };
export type PrepareResult = Manifest | { status: "busy" };
type Sink = { stage(name: string, bytes: ReadableStream<Uint8Array>, metadata: unknown): Promise<void>;
  commit(manifest: unknown): Promise<void>; retireUnselected(): Promise<void> };
type Bindings = { CONTAINERS: DurableObjectNamespace<MediaContainer> };
function disposeOwned(value: unknown) {
  if (value && (typeof value === "object" || typeof value === "function") && Symbol.dispose in value) {
    const dispose = value[Symbol.dispose];
    if (typeof dispose === "function") dispose.call(value);
  }
}
function disposeParameters(permit: Permit, sink: Sink) {
  try { disposeOwned(permit); } finally { disposeOwned(sink); }
}

export class MediaPreparation extends WorkerEntrypoint<Bindings> {
  async prepare(job: Job, source: ReadableStream<Uint8Array>, permit: Permit, sink: Sink): Promise<PrepareResult> {
    let result: PrepareResult | undefined;
    try {
      result = await this.env.CONTAINERS.getByName("media-preparation-singleton-v1").prepare(job, source, permit, sink);
      // Only final JSON data crosses this boundary. Do not forward the owned
      // RPC result's disposer or release it while output/commit is pending.
      return structuredClone(result);
    } finally {
      try { disposeOwned(result); } finally { disposeParameters(permit, sink); }
    }
  }
  async cancel(jobId: string) { return this.env.CONTAINERS.getByName("media-preparation-singleton-v1").cancel(jobId); }
}
export class MediaContainer extends DurableObject<Record<string, never>> {
  private ownership: JobOwnership<ContainerTransport>;
  constructor(ctx: DurableObjectState, env: Record<string, never>) {
    super(ctx, env);
    this.ownership = new JobOwnership(ctx.storage);
    ctx.blockConcurrencyWhile(async () => {
      // A live process after DO restart has no valid in-memory caller/capability.
      // Stop it; do not adopt an orphan or restore a container snapshot.
      await this.ownership.recover(async () => { await ctx.container?.destroy(); });
    });
  }
  async fetch() { return publicFetch(); }
  async prepare(job: Job, source: ReadableStream<Uint8Array>, permit: Permit, sink: Sink): Promise<PrepareResult> {
    try {
      if (!this.ctx.container) throw new Error("container_unconfigured");
      const transport = new ContainerTransport(this.ctx.container);
      const reservation = this.ownership.acquire(job.jobId, Date.now() + 240000, transport);
      const lease = await reservation.catch(async cause => {
        if (!(cause instanceof ActiveJobBusy)) throw cause;
        // The app retires this unused attempt and retries. Do not invoke its
        // permit/sink or touch the current owner's transport/marker/alarm.
        await source.cancel("container_busy").catch(() => {});
        return null;
      });
      if (!lease) return { status: "busy" };
      try {
        const ownership = this.ownership;
        const leasedPermit: Permit = { async assertCurrent(value) { ownership.assert(lease); await permit.assertCurrent(value); ownership.assert(lease); } };
        const executor = { run: (...args: Parameters<ContainerTransport["run"]>) => { ownership.assert(lease); return transport.run(...args); }, cancel: (id: string) => transport.cancel(id) };
        return await createMediaService(executor).prepare(job, source, leasedPermit, sink);
      } finally {
        // Cleanup failure deliberately retains the marker/alarm for recovery.
        await this.ownership.release(lease, () => transport.cancel(job.jobId));
      }
    } finally {
      // These are this invocation's parameter stubs, not env/DO bindings or the
      // native ExecProcess. Keep them strongly reachable through all cleanup.
      disposeParameters(permit, sink);
    }
  }
  async cancel(jobId: string) {
    const captured = this.ownership.current();
    if (captured?.jobId === jobId) await this.ownership.release(captured, () => captured.resource.cancel(jobId));
  }
  async alarm() {
    await this.ownership.expire(Date.now(), lease => lease.resource.cancel(lease.jobId), async () => { await this.ctx.container?.destroy(); });
  }
}
export default { fetch: publicFetch };
