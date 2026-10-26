import type { ComputeRun } from '../../gpu/core/lazyComputePass.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'
import { computeStorageTextureEntry, namedEntries } from '../../gpu/core/computeBindings.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { NO_WPO, wpoKey, type WpoSet } from '../../materials/graph/wpoProgram.ts'
import { createWebgpuBindIdentity } from '../../gpu/bind/bindIdentity.ts'
import { VELOCITY_PASS } from '../../diagnostic/stage/passLabels.ts'
import { createLayer } from '../filters/sizedImage.ts'
import { TAA_VIEW_BYTES } from './bindingsWgsl.ts'
import { createTaaFrameState } from './frameState.ts'
import {
  velocityAtlasBound,
  velocityInputEntries,
  velocityInputResources,
  type VelocityInputs,
} from './inputs.ts'
import {
  SURFACE_VELOCITY_BINDINGS,
  SURFACE_VELOCITY_WGSL,
  surfaceVelocityShader,
} from './surfaceVelocityWgsl.ts'
import { TEXEL_TILE, VECTOR_FORMAT } from './velocityWgsl.ts'

const PASS: GPUComputePassDescriptor = { label: VELOCITY_PASS }

/**
 * The velocity stage's programs once a device and a set of offsets, compiled off the thread
 * (`PreparedPipeline.ask`, `askVelocityProgram`): the frames are held on them, so an image the stage
 * serves is never drawn without its program. One module, two pipelines: the stage of an image with no
 * displaced surface and, made only for the images that draw some (`tessellationWanted`), the one that
 * solves their texels' flat points (`DISPLACED`, `deformWgsl.ts`). A scene whose surfaces' offsets move
 * vertices (`wpo`) has a program that places a pixel's triangle on them, and a layout that binds the
 * records of those surfaces.
 */
const velocityPrograms = new WeakMap<GPUDevice, Map<string, ReturnType<typeof makeProgram>>>()
function velocityProgram(device: GPUDevice, wpo: WpoSet) {
  let byDevice = velocityPrograms.get(device)
  if (!byDevice) velocityPrograms.set(device, (byDevice = new Map()))
  const key = wpo.programs.length ? wpoKey(wpo) : ''
  let made = byDevice.get(key)
  if (!made) byDevice.set(key, (made = makeProgram(device, wpo)))
  return made
}

function makeProgram(device: GPUDevice, wpo: WpoSet) {
  const layout = device.createBindGroupLayout({
    label: VELOCITY_PASS,
    entries: [
      ...velocityInputEntries(),
      computeStorageTextureEntry(SURFACE_VELOCITY_BINDINGS.vectors, VECTOR_FORMAT),
    ],
  })
  const pipeline = device.createPipelineLayout({ bindGroupLayouts: [layout] })
  const module = device.createShaderModule({
    label: VELOCITY_PASS,
    code: wpo.programs.length ? surfaceVelocityShader(wpo) : SURFACE_VELOCITY_WGSL,
  })
  const stage = (constants?: Record<string, number>) =>
    preparedComputeStage(device, pipeline, module, 'surfaceVelocity', constants, VELOCITY_PASS)
  // The water's velocity patch: the stage's group, then a group of the water's depth.
  const waterLayout = device.createBindGroupLayout({
    label: VELOCITY_PASS,
    entries: [
      {
        binding: 0,
        visibility: GPUShaderStage.COMPUTE,
        texture: { sampleType: 'depth' },
      },
    ],
  })
  const water = preparedComputeStage(
    device,
    device.createPipelineLayout({ bindGroupLayouts: [layout, waterLayout] }),
    module,
    'waterVelocity',
    undefined,
    VELOCITY_PASS,
  )
  return { layout, flat: stage(), displaced: stage({ DISPLACED: 1 }), water, waterLayout }
}

/** Asks the stage's program of `device` — the one for images that draw displaced surfaces where
 *  `displaced` — compiled off the thread. */
