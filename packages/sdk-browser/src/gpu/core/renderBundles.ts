import {
  createWebgpuBindIdentity,
  type WebgpuBindIdentity,
} from '../../webgpu/core/bindIdentity.ts'

/** What a render pass and a render bundle encoder both take: the draw stream a bundle records. */
export type RenderCommands = GPURenderCommandsMixin & GPUBindingCommandsMixin

/** Records into `encoder` the stream `key` describes, reading what it names from it — directly,
 *  or through the few identities and revisions that decide it, walked here on a miss alone —;
 *  what it returns is held with the bundle, the `note` every replay gives back. `K` names the
 *  key's words past its layout, in the order the frame writes them (`BundleKey`). */
export type RecordBundle<K extends readonly unknown[] = unknown[]> = (
  encoder: GPURenderBundleEncoder,
  key: readonly [GPURenderBundleEncoderDescriptor, ...K],
) => unknown

/** A frame's key past its layout (`keyed`): its words `K`, pushed in order. */
type BundleKey<K extends readonly unknown[] = unknown[]> = { push(...words: K): number }

/** A held bundle: the one-bundle list a pass executes, and what its recording noted. */
type Held = { bundles: GPURenderBundle[]; note: unknown }

/**
 * The render bundles of one pass stream whose commands repeat from frame to frame: every count its
 * draws use is written by the GPU (indirect arguments), every object it names outlives the frame.
 * Each frame writes its key — the attachment layout (`keyed`), then what decides its commands:
 * every pipeline, group, buffer and number they read, or the few identities and revision counters
 * those are derived from, so that a held frame writes and compares a handful of words — and
 * `execute`s it: the bundle of a held key is replayed, one `executeBundles` call in place of the
 * whole stream; otherwise the stream is recorded once, by `record`, and held. The latest
 * `capacity` keys are held — what they name is retained no longer than that —: a stream that
 * alternates between inputs (a double-buffered table, a compacted half) replays each. Nothing is
 * allocated on a frame that replays; recording happens only on the frame an input moved.
 *
 * Bundles hold no timestamp: the pass that executes one keeps its timestamp writes.
 */
export class RenderBundles {
  /** The keys held, one a slot, the least lately named replaced first: the engine's one cache
   *  keyed by an identity list (`createWebgpuBindIdentity`). */
  private readonly identity: WebgpuBindIdentity
  private readonly held: (Held | undefined)[] = []

  constructor(capacity: number) {
    this.identity = createWebgpuBindIdentity(capacity)
  }

  /** The frame's key, emptied and opened with `layout`: the attachments the bundle executes in.
   *  With `K`, its words in one push, typed as the `RecordBundle<K>` that reads them. */
  keyed<K extends readonly unknown[] = unknown[]>(layout: GPURenderBundleEncoderDescriptor) {
    const { next } = this.identity
    next.length = 0
    next.push(layout)
    return next as unknown as BundleKey<K>
  }

  /** Executes in `pass` the bundle of the key the frame wrote, recorded on `device` by `record`
   *  when no held key matches; returns what its recording noted. */
  execute<K extends readonly unknown[]>(
    pass: GPURenderPassEncoder,
    device: GPUDevice,
    record: RecordBundle<K>,
  ) {
    const held = this.find(device, record)
    pass.executeBundles(held.bundles)
    return held.note
  }

  /** Forgets the bundle the last `execute` ran: a stream recorded before all it names was ready,
   *  walked again at the next frame. */
  forgetLatest() {
    this.identity.forget()
    this.held[this.identity.slot] = undefined
  }

  /** Forgets every held bundle, and with them what their keys name. */
  clear() {
    this.identity.clear()
    this.held.length = 0
  }

  private find<K extends readonly unknown[]>(device: GPUDevice, record: RecordBundle<K>): Held {
    const { identity, held } = this
    const kept = identity.moved() ? undefined : held[identity.slot]
    if (kept) return kept
    const { next } = identity
    const layout = next[0] as GPURenderBundleEncoderDescriptor
    const encoder = device.createRenderBundleEncoder(layout)
    const note = record(encoder, next as unknown as Parameters<RecordBundle<K>>[1])
    return (held[identity.slot] = { bundles: [encoder.finish({ label: layout.label })], note })
  }
}
