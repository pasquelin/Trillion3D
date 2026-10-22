import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { computeStorageTextureEntry, namedEntries } from '../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { VELOCITY_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createLayer } from '../finish/localLayer.ts'
import { TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { createTaaFrameState } from './frameState.ts'
import { velocityInputEntries, velocityInputResources, type VelocityInputs } from './inputs.ts'
import { createPlacementMotion, type MotionRoot } from './motion.ts'
import { SURFACE_VELOCITY_BINDINGS, SURFACE_VELOCITY_WGSL } from './surfaceVelocityWgsl.ts'
import { TEXEL_TILE, VECTOR_FORMAT } from './velocityWgsl.ts'

/**
 * The velocity stage's program once a device, compiled off the thread (`PreparedPipeline.ask`,
 * `askVelocity`): the frames are held on it, so an image the stage serves is never drawn without it.
 */
const velocityProgram = oncePerDevice((device: GPUDevice) => {
  const layout = device.createBindGroupLayout({
    label: VELOCITY_PASS,
    entries: [
      ...velocityInputEntries(),
      computeStorageTextureEntry(SURFACE_VELOCITY_BINDINGS.vectors, VECTOR_FORMAT),
    ],
  })
  const stage = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    device.createShaderModule({ label: VELOCITY_PASS, code: SURFACE_VELOCITY_WGSL }),
    'surfaceVelocity',
    undefined,
    VELOCITY_PASS,
  )
  return { layout, stage }
})

/** Asks the stage's program of `device`, compiled off the thread. */
export const askVelocityProgram = (device: GPUDevice) => velocityProgram(device).stage.ask()

/** The uniform the stage reads (`TAA_VIEW`). */
const viewUniform = (device: GPUDevice) =>
  device.createBuffer({
    label: 'Trillion3D velocity view v1',
    size: TAA_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

/** The buffer of no root's world box, made at the first ask: what the stage reads while the world
 *  holds none (`boxes`). */
function emptyBoxes(device: GPUDevice) {
  let made: GPUBuffer | undefined
  return {
    get: () =>
      (made ??= device.createBuffer({
        label: 'Trillion3D velocity no boxes',
        size: 16,
        usage: GPUBufferUsage.STORAGE,
      })),
    destroy: () => made?.destroy(),
  }
}

/** The vectors target: a word a render texel, written by the stage and read by the passes. */
const vectorTarget = (device: GPUDevice) =>
  createLayer(device, (width, height) => ({
    label: 'Trillion3D velocity',
    size: { width, height },
    format: VECTOR_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  }))

/** The stage's pass over the vectors target `target`: its group, made again where what it names
 *  moved, and the dispatch over a `render` grid. */
function velocityPass(
  device: GPUDevice,
  target: ReturnType<typeof vectorTarget>,
  uniform: GPUBuffer,
) {
  const { layout, stage } = velocityProgram(device)
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined
  return {
    encode(encoder: GPUCommandEncoder, inputs: VelocityInputs, render: readonly number[]) {
      const { next } = identity
      next[0] = inputs.depth
      next[1] = inputs.ids
      next[2] = inputs.pages
      next[3] = inputs.motion
      next[4] = inputs.pool
      next[5] = inputs.positions
      next[6] = inputs.uvs
      next[7] = inputs.boxes
      next[8] = target.view
      if (identity.moved() || !group)
        group = device.createBindGroup({
          layout,
          entries: namedEntries(SURFACE_VELOCITY_BINDINGS, {
            ...velocityInputResources(inputs, uniform),
            vectors: target.view!,
          }),
        })
      const pass = encoder.beginComputePass({ label: VELOCITY_PASS })
      pass.setPipeline(stage.get())
      pass.setBindGroup(0, group)
      pass.dispatchWorkgroups(ceilDiv(render[0], TEXEL_TILE), ceilDiv(render[1], TEXEL_TILE))
      pass.end()
    },
    /** The group names the target no more. */
    forget() {
      group = undefined
      identity.clear()
    },
  }
}

/**
 * THE VELOCITY STAGE OF A VIEW: the target every pass that reads the motion of the image's texels
 * reads — the motion of each render texel, as a reprojection vector (`VECTOR_FORMAT`) —, written
 * once an image before the lighting (`encodeVelocity`, `velocityFrame.ts`), and what it is
 * measured with: the placements' motion (`createPlacementMotion`), the view's last image
 * (`frame`, the one the temporal pass keeps its history by) and the uniform it reads
 * (`TAA_VIEW`). The target is made at the size the render targets are made at (`ensure`), when a pass
 * reads it, and given back (`release`) once none does; the program, the placements' motion and the
 * view's last image stay.
 */
export function createVelocity(device: GPUDevice, roots: readonly MotionRoot[]) {
  const motion = createPlacementMotion(device, roots)
  const frame = createTaaFrameState()
  const uniform = viewUniform(device)
  const target = vectorTarget(device)
  const pass = velocityPass(device, target, uniform)
  const size = [0, 0],
    noBoxes = emptyBoxes(device)
  const release = () => {
    target.release()
    pass.forget()
    size[0] = size[1] = 0
  }
  return {
    /** The placements' motion: told which roots moved, read by every pass that measures the image. */
    motion,
    /** The view's last image: what the stage and the temporal pass keep from image to image. */
    frame,
    /** The uniform the stage reads (`TAA_VIEW`). */
    uniform,
    /** Whether a pass reads this image's vectors (`followVelocity`), and the stage wrote them. */
    active: false,
    measured: false,
    /** This image's decisions, read by the temporal pass that follows: the scene compared with the
     *  last (`scan`), a placement moved (`moved`), and nothing moved since the last image (`still`,
     *  `imageStill`): its vectors are zero, a pass that blurs by them has nothing to do. */
    scan: false,
    moved: false,
    still: true,
    /** The size the vectors are made at, 0 × 0 before `ensure`. */
    size: size as readonly number[],
    get bytes() {
      return target.bytes
    },
    /** Each render texel's reprojection vector (`encodeVector`) of the last image measured. */
    get vectors() {
      if (!target.view) throw new Error('VELOCITY_TARGET_MISSING')
      return target.view
    },
    /** The roots' world boxes the stage reads, a buffer of no root while the world holds none. */
    boxes: (roots: { boxes?: GPUBuffer } | undefined) => roots?.boxes ?? noBoxes.get(),
    /** The target at `w × h`, the largest grid an image is drawn at; made again where it moved. */
    ensure(w: number, h: number) {
      target.fit(w, h)
      size[0] = w
      size[1] = h
    },
    /** Encodes the measure of the frame's inputs over the `render` grid, which the uniform was
     *  written for. */
    encode: pass.encode,
    /** Gives the target back, which no pass reads. */
    release,
    dispose() {
      release()
      motion.dispose()
      uniform.destroy()
      noBoxes.destroy()
    },
  }
}

/** A view's velocity stage (`createVelocity`). */
export type Velocity = ReturnType<typeof createVelocity>
