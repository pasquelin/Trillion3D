import { TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { createTaaResolves, resolveTargetUsage } from './resolve.ts'
import { createTaaHistoryTargets } from './historyTargets.ts'
import { AS_IS_SHARE_FORMAT } from '../lighting/deferred/asIsShare.ts'
import { createWebgpuBindIdentity } from '../webgpu/core/bindIdentity.ts'
import { INPUTS, taaGroupEntries, type TaaInputs } from './inputs.ts'
import { createTaaCheckpoint, createTaaFrameState } from './frameState.ts'
import { createPlacementMotion, type MotionRoot } from './motion.ts'
import { createTaaFilterHistory } from './layers.ts'
import { TAA_PASS } from '../stage/passLabels.ts'

/** A history target's attachment: cleared by the pass that writes it. */
const CLEAR = { loadOp: 'clear', storeOp: 'store', clearValue: [0, 0, 0, 0] } as const

/**
 * Temporal antialiasing pass: two histories in ping-pong, each a colour, its share target, its
 * geometry and its flicker measure (`historyTargets.ts`), one read and the other
 * written each frame, and composition reads the one just written. Targets follow the display size
 * (`resize`); bind groups are rebuilt when an input changes identity, never per frame. With
 * `upscale`, the resolves that reconstruct a frame drawn below the display are compiled at once
 * (`upscales`). The resolve is a fullscreen draw into the targets.
 */
export async function createTemporalAntialiasing(
  device: GPUDevice,
  roots: readonly MotionRoot[],
  upscale = false,
) {
  const resolves = await createTaaResolves(device, upscale)
  const motion = createPlacementMotion(device, roots)
  const filterHistory = createTaaFilterHistory(device, resolveTargetUsage())
  const uniform = device.createBuffer({
    label: 'Trillion3D TAA view v1',
    size: TAA_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const sampler = device.createSampler({
    label: 'Trillion3D TAA history sampler',
    magFilter: 'linear',
    minFilter: 'linear',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  // Nearest and clamped to the edge: what the resolve's gathers read through, the edge their clamp.
  const texelSampler = device.createSampler({
    label: 'Trillion3D TAA texel sampler',
    addressModeU: 'clamp-to-edge',
    addressModeV: 'clamp-to-edge',
  })
  // A frame with no transparent reads zero as its reactive value, from this one texel.
  const noReactive = device.createTexture({
    label: 'Trillion3D TAA no reactive',
    size: { width: 1, height: 1 },
    format: AS_IS_SHARE_FORMAT,
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const noReactiveView = noReactive.createView()
  const history = createTaaHistoryTargets(device),
    { images, geometry, shading } = history,
    /** The two groups (one a history target read) for each identity the inputs were seen with:
     *  the lit image is one of two HDR targets that take turns (`reflections/radiance.ts`). */
    held: (GPUBindGroup | undefined)[][] = []
  /** Target read on the next frame: the other is written. */
  let read = 0
  /** What the groups name: the layout, then each of `INPUTS` (`bindIdentity.ts`); two held, the
   *  HDR targets' turns. */
  const identity = createWebgpuBindIdentity(2)
  const frame = createTaaFrameState()
  /** Where the last ordinary frame started: what a convergence frame replays, `read` with it. */
  const saved = createTaaCheckpoint(frame)
  let savedRead = 0
  const dropTargets = () => {
    history.drop()
    held.length = 0
    filterHistory.drop()
  }
  return {
    uniform,
    motion,
    filterHistory,
    /** Whether the upscaling resolves are compiled; the first ask compiles them (`resolve.ts`). */
    upscales: () => !!resolves.upscaled(),
    /** Bytes of the two targets as allocated: what a capture must count beside its own. */
    get historyBytes() {
      return history.bytes + filterHistory.bytes
    },
    /** Draft of the frame inputs, filled by `encodeTaaPass`: nothing is allocated per frame. */
    inputs: {} as TaaInputs,
    /** What the pass keeps from frame to frame on the CPU: jitter, history, hold. */
    frame,
    /** An ordinary frame's entry remembers where it started; a convergence frame (re-rendering the
     *  pose for arrived tiles) COMES BACK to it, remaking the image to the bit without accumulating. */
    checkpoint(quiet: boolean) {
      savedRead = read
      saved.save(quiet)
      filterHistory.checkpoint()
    },
    /** Returns the stillness of the replayed frame: its own, not the one arrived tiles disturbed. */
    replay() {
      read = savedRead
      filterHistory.replay()
      return saved.restore()
    },
    /** Remakes the targets at another size, history gone: true when something was reallocated. */
    resize(w: number, h: number) {
      if (w === history.width && h === history.height && images.length === 2) return false
      dropTargets()
      history.allocate(w, h)
      return true
    },
    /** Encode the pass, its uniform written first: reads `inputs.current` and history, writes the
     *  other target, then swaps roles. Returns the written colour, share and display layers. */
    encode(encoder: GPUCommandEncoder, inputs: TaaInputs) {
      if (images.length !== 2) throw new Error('TAA_TARGETS_MISSING')
      const set = inputs.upscale ? resolves.upscaled() : resolves
      if (!set) throw new Error('TAA_UPSCALE_MISSING')
      const kind = inputs.share ? 'blended' : inputs.flags ? 'asIs' : 'flagless'
      const twin = inputs.filter && resolves.filtered(kind, !!inputs.upscale)
      // Until its twin is compiled, the image resolves no layer: composition reads the raw ones.
      if (!twin) inputs.filter = undefined
      // Without a reactive value, the resolve that reads none once compiled: the same words.
      const quiet = !twin && !inputs.reactive && resolves.unreactive(kind, !!inputs.upscale)
      const resolve = twin || quiet || set[kind]
      filterHistory.follow(inputs.filter, history.width, history.height)
      const { layout } = resolve
      const { next } = identity
      next[0] = layout
      for (let i = 0; i < INPUTS.length; i++) next[1 + i] = inputs[INPUTS[i]]
      const moved = identity.moved(),
        groups = (held[identity.slot] ??= [undefined, undefined])
      if (moved || !groups[0]) {
        for (let i = 0; i < 2; i++) {
          const entries = taaGroupEntries(
            inputs,
            images[i],
            sampler,
            texelSampler,
            uniform,
            noReactiveView,
            geometry[i],
            shading[i],
          )
          entries.push(...filterHistory.entries(inputs.filter, i))
          groups[i] = device.createBindGroup({ layout, entries })
        }
      }
      const write = 1 - read,
        { color, share } = images[write],
        filter = inputs.filter && filterHistory.target(write)
      const pass = encoder.beginRenderPass({
        label: TAA_PASS,
        colorAttachments: [color, share, geometry[write], shading[write], ...(filter ?? [])].map(
          (view) => ({ view, ...CLEAR }),
        ),
      })
      pass.setPipeline(resolve.pipeline)
      pass.setBindGroup(0, groups[read]!)
      pass.draw(3)
      pass.end()
      read = write
      filterHistory.written = !!filter
      images[write].filter = filter
      return images[write]
    },
    /** Releases the two targets with the frame targets, history gone, until the next `resize`. */
    release: dropTargets,
    dispose() {
      dropTargets()
      motion.dispose()
      uniform.destroy()
      noReactive.destroy()
      this.inputs = {} as TaaInputs
    },
  }
}

export type TemporalAntialiasing = Awaited<ReturnType<typeof createTemporalAntialiasing>>
