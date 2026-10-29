import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { createGpuPeriodicReadback } from '../../gpu/core/periodicReadback.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { preparedComputeStage } from '../../gpu/core/computeStages.ts'
import { preparedPipelines } from '../../gpu/core/preparedPipelines.ts'
import { SSS_COMMON_WGSL } from './commonWgsl.ts'
import { subsurfacePrograms } from './pipelines.ts'
import { SSS_RECONSTRUCT_WGSL } from './setupWgsl.ts'
import { sssShapeHeader, subsurfaceShapeKey, type SubsurfaceShape } from './shape.ts'
import { SUBSURFACE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { trackPixelReading } from './pixelReading.ts'

/** The floats of the debug buffer: the pixel asked (two, in the image's pixels), then what the kernel found of it (`PIXEL_FIELDS`). */
const WORDS = 32
const COMPUTE = 4

/** Where the kernel writes each thing it found of the pixel, in floats from the third. */
export const PIXEL_FIELDS = {
  isProfile: 2,
  combined: 3,
  diffuse: 7,
  specular: 10,
  profile: 13,
  baseColour: 14,
  tint: 17,
  scattered: 20,
  scatteredLight: 23,
  final: 26,
} as const

/**
 * THE KERNEL THAT READS ONE PIXEL (`subsurfaceDebugPixel`): of the pixel asked, in full resolution, the lit image's colour and alpha, the lighting rebuilt from it into its diffuse and
 * specular parts (`sssReconstruct`), its profile, its base colour and tint, the scattered image's light there (the colour over its alpha), the lighting mixed with it
 * by the tint (the fade is one at full resolution) and the final colour the recombine writes. The lit image is bound as `texA` and the scattered one as `texB`.
 */
const kernelWgsl = (shape: SubsurfaceShape) =>
  wgslProgram(
    `${sssShapeHeader(shape)}
@group(1) @binding(0) var texA:texture_2d<f32>;
@group(1) @binding(1) var texB:texture_2d<f32>;
@group(2) @binding(0) var<storage,read_write> found:array<f32,${WORDS}>;
fn put3(at:u32,v:vec3f){found[at]=v.x;found[at+1u]=v.y;found[at+2u]=v.z;}
@compute @workgroup_size(1) fn sssDebugPixelMain(){
 let p=vec2i(i32(found[0]),i32(found[1]));
 let profile=sssIsProfile(p);
 found[${PIXEL_FIELDS.isProfile}]=select(0.0,1.0,profile);
 if(!profile){return;}
 let id=sssProfileAt(p);
 let centre=sssSceneTexel(p);
 let light=sssReconstruct(p,view.tiles.w!=0u);
 let base=textureLoad(baseTex,p,0).rgb;
 let tint=sssTint(id);
 let uv=clamp((vec2f(p)+vec2f(0.5))/view.scene.zw,sssBilinearMin(),sssBilinearMax());
 let blurred=textureSampleLevel(texB,linearSampler,uv,0.0);
 let scattered=blurred.rgb/max(blurred.a,0.00001);
 let mixed=mix(light.diffuse,scattered,tint);
 found[${PIXEL_FIELDS.combined}]=centre.r;found[${PIXEL_FIELDS.combined + 1}]=centre.g;found[${PIXEL_FIELDS.combined + 2}]=centre.b;found[${PIXEL_FIELDS.combined + 3}]=centre.a;
 put3(${PIXEL_FIELDS.diffuse}u,light.diffuse);
 put3(${PIXEL_FIELDS.specular}u,light.specular);
 found[${PIXEL_FIELDS.profile}]=f32(id);
 put3(${PIXEL_FIELDS.baseColour}u,base);
 put3(${PIXEL_FIELDS.tint}u,tint);
 put3(${PIXEL_FIELDS.scattered}u,scattered);
 put3(${PIXEL_FIELDS.scatteredLight}u,mixed);
 put3(${PIXEL_FIELDS.final}u,mixed*base+light.specular);
}`,
    [SSS_COMMON_WGSL, SSS_RECONSTRUCT_WGSL],
  )

const kernels = oncePerDevice((device: GPUDevice) => {
  const programs = subsurfacePrograms(device)
  const textures = device.createBindGroupLayout({
    label: `${SUBSURFACE_PASS} debug textures`,
    entries: [
      { binding: 0, visibility: COMPUTE, texture: { sampleType: 'float' } },
      { binding: 1, visibility: COMPUTE, texture: { sampleType: 'float' } },
    ],
  })
  const output = device.createBindGroupLayout({
    label: `${SUBSURFACE_PASS} debug output`,
    entries: [{ binding: 0, visibility: COMPUTE, buffer: { type: 'storage' } }],
  })
  const layout = device.createPipelineLayout({
    bindGroupLayouts: [programs.common, textures, output],
  })
  const stages = preparedPipelines(
    (shape: SubsurfaceShape) =>
      preparedComputeStage(
        device,
        layout,
        device.createShaderModule({
          label: `${SUBSURFACE_PASS} debug pixel`,
          code: kernelWgsl(shape),
        }),
        'sssDebugPixelMain',
        undefined,
        `${SUBSURFACE_PASS} debug pixel`,
      ).ask(),
    subsurfaceShapeKey,
  )
  return { textures, output, stages }
})

/** What the debug pixel finds, as floats: `found[PIXEL_FIELDS.x + i]`. */
export type FoundPixel = Float32Array

/**
 * The reading of one pixel of the subsurface pass's image (`kernelWgsl`): the kernel runs before the recombine, the buffer it fills is copied and mapped
 * without a wait, and the last reading to come back is kept (`found`, the zeros before any). Made when the option is first on.
 */
export function createSubsurfaceDebugPixel(device: GPUDevice) {
  const buffer = device.createBuffer({
    label: `${SUBSURFACE_PASS} debug pixel`,
    size: WORDS * 4,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  })
  const found = new Float32Array(WORDS)
  const request = new Float32Array(2)
  const track = trackPixelReading()
  const reader = createGpuPeriodicReadback(
    device,
    { label: `${SUBSURFACE_PASS} debug pixel readback`, bytes: WORDS * 4, eager: true },
    (mapped) => {
      found.set(new Float32Array(mapped, 0, WORDS))
      track.landed(found)
    },
  )
  return {
    found,
    /** Whether a reading of the pixel asked has come back: not one of another pixel, nor one the kernel has not run since. */
    get ready() {
      return track.fresh
    },
    /** The kernel does not run just now (the pass is drawn at half resolution): the reading held no longer says what the pixel is. */
    forget: track.forget,
    /** Encodes the reading of the pixel (`x`, `y`) of the image: `common` the pass's group of the image, `lit` the lit image and `scattered` the scattering's result. */
    encode(
      encoder: GPUCommandEncoder,
      frame: number,
      shape: SubsurfaceShape,
      common: GPUBindGroup,
      lit: GPUTextureView,
      scattered: GPUTextureView,
      x: number,
      y: number,
    ) {
      // A pixel not the one asked before: what is held is of another, and the next image takes its reading at once. Asked before the kernel is waited for, so that a cursor that moves while it compiles is not read as the old pixel.
      if (track.ask(x, y)) reader.sampled(Number.NEGATIVE_INFINITY)
      const made = kernels(device)
      const stage = made.stages.of(shape).get()
      if (!stage) return
      request.set([x, y])
      device.queue.writeBuffer(buffer, 0, request)
      const pass = encoder.beginComputePass({ label: `${SUBSURFACE_PASS} debug pixel` })
      pass.setPipeline(stage)
      pass.setBindGroup(0, common)
      pass.setBindGroup(
        1,
        device.createBindGroup({
          layout: made.textures,
          entries: [
            { binding: 0, resource: lit },
            { binding: 1, resource: scattered },
          ],
        }),
      )
      pass.setBindGroup(
        2,
        device.createBindGroup({
          layout: made.output,
          entries: [{ binding: 0, resource: { buffer } }],
        }),
      )
      pass.dispatchWorkgroups(1)
      pass.end()
      if (reader.due(frame) && reader.copy(encoder, buffer, 0, WORDS * 4)) reader.sampled(frame)
    },
    submitted: reader.submitted,
    dispose() {
      buffer.destroy()
      reader.dispose()
    },
  }
}
