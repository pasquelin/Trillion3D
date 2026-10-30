import { ceilDiv, mipSize } from '../../../../../math/src/scalar/integers.ts'
import type { SkyLightCubemap } from '../../../../../sdk-core/src/modules/sky/skyLightCubemap.ts'
import { cubemapMipCount } from '../../../../../sdk-core/src/scene/core/fogCubemap.ts'
import {
  computeStorageEntry,
  computeStorageTextureEntry,
  computeTextureEntry,
} from '../../../gpu/core/computeBindings.ts'
import { startedComputeStages } from '../../../gpu/core/computeStages.ts'
import { oncePerDevice } from '../../../gpu/core/oncePerDevice.ts'
import { createReadbackRing, type ReadbackRing } from '../../../gpu/core/readbackRing.ts'
import { arrayLevelView } from '../../../gpu/core/textureViews.ts'
import { uploadCubeFloats, type FloatUpload } from './cubeFloatUpload.ts'
import {
  CUBE_DOWNSAMPLE_MAX_BINDINGS,
  CUBE_DOWNSAMPLE_MAX_ENTRY,
  CUBE_MAX_LUMINANCE_BINDINGS,
  CUBE_MAX_LUMINANCE_ENTRY,
  cubeDownsampleMaxShader,
  cubeMaxLuminanceShader,
} from './cubePeakWgsl.ts'
import { keepsFloats, liveOwners, newOwners, setOwner, type Owners } from './cubePeakOwners.ts'
import { CUBE_FACES } from './layout.ts'

/**
 * THE BRIGHTEST CHANNEL OF A CUBEMAP HELD AS DATA, found on the GPU once for its texels, as the light's source is fitted to a half float
 * by it (`cubemapPairFit`): the cube goes up as full floats over the images (`uploadCubeFloats`), every mip is the largest of the
 * texels it covers in the mip above (`downsampleCubeMax`), the last, one-texel mip's six faces are reduced to the largest of their
 * channels (`maxCubeLuminance`) and that one float is read back a few images later. Until it is, the peak is not known and the cube is not
 * written: the caller asks again each image. The float cube is let go of as soon as the reduction is submitted, unless an owner asked to
 * keep it (`keep`): the ambient cubemap's chain is made from the same float cube (`takeFloatCube`) and the sky light's half cube from it
 * (`floatCubeOf`), so the cube goes up once for all. Whether to keep it is decided from the union of the owners once the peak is back, not
 * as the reduction is submitted, so the order the owners first asked in does not matter.
 * A measure is of one cube's texels on one device, shared by its owners, whoever asked first; it is destroyed when the last one lets go.
 * An owner is held weakly: a runtime dropped without letting go does not keep the measure alive.
 */

/** `GPUTextureUsage`'s and `GPUBufferUsage`'s flags, written in the clear. */
const COPY_DST = 2,
  TEXTURE_BINDING = 4,
  STORAGE_BINDING = 8,
  BUFFER_COPY_SRC = 4,
  BUFFER_STORAGE = 128

/** The workgroup's side, the downsampling's (`@workgroup_size(8, 8, 1)`). */
const GROUP = 8

/** The kernels of a device, compiled off the frame once, and the layouts they bind. */
const kernels = oncePerDevice((device: GPUDevice) => {
  const downsampleLayout = device.createBindGroupLayout({
    label: 'Trillion3D cube peak downsample',
    entries: [
      computeTextureEntry(CUBE_DOWNSAMPLE_MAX_BINDINGS.source, 'unfilterable-float', '2d-array'),
      computeStorageTextureEntry(
        CUBE_DOWNSAMPLE_MAX_BINDINGS.reduced,
        'rgba32float',
        'write-only',
        '2d-array',
      ),
    ],
  })
  const lastLayout = device.createBindGroupLayout({
    label: 'Trillion3D cube peak last mip',
    entries: [
      computeTextureEntry(CUBE_MAX_LUMINANCE_BINDINGS.last, 'unfilterable-float', '2d-array'),
      computeStorageEntry(CUBE_MAX_LUMINANCE_BINDINGS.peak, true),
    ],
  })
  const downsample = startedComputeStages(
    device,
    'Trillion3D cube peak downsample',
    device.createPipelineLayout({ bindGroupLayouts: [downsampleLayout] }),
    device.createShaderModule({
      label: 'Trillion3D cube peak downsample',
      code: cubeDownsampleMaxShader(),
    }),
    [CUBE_DOWNSAMPLE_MAX_ENTRY],
  )
  const last = startedComputeStages(
    device,
    'Trillion3D cube peak last mip',
    device.createPipelineLayout({ bindGroupLayouts: [lastLayout] }),
    device.createShaderModule({
      label: 'Trillion3D cube peak last mip',
      code: cubeMaxLuminanceShader(),
    }),
    [CUBE_MAX_LUMINANCE_ENTRY],
  )
  return {
    downsampleLayout,
    lastLayout,
    downsample,
    last,
    get ready() {
      return downsample.ready && last.ready
    },
  }
})