export const askVelocityProgram = (device: GPUDevice, displaced: boolean, wpo = NO_WPO) => {
  const programs = velocityProgram(device, wpo)
  programs.water.ask()
  return (displaced ? programs.displaced : programs.flat).ask()
}

/** The uniform the stage reads (`TAA_VIEW`). */
const viewUniform = (device: GPUDevice) =>
  device.createBuffer({
    label: 'Trillion3D velocity view v1',
    size: TAA_VIEW_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })

/** The vectors target: a word a render texel, written by the stage and read by the passes. */
const vectorTarget = (device: GPUDevice) =>
  createLayer(device, (width, height) => ({
    label: 'Trillion3D velocity',
    size: { width, height },
    format: VECTOR_FORMAT,
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  }))

/** Writes into `next` what the stage's group names: the inputs' resources and the vectors `view`. */
function nameVelocityInputs(next: unknown[], inputs: VelocityInputs, view: unknown) {
  next[0] = inputs.depth
  next[1] = inputs.ids
  next[2] = inputs.pages
  next[3] = inputs.worlds
  next[4] = inputs.pool
  next[5] = inputs.positions
  next[6] = inputs.uvs
  next[7] = inputs.normals
  next[9] = view
  next[10] = inputs.material
  next[11] = inputs.frame
  const atlas = velocityAtlasBound(inputs)
  for (let k = 0; k < atlas.length; k++) next[12 + k] = atlas[k]
  next[16] = inputs.sampler
  next[17] = inputs.previous
}

/** The water's pass over the `last` render grid: the stage's `group`, then the water depth's. */
function dispatchWater(
  steps: ComputeRun,
  pipeline: GPUComputePipeline | undefined,
  group: GPUBindGroup,
  depthGroup: GPUBindGroup,
  last: readonly number[],
) {
  if (!pipeline) return
  const compute = steps.pass(PASS)
  compute.setPipeline(pipeline)
  compute.setBindGroup(0, group)
  compute.setBindGroup(1, depthGroup)
  compute.dispatchWorkgroups(ceilDiv(last[0], TEXEL_TILE), ceilDiv(last[1], TEXEL_TILE))
}

/** The stage's pass over the vectors target `target`: its group, made again where what it names
 *  moved, and the dispatch over a `render` grid. */
function velocityPass(
  device: GPUDevice,
  target: ReturnType<typeof vectorTarget>,
  uniform: GPUBuffer,
  wpo: WpoSet,
) {
  const { layout, flat, displaced, water, waterLayout } = velocityProgram(device, wpo)
  const identity = createWebgpuBindIdentity()
  let group: GPUBindGroup | undefined, last: readonly number[] | undefined
  // The water depth's group, kept for the view it names: made again where the depth moved.
  let depthGroup: GPUBindGroup | undefined, depthOver: GPUTextureView | undefined
  return {
    encode(
      encoder: GPUCommandEncoder,
      inputs: VelocityInputs,
      render: readonly number[],
      tessellated: boolean,
    ) {
      const { next } = identity
      nameVelocityInputs(next, inputs, target.view)
      if (identity.moved() || !group)
        group = device.createBindGroup({
          layout,
          entries: namedEntries(SURFACE_VELOCITY_BINDINGS, {
            ...velocityInputResources(inputs, uniform),
            vectors: target.view!,
          }),
        })
      last = render
      const pipeline = (tessellated ? displaced : flat).get()
      if (!pipeline) return
      const compute = encoder.beginComputePass(PASS)
      compute.setPipeline(pipeline)
      compute.setBindGroup(0, group)
      compute.dispatchWorkgroups(ceilDiv(render[0], TEXEL_TILE), ceilDiv(render[1], TEXEL_TILE))
      compute.end()
    },
    /** The vectors of the texels the single-layer water covers (its depth `waterDepth` nearer than the
     *  stage's own), rewritten as the camera's alone at the water's depth. None before the stage ran
     *  this image. */
    encodeWater(steps: ComputeRun, waterDepth: GPUTextureView) {
      if (!group || !last) return
      if (depthOver !== waterDepth || !depthGroup) {
        depthGroup = device.createBindGroup({
          layout: waterLayout,
          entries: [{ binding: 0, resource: waterDepth }],
        })
        depthOver = waterDepth
      }
      dispatchWater(steps, water.get(), group, depthGroup, last)
    },
    /** The group names the target no more. */
    forget() {
      group = undefined
      last = undefined
      depthGroup = depthOver = undefined
      identity.clear()
    },
  }
}

