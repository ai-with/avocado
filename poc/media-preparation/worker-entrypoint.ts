// Concrete native API prototype; NO resource config, build or deployment.
import { DurableObject, WorkerEntrypoint } from "cloudflare:workers";
import { createMediaService, publicFetch } from "./private-rpc.mjs";
import { ContainerTransport, type Job } from "./container-transport.ts";
import { JobOwnership } from "./job-ownership.ts";

type Permit = { assertCurrent(job: Job): Promise<void> };
type Manifest = { v: number; generation: number; consentId: string; sourceEtag: string; inputBytes: number;
  inputSha256: string; durationS: number; audio: { state: string; sampleRate?: number; durationS?: number; proof?: string };
  artifacts: { name: string; bytes: number; sha256: string }[]; elapsedS: number };
type Sink = { stage(name: string, bytes: ReadableStream<Uint8Array>, metadata: unknown): Promise<void>;
  commit(manifest: unknown): Promise<void>; retireUnselected(): Promise<void> };
type Bindings = { CONTAINERS: DurableObjectNamespace<MediaContainer> };

export class MediaPreparation extends WorkerEntrypoint<Bindings> {
  async prepare(job: Job, source: ReadableStream<Uint8Array>, permit: Permit, sink: Sink): Promise<Manifest> {
    return this.env.CONTAINERS.getByName("media-preparation-singleton-v1").prepare(job, source, permit, sink);
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
  async prepare(job: Job, source: ReadableStream<Uint8Array>, permit: Permit, sink: Sink): Promise<Manifest> {
    if (!this.ctx.container) throw new Error("container_unconfigured");
    const transport = new ContainerTransport(this.ctx.container);
    const lease = await this.ownership.acquire(job.jobId, Date.now() + 240000, transport);
    try {
      const ownership = this.ownership;
      const leasedPermit: Permit = { async assertCurrent(value) { ownership.assert(lease); await permit.assertCurrent(value); ownership.assert(lease); } };
      const executor = { run: (...args: Parameters<ContainerTransport["run"]>) => { ownership.assert(lease); return transport.run(...args); }, cancel: (id: string) => transport.cancel(id) };
      return await createMediaService(executor).prepare(job, source, leasedPermit, sink);
    } finally {
      // Cleanup failure deliberately retains the marker/alarm for recovery.
      await this.ownership.release(lease, () => transport.cancel(job.jobId));
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
