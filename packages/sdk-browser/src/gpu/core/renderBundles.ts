import { sameEntries } from './sameEntries.ts'

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
export type BundleKey<K extends readonly unknown[] = unknown[]> = { push(...words: K): number }

/** A held bundle: the key it was recorded for, the one-bundle list a pass executes, and what its
 *  recording noted. */
type Held = { key: unknown[]; bundles: GPURenderBundle[]; note: unknown }

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
  private readonly held: Held[] = []
  private readonly next: unknown[] = []
  private readonly capacity: number

  constructor(capacity: number) {
    this.capacity = capacity
  }

  /** The frame's key, emptied and opened with `layout`: the attachments the bundle executes in.
   *  With `K`, its words in one push, typed as the `RecordBundle<K>` that reads them. */
  keyed<K extends readonly unknown[] = unknown[]>(layout: GPURenderBundleEncoderDescriptor) {
    const { next } = this
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
    this.held.shift()
  }

  /** Forgets every held bundle, and with them what their keys name. */
  clear() {
    this.held.length = 0
  }

  private find<K extends readonly unknown[]>(device: GPUDevice, record: RecordBundle<K>): Held {
    const { held, next } = this
    for (let at = 0; at < held.length; at++) {
      const entry = held[at]
      if (!sameEntries(entry.key, next)) continue
      for (let i = at; i > 0; i--) held[i] = held[i - 1]
      return (held[0] = entry)
    }
    const layout = next[0] as GPURenderBundleEncoderDescriptor
    const encoder = device.createRenderBundleEncoder(layout)
    const note = record(encoder, next as unknown as Parameters<RecordBundle<K>>[1])
    const entry = { key: next.slice(), bundles: [encoder.finish({ label: layout.label })], note }
    if (held.length >= this.capacity) held.length = this.capacity - 1
    held.unshift(entry)
    return entry
  }
}
