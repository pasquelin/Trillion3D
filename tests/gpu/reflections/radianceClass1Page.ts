// The page of the radiance pyramid's class-1 proof (`radiance-class1.gpu.ts`). Level 0 of the
// pyramid is the lit image itself, the HDR target the last image lit (`reflections/radiance.ts`),
// where it was a copy of it, its coverage clamped within one and zero past the drawn size.
//
//  - `level0`: the engine's own read of level 0 (`reflectionLevelColor`, through the reflection
//    group the engine binds) against the read the copy gave — the copy made here as the engine
//    made it, then sampled through the same sampler —, at taps over the whole image, its drawn
//    border and past it, on generated lit images: their coverage within one, zero past the drawn
//    size, as the lighting's clear leaves them. Both reads' bits.
//  - `families`: the reflection targets of generated reflective families (a mirror floor, rough
//    floors, a coated rough floor) through the engine's kernels (`rig.ts`), three still images in a
//    row, the HDR targets taking turns between them; and the held images of the glass panes
//    through the whole engine (`glassPage.ts`), blended and transmissive.
import { toHalf } from '../../../packages/math/src/float/half.ts'
import { wgslModule } from '../../../packages/math/src/wgsl/assemble.ts'
import {
  createScreenReflection,
  reflectionGroup,
  reflectionLayout,
} from '../../../packages/sdk-browser/src/reflections/gpu.ts'
import { reflectionFootprintWgsl } from '../../../packages/sdk-browser/src/reflections/footprint.ts'
import {
  REFLECTION_GROUP,
  reflectionLightViewWgsl,
} from '../../../packages/sdk-browser/src/reflections/viewLayout.ts'
import { createDeferredView } from '../../../packages/sdk-browser/src/lighting/deferred/view.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../../packages/sdk-browser/src/scene/physicalLobes.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { readBuffer } from '../kit/computeReadback.ts'
import { standaloneHiz } from '../kit/standaloneHiz.ts'
import { imageOf } from './glassPage.ts'
import { openMirror } from './mirrorPage.ts'
import { mirrorScene, MIRROR } from './mirrorScene.ts'

/** The lit images of the level-0 proof: their size, and the drawn size inside it. */
const IMAGES = [
  { size: [96, 64], drawn: [96, 64] },
  { size: [96, 64], drawn: [72, 40] },
  { size: [133, 77], drawn: [101, 58] },
] as const

/** The copy level 0 was, as the engine made it: the lit image, zero past the drawn size, its
 *  coverage clamped within one, written in the pyramid's format. */
const COPY_SHADER = `@group(0) @binding(0) var lit:texture_2d<f32>;
@group(0) @binding(1) var copy:texture_storage_2d<rgba16float,write>;
@group(0) @binding(2) var<uniform> drawn:vec4u;
@compute @workgroup_size(8,8)
fn main(@builtin(global_invocation_id) id:vec3u){
 let p=vec2i(id.xy);
 if(any(p>=vec2i(textureDimensions(copy)))){return;}
 let inside=all(p<vec2i(drawn.xy));
 let texel=select(vec4f(0.0),textureLoad(lit,p,0),inside);
 textureStore(copy,p,vec4f(texel.rgb,clamp(texel.a,0.0,1.0)));
}`

/** Both reads of level 0 at each tap: the engine's, and the copy's through the same sampler — the
 *  engine's reflection group in its group, the proof's own bindings in group 0. */
const READ_SHADER = `${wgslModule(
  reflectionFootprintWgsl(REFLECTION_GROUP),
  reflectionLightViewWgsl(REFLECTION_GROUP),
)}
@group(0) @binding(0) var<storage,read> taps:array<vec2f>;
@group(0) @binding(1) var<storage,read_write> engine:array<vec4u>;
@group(0) @binding(2) var<storage,read_write> copied:array<vec4u>;
@group(0) @binding(3) var copy:texture_2d<f32>;
@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=arrayLength(&taps)){return;}
 let uv=taps[id.x];
 engine[id.x]=bitcast<vec4u>(reflectionLevelColor(uv,0.0));
 copied[id.x]=bitcast<vec4u>(textureSampleLevel(copy,reflectionSampler,uv,0.0));
}`