/** The measure of one cube's texels on one device. */
interface Measure extends FloatUpload {
  /** The owners that ask for the peak; they outlive a restart of the measure. */
  readonly owners: Owners
  /** The cube as full floats with its mips, none once let go of or taken. */
  texture: GPUTexture | undefined
  /** Whether the reduction is submitted. */
  reduced: boolean
  /** The staging ring the float comes back through, none before the reduction is submitted and once it has landed. */
  ring: ReadbackRing | undefined
  /** The peak, once it has landed. */
  peak: number | undefined
}

const measures = new WeakMap<object, Map<GPUDevice, Measure>>()

function open(device: GPUDevice, { size }: SkyLightCubemap, owners: Owners): Measure {
  kernels(device)
  return {
    owners,
    reduced: false,
    uploaded: 0,
    rgba: undefined,
    texture: device.createTexture({
      label: 'Trillion3D cube peak',
      size: { width: size, height: size, depthOrArrayLayers: CUBE_FACES },
      mipLevelCount: cubemapMipCount(size),
      format: 'rgba32float',
      usage: TEXTURE_BINDING | STORAGE_BINDING | COPY_DST,
    }),
    ring: undefined,
    peak: undefined,
  }
}

/** What a measure still holds on the GPU let go of at once: its float cube while it is up, its staging ring while the float is in flight. */
function release(measure: Measure) {
  measure.texture?.destroy()
  measure.ring?.destroy()
  measure.texture = measure.ring = undefined
  measure.rgba = undefined
}

/** The float cube destroyed once the peak is back and no owner wants it any more. */
function trim(measure: Measure) {
  if (measure.texture && measure.peak !== undefined && !keepsFloats(measure.owners)) {
    measure.texture.destroy()
    measure.texture = undefined
  }
}

/** The reduction of the uploaded cube encoded and submitted: every mip, the last mip's six faces, the float copied to the staging ring. */
function reduce(device: GPUDevice, measure: Measure, size: number) {
  const texture = measure.texture!
  const { downsampleLayout, lastLayout, downsample, last } = kernels(device)
  const count = cubemapMipCount(size)
  const out = device.createBuffer({
    label: 'Trillion3D cube peak',
    size: 4,
    usage: BUFFER_STORAGE | BUFFER_COPY_SRC,
  })
  const ring = createReadbackRing(
    device,
    { label: 'Trillion3D cube peak', bytes: 4, count: 1, eager: true },
    (mapped) => void (measure.peak = new Float32Array(mapped, 0, 1)[0]),
  )
  const staging = ring.take()
  if (!staging) {
    out.destroy()
    ring.destroy()
    return
  }
  const encoder = device.createCommandEncoder({ label: 'Trillion3D cube peak' })
  const pass = encoder.beginComputePass({ label: 'Trillion3D cube peak' })
  pass.setPipeline(downsample.pipelineOf(CUBE_DOWNSAMPLE_MAX_ENTRY))
  for (let level = 1; level < count; level++) {
    pass.setBindGroup(
      0,
      device.createBindGroup({
        layout: downsampleLayout,
        entries: [
          {
            binding: CUBE_DOWNSAMPLE_MAX_BINDINGS.source,
            resource: arrayLevelView(texture, level - 1),
          },
          {
            binding: CUBE_DOWNSAMPLE_MAX_BINDINGS.reduced,
            resource: arrayLevelView(texture, level),
          },
        ],
      }),
    )
    const side = ceilDiv(mipSize(size, level), GROUP)
    pass.dispatchWorkgroups(side, side, CUBE_FACES)
  }
  pass.setPipeline(last.pipelineOf(CUBE_MAX_LUMINANCE_ENTRY))
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: lastLayout,
      entries: [
        {
          binding: CUBE_MAX_LUMINANCE_BINDINGS.last,
          resource: arrayLevelView(texture, count - 1),
        },
        { binding: CUBE_MAX_LUMINANCE_BINDINGS.peak, resource: { buffer: out } },
      ],
    }),
  )
  pass.dispatchWorkgroups(1)
  pass.end()
  encoder.copyBufferToBuffer(out, 0, staging, 0, 4)
  device.queue.submit([encoder.finish()])
  ring.submitted()
  // Destroyed after the submit that names them: the device frees them once that work is done.
  out.destroy()
  measure.reduced = true
  measure.ring = ring
}

