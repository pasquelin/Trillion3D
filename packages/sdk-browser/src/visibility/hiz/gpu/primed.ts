import { encodeHizPyramid } from './pyramid.ts'
import { HIZ_SLOT_WORDS } from './uniforms.ts'
import { HIZ_PRIMED_BYTES } from './primedWgsl.ts'
import { hizPrimedPipeline } from './pipelines.ts'
import type { HizState } from './hizOps.ts'
import type { OpenPass } from '../../../gpu/core/lazyComputePass.ts'
import { sequentialEntries } from '../../../gpu/core/computeBindings.ts'
import type { HizPrimedPush } from './types.ts'

/** The primed build's uniform and its bind group over each pyramid, by the Hi-Z that made them. */
const held = new WeakMap<
  HizState,
  { uniform: GPUBuffer; push: Float32Array<ArrayBuffer>; groups: WeakMap<object, GPUBindGroup> }
>()

/** Asks the primed build's kernel, off the thread, and says whether it is compiled. */
export function askHizPrimed(device: GPUDevice) {
  return hizPrimedPipeline(device).stage.ask().ready
}

/**
 * The drawn pyramid's culling layer built with the push `push` of its level 0 (`hizShader`,
 * primed), in the open compute pass: false when the kernel is not compiled yet or the Hi-Z is
 * released. The push goes up with the build, so one primed build per submit is read right.
 */
export function encodePrimedLayer(h: HizState, open: OpenPass, push: HizPrimedPush) {
  const { at, device } = h
  if (h.disposed || !at) return false
  const { layout, stage } = hizPrimedPipeline(device)
  if (!stage.ready) return false
  let own = held.get(h)
  if (!own) {
    const uniform = device.createBuffer({
      label: 'Trillion3D Hi-Z primed push',
      size: HIZ_PRIMED_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    h.buffers.push(uniform)
    held.set(h, (own = { uniform, push: new Float32Array(4), groups: new WeakMap() }))
  }
  own.push.set([push.near, push.far, push.perspective, push.bias])
  device.queue.writeBuffer(own.uniform, 0, own.push)
  let group = own.groups.get(at)
  if (!group) {
    group = device.createBindGroup({
      layout,
      entries: sequentialEntries([
        at.pyramidView,
        at.depthView,
        { buffer: h.uniforms, size: HIZ_SLOT_WORDS * 4 },
        { buffer: own.uniform, size: HIZ_PRIMED_BYTES },
      ]),
    })
    own.groups.set(at, group)
  }
  encodeHizPyramid(open.pass, group, stage.get(), at.drawn.passes, at.drawn.slots)
  return true
}