/** A generated lit image of `size`, drawn over `drawn`: colours of every magnitude an HDR target
 *  holds, coverage 0, 1 and between, zero past the drawn size. */
function litImage([width, height]: readonly number[], [dw, dh]: readonly number[]) {
  const texels = new Float32Array(width * height * 4)
  let seed = 0x9e3779b9
  const next = () =>
    (seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0) / 2 ** 32
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const at = (y * width + x) * 4
      for (let c = 0; c < 3; c++) texels[at + c] = next() ** 3 * [1, 40, 2000][(x + y + c) % 3]
      const a = next()
      texels[at + 3] = a < 0.3 ? 0 : a < 0.6 ? 1 : a
    }
  return texels
}

/** Taps over the image of `size`: every texel's centre and corner, and between, a texel past the
 *  border on each side included. */
function tapsOver([width, height]: readonly number[]) {
  const taps: number[] = []
  for (let y = -1; y <= height + 1; y += 0.375)
    for (let x = -1; x <= width + 1; x += 0.375) taps.push(x / width, y / height)
  return new Float32Array(taps)
}

/** The level-0 proof on one lit image: the taps, and those whose two reads differ in any bit. */
async function level0(
  device: GPUDevice,
  size: readonly [number, number],
  drawn: readonly number[],
) {
  const [width, height] = size
  const reflection = createScreenReflection(device, width, height, false)
  const { hiz, partition } = await standaloneHiz(device, width, height)
  const lightView = createDeferredView(device)
  const surface = device.createTexture({
    size: [1, 1],
    format: 'rgba32float',
    usage: GPUTextureUsage.TEXTURE_BINDING,
  })
  const group = reflectionGroup(reflection, hiz.depth()!, {
    lightView: lightView.buffer,
    surface: surface.createView(),
  })
  // The lit image in the pyramid's level 0, as an image's adoption leaves it there.
  const texels = litImage(size, drawn)
  device.queue.writeTexture(
    { texture: reflection.radiance.image.texture },
    Uint16Array.from(texels, toHalf),
    { bytesPerRow: width * 8 },
    [width, height],
  )
  const copy = device.createTexture({
    size: [width, height],
    format: 'rgba16float',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  })
  const bounds = device.createBuffer({
    size: 16,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(bounds, 0, new Uint32Array([drawn[0], drawn[1], 0, 0]))
  const copying = device.createComputePipeline({
    layout: 'auto',
    compute: { module: device.createShaderModule({ code: COPY_SHADER }), entryPoint: 'main' },
  })
  const taps = tapsOver(size),
    count = taps.length / 2
  const tapBuffer = device.createBuffer({
    size: taps.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(tapBuffer, 0, taps)
  const out = () =>
    device.createBuffer({
      size: count * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    })
  const [engine, copied] = [out(), out()]
  const readLayout = device.createBindGroupLayout({
    entries: [
      { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
      { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
      { binding: 3, visibility: GPUShaderStage.COMPUTE, texture: { sampleType: 'float' } },
    ],
  })
  const reading = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [readLayout, reflectionLayout(device)],
    }),
    compute: { module: device.createShaderModule({ code: READ_SHADER }), entryPoint: 'main' },
  })
  const encoder = device.createCommandEncoder()
  const pass = encoder.beginComputePass()
  pass.setPipeline(copying)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: copying.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: reflection.radiance.image.view },
        { binding: 1, resource: copy.createView() },
        { binding: 2, resource: { buffer: bounds } },
      ],
    }),
  )
  pass.dispatchWorkgroups(Math.ceil(width / 8), Math.ceil(height / 8))
  pass.setPipeline(reading)
  pass.setBindGroup(
    0,
    device.createBindGroup({
      layout: readLayout,
      entries: [
        { binding: 0, resource: { buffer: tapBuffer } },
        { binding: 1, resource: { buffer: engine } },
        { binding: 2, resource: { buffer: copied } },
        { binding: 3, resource: copy.createView() },
      ],
    }),
  )
  pass.setBindGroup(REFLECTION_GROUP, group)
  pass.dispatchWorkgroups(Math.ceil(count / 64))
  pass.end()
  device.queue.submit([encoder.finish()])
  const [a, b] = [
    await readBuffer(device, engine, 0, count * 16),
    await readBuffer(device, copied, 0, count * 16),
  ]
  let differ = 0,
    nonzero = 0
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) differ++
    if (a[i] !== 0) nonzero++
  }
  for (const made of [copy, surface, tapBuffer, engine, copied, bounds, ...partition])
    made.destroy()
  reflection.dispose()
  hiz.dispose()
  lightView.dispose()
  return { taps: count, differ, nonzero }
}