/** What the stage keeps of an image: whether a pass reads its vectors (`active`, `followVelocity`)
 *  and the stage wrote them (`measured`); its decisions, read by the temporal pass that follows: the
 *  scene compared with the last (`scan`), a placement moved (`moved`), and nothing moved since the last
 *  image (`still`, `imageStill`): its vectors are zero, a pass that blurs by them has nothing to do. */
const imageDecisions = () => ({
  active: false,
  measured: false,
  scan: false,
  moved: false,
  still: true,
})

/**
 * THE VELOCITY STAGE OF A VIEW: the target every pass that reads the motion of the image's texels
 * reads — the motion of each render texel's own surface, as a reprojection vector
 * (`VECTOR_FORMAT`, `encodeOwnVector`), dilated by none —, written
 * once an image before the lighting (`encodeVelocity`, `velocityFrame.ts`), and what it is
 * measured with: the view's last image (`frame`, the one the temporal pass keeps its history by) and
 * the uniform it reads (`TAA_VIEW`); the placements' poses are the cut's, now and as the last drawn
 * frame drew them (`../../geometry/dag/previousPoses.ts`). The target is made at the size the render
 * targets are made at (`ensure`), when a pass reads it, and given back (`release`) once none does;
 * the program and the view's last image stay.
 */
export function createVelocity(device: GPUDevice, wpo: WpoSet = NO_WPO) {
  const frame = createTaaFrameState()
  const uniform = viewUniform(device)
  const target = vectorTarget(device)
  const pass = velocityPass(device, target, uniform, wpo)
  const size = [0, 0]
  const release = () => {
    target.release()
    pass.forget()
    size[0] = size[1] = 0
  }
  return {
    /** The view's last image: what the stage and the temporal pass keep from image to image. */
    frame,
    /** The uniform the stage reads (`TAA_VIEW`). */
    uniform,
    /** The offsets the surfaces' vertices are placed by, which the stage and the passes that read the
     *  frame's surfaces were made with. */
    wpo,
    ...imageDecisions(),
    /** The size the vectors are made at, 0 × 0 before `ensure`. */
    size: size as readonly number[],
    get bytes() {
      return target.bytes
    },
    /** Each render texel's own reprojection vector (`encodeOwnVector`) of the last image measured. */
    get vectors() {
      if (!target.view) throw new Error('VELOCITY_TARGET_MISSING')
      return target.view
    },
    /** The target at `w × h`, the largest grid an image is drawn at; made again where it moved. */
    ensure(w: number, h: number) {
      target.fit(w, h)
      size[0] = w
      size[1] = h
    },
    /** Encodes the measure of the frame's inputs over the `render` grid, which the uniform was
     *  written for, by the program of an image that draws displaced surfaces where `tessellated`
     *  (`TaaFrameState.tessellated`). */
    encode: pass.encode,
    /** Rewrites the vectors of the texels the single-layer water covers (`velocityPass`). */
    encodeWater: pass.encodeWater,
    /** Gives the target back, which no pass reads. */
    release,
    dispose() {
      release()
      uniform.destroy()
    },
  }
}

/** A view's velocity stage (`createVelocity`). */
export type Velocity = ReturnType<typeof createVelocity>