/** The measure of `cube`'s texels on `device`, none before it is asked. */
const measureOf = (device: GPUDevice, { texels }: SkyLightCubemap) =>
  measures.get(texels)?.get(device)

/**
 * The brightest channel of `cube`, none until the GPU has reduced and returned it: each call takes the measure one step further (the next
 * faces up, then the reduction once its kernels are compiled) and is asked again the next image. Found once for the cube's texels on a
 * device. A readback the device refused is not waited for: the measure starts again from the faces, with the same owners.
 */
export function cubePeak(device: GPUDevice, cube: SkyLightCubemap, owner: object, keep = false) {
  let measure = measureOf(device, cube)
  if (measure?.ring && measure.peak === undefined && measure.ring.held() === 0) {
    release(measure)
    measure = open(device, cube, measure.owners)
    measures.get(cube.texels)!.set(device, measure)
  } else if (!measure) {
    measure = open(device, cube, newOwners())
    const onDevices = measures.get(cube.texels) ?? new Map()
    onDevices.set(device, measure)
    measures.set(cube.texels, onDevices)
  }
  setOwner(measure.owners, owner, keep)
  if (measure.peak !== undefined) {
    measure.ring?.destroy()
    measure.ring = undefined
    trim(measure)
  } else if (measure.texture && !measure.reduced) {
    const up =
      measure.uploaded === CUBE_FACES || uploadCubeFloats(device, measure.texture, cube, measure)
    if (up && kernels(device).ready) reduce(device, measure, cube.size)
  }
  return measure.peak
}

/**
 * The float cube of `cube`'s texels on `device` with the mips the reduction wrote in it, while the peak is back and an owner asked to keep
 * it (`cubePeak`); none otherwise. Still the measure's: it is destroyed when no owner keeps it.
 */
export const floatCubeOf = (device: GPUDevice, cube: SkyLightCubemap) => {
  const measure = measureOf(device, cube)
  return measure?.peak === undefined ? undefined : measure.texture
}

/** The float cube handed to the caller to own (`floatCubeOf`), once: the ambient chain's own box-filtered mips are made over it. */
export function takeFloatCube(device: GPUDevice, cube: SkyLightCubemap) {
  const texture = floatCubeOf(device, cube)
  if (texture) measureOf(device, cube)!.texture = undefined
  return texture
}

/** `owner`'s hold on the measure of `cube`'s texels on `device` given up (the picture changed, the light ended): the textures are destroyed now, not left to the collector, once no owner is left. */
export function abandonCubePeak(device: GPUDevice, cube: SkyLightCubemap, owner: object) {
  const measure = measureOf(device, cube)
  if (!measure) return
  measure.owners.keep.delete(owner)
  if (measure.peak !== undefined) return trim(measure)
  if (liveOwners(measure.owners).length > 0) return
  release(measure)
  measures.get(cube.texels)!.delete(device)
}
