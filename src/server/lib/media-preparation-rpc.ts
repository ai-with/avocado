import { RpcTarget } from "cloudflare:workers";
import type { ArtifactName, PreparationJob, PreparationManifest, PreparationPermit, PreparationSink, PreparedArtifact } from "./media-preparation-contract";
class PermitTarget extends RpcTarget implements PreparationPermit {
  #permit: PreparationPermit;
  constructor(permit: PreparationPermit) { super(); this.#permit = permit; }
  assertCurrent(job: PreparationJob) { return this.#permit.assertCurrent(job); }
}
class SinkTarget extends RpcTarget implements PreparationSink {
  #sink: PreparationSink;
  constructor(sink: PreparationSink) { super(); this.#sink = sink; }
  stage(name: ArtifactName, stream: ReadableStream<Uint8Array>, metadata: PreparedArtifact) { return this.#sink.stage(name, stream, metadata); }
  commit(manifest: PreparationManifest) { return this.#sink.commit(manifest); }
  retireUnselected() { return this.#sink.retireUnselected(); }
}
export function preparationTargets(permit: PreparationPermit, sink: PreparationSink) { return { permit: new PermitTarget(permit), sink: new SinkTarget(sink) }; }