/** Whether the pyramid reads its level 0 in place, the lit image itself. */
function inPlace(device: GPUDevice) {
  const reflection = createScreenReflection(device, 4, 4, false)
  const held = 'image' in reflection.radiance
  reflection.dispose()
  return held
}

/** The surface flag of the mirror scene's floor (`scene/surfaceModel.ts`): lit standard. */
const STANDARD = 2

/** The mirror scene, its floor of roughness `rough`, coated where `coat` (as `mirrorPage.ts`). */
function floor(rough: number, coat = false) {
  const scene = mirrorScene()
  const { size } = MIRROR
  const lobes = new Uint32Array(size * size * 4)
  for (let p = 0; p < size * size; p++) {
    if (scene.flags[p] !== STANDARD) continue
    scene.normals[p * 4 + 3] = rough
    if (!coat) continue
    scene.flags[p] |= PHYSICAL_SURFACE_FLAG
    lobes.set([0, 0x7fff0000, 0xffff0000, 0], p * 4)
  }
  return { scene, lobes: coat ? lobes : undefined }
}

/** The reflective families the rig draws, by name. */
const FAMILIES = {
  mirror: () => floor(0),
  'rough 0.35': () => floor(0.35),
  'rough 0.9': () => floor(0.9),
  'coated rough': () => floor(0.9, true),
}

/** What the page reads. */
export type Class1Reading = {
  level0: {
    size: readonly number[]
    drawn: readonly number[]
    taps: number
    differ: number
    nonzero: number
  }[]
  /** Per family, its three still images' reflection targets, raw half-float words. */
  families: Record<string, number[][]>
  /** Per glass kind, its held image (RGBA bytes) and whether it was held. */
  glass: Record<string, { held: boolean; pixels: number[] }>
}

export function run() {
  return runOnDevice<Class1Reading>(async (device, events, result) => {
    result.level0 = []
    // A base branch whose pyramid copies its level 0 has no lit image of its own to read: its run
    // writes the families' reference alone (`radiance-class1.gpu.ts`).
    if (inPlace(device))
      for (const { size, drawn } of IMAGES)
        result.level0.push({ size, drawn, ...(await level0(device, size, drawn)) })
    result.families = {}
    for (const [name, made] of Object.entries(FAMILIES)) {
      const { scene, lobes } = made()
      const rig = await openMirror(device, scene, lobes)
      // The first image has no pyramid yet; the next three reflect it, the HDR targets taking turns.
      rig.image()
      const targets: number[][] = []
      for (let k = 0; k < 3; k++) {
        rig.image()
        targets.push(Array.from(await rig.read()))
      }
      rig.dispose()
      result.families[name] = targets
    }
    result.glass = {}
    for (const kind of ['blend', 'transmission'] as const)
      result.glass[kind] = await imageOf(device, events, { pane: true, base: true }, kind)
  })
}
