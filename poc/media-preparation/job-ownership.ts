/** Actual DO ownership logic; metadata only, no media or app credentials. */
type Marker = { token: string; jobId: string; deadline: number };
export type Lease<T> = Marker & { resource: T; revoked: boolean; cleanup?: Promise<void> };
type Storage = Pick<DurableObjectStorage, "get" | "transaction">;
export class JobOwnership<T> {
  private owner: Lease<T> | null = null; private recovering = false; private storage: Storage;
  constructor(storage: Storage) { this.storage = storage; }
  current() { return this.owner; }
  assert(lease: Lease<T>) {
    if (this.owner !== lease || lease.revoked) throw new Error("job_lease_stale");
  }
  private async clear(token: string) {
    await this.storage.transaction(async tx => {
      const actual = await tx.get<Marker>("active");
      if (actual?.token === token) { await tx.delete("active"); await tx.deleteAlarm(); }
    });
  }
  async acquire(jobId: string, deadline: number, resource: T) {
    if (this.owner || this.recovering) throw new Error("container_busy");
    const lease: Lease<T> = { token: crypto.randomUUID(), jobId, deadline, resource, revoked: false };
    this.owner = lease; // Before the first await: another request cannot reserve.
    try {
      await this.storage.transaction(async tx => {
        if (await tx.get("active")) throw new Error("container_cleanup_pending");
        const marker: Marker = { token: lease.token, jobId, deadline };
        await tx.put("active", marker); await tx.setAlarm(deadline + 3000);
      });
      return lease;
    } catch (cause) { if (this.owner === lease) this.owner = null; throw cause; }
  }
  async release(lease: Lease<T>, cleanup: () => Promise<void>) {
    lease.revoked = true;
    // Alarm/cancel/late finally share the SAME cleanup. A stale finalizer cannot
    // invoke an old transport against the next container's runtime instance.
    lease.cleanup ??= Promise.resolve().then(cleanup);
    await lease.cleanup;
    await this.clear(lease.token);
    if (this.owner === lease) this.owner = null;
  }
  async recover(cleanup: () => Promise<void>) {
    if (this.owner || this.recovering) throw new Error("container_busy");
    this.recovering = true;
    try {
      const marker = await this.storage.get<Marker>("active");
      await cleanup();
      if (marker) await this.clear(marker.token);
    } finally { this.recovering = false; }
  }
  async expire(now: number, cleanup: (lease: Lease<T>) => Promise<void>, orphan: () => Promise<void>) {
    const marker = await this.storage.get<Marker>("active");
    if (!marker) return;
    if (marker.deadline > now) {
      await this.storage.transaction(async tx => {
        if ((await tx.get<Marker>("active"))?.token === marker.token) await tx.setAlarm(marker.deadline + 3000);
      });
      return;
    }
    const captured = this.owner;
    if (captured) {
      if (captured.token !== marker.token) return; // Stale alarm, newer owner.
      await this.release(captured, () => cleanup(captured));
    } else {
      // Constructor/recovery paths have no live caller, so block new acquire
      // until the orphan namespace is gone and its own marker is conditionally removed.
      await this.recover(orphan);
    }
  }
}
