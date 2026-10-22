// Fog is a term of the one lighting model (#345): every program that lights a surface — the
// opaque resolve with and without bounce, the blended and transmissive surfaces — hands
// its lit colour through `fogged` before the display chain, measured from
// the eye each pass carries. An unlit material is fogged too; a normal or depth
// material, the diagnostic views and the composition are left as they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CONTRACT_COMPOSITIONS } from './deferred/shaders.ts'
import { BLEND_VIEW_SIZE, BLEND_VIEW_WGSL } from '../blend/viewLayout.ts'
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts'
import {
  BLEND_SHADER,
  BOUNCE_LIGHTING_SHADER,
  DIRECT_LIGHTING_SHADER,
  TRANSMIT_SHADER,
  UNLIT_LIGHTING_SHADER,
} from '../gpu/core/shaderTexts.fixture.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createDeferredPlaceholders } from './deferred/setup.ts'
import type { SceneFog } from '../../../sdk-core/src/scene/core/fog.ts'
import type { EngineContext } from '../session/engine/types.ts'
import { awayCamera, drawnQuad } from '../frame/backend/drawnQuad.fixture.ts'
import { camera as quadCamera } from '../frame/backend/testScenes.fixture.ts'
import { renderWebgpuPages } from '../frame/render/render.ts'
import { flushWebgpuPages } from '../frame/render/flush.ts'
import { directLightResources } from '../frame/prepare/contractLight.ts'
import { createWebgpuView } from '../frame/backend/state/view.ts'
import { releaseWebgpuView, useWebgpuView } from '../frame/backend/state/viewSwitch.ts'
import { LIGHT_BUFFER_AT } from '../frame/backend/state/lightBufferLayout.ts'
import { FOG_VIEW_FLOATS, FOG_VIEW_SLOT } from './fog/viewSlots.ts'
import {
  DEFERRED_LIGHTING_PASS,
  HIZ_PASS,
  LIGHT_TILES_PASS,
  REFLECTION_PASS,
} from '../diagnostic/stage/passLabels.ts'
import { DEFERRED_BINDINGS } from './deferred/bindings.ts'
import { deferredLayoutEntries } from './deferred/layoutEntries.ts'
import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { blendLayoutEntries } from '../gpu/bind/blendBindEntries.ts'
import { AIR_BINDING, airLayoutEntries } from './atmosphere/programs.ts'
import { AIR_PROGRAMS } from './atmosphere/shaders.ts'

test('the opaque resolve fogs its lit sum at the pixel, from the eye in display.yzw', () => {
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER])
    assert.match(
      shader,
      /var rgb=litSurface\(lit,indirect\[0\][^,]*,[^\n]*,indirect\[1\],emissive\.rgb[^,;]*,[^;]*\);[^]*?if\(\(surfaceFlag&128u\)==0u\)\{rgb=fogged\(rgb,P,view\.display\.yzw\);\}/,
    )
  // An unlit or matcap surface (flag 1) is fogged; a diagnostic, normal or depth one (flag 3) is not.
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER]) {
    assert.match(shader, /if\(flag==3u\)\{return vec4f\(base\.rgb,1\.0\);\}/)
    assert.match(
      shader,
      /if\(flag==1u\)\{var rgb=base\.rgb;if\(\(surfaceFlag&128u\)==0u\)\{rgb=fogged\(rgb,P,view\.display\.yzw\);\}/,
    )
  }
  assert.match(
    SHADE_SHADER,
    /select\(3u,1u\|select\(0u,128u,\(page\.flags&1048576u\)!=0u\),model==4u\)/,
  )
  assert.doesNotMatch(UNLIT_LIGHTING_SHADER, /fogged/)
  for (const shader of Object.values(CONTRACT_COMPOSITIONS.plain))
    assert.doesNotMatch(shader, /fogged/)
})

test('blended and transmissive surfaces, lit or unlit, are fogged from the eye of the blend view', () => {
  // The lit sum (`litSurface`, the thin subsurface's back light included) closes inside the lit
  // branch (a shadow catcher keeps its colour); the fog closes the branch that skips the unlit
  // view, which keeps what it emits.
  assert.match(
    BLEND_SHADER,
    /if\(!unlit\)\{\s+if\(blendLit\(flags\)\)\{[^]*?rgb=litSurface\([^;]*s\.emissive,[^;]+\);\s+\}\s+\}\s+\/\/.*\s+if\(\(flags&1048576u\)==0u\)\{rgb=fogged\(rgb,in\.view,uni\.eye\.xyz\);\}\s+\}else\{rgb\+=s\.emissive;\}/,
  )
  assert.match(TRANSMIT_SHADER, /let fogFree=unlit\|\|\(flags&1048576u\)!=0u;/)
  assert.match(
    TRANSMIT_SHADER,
    /select\(fogOver\(in\.view,uni\.eye\.xyz\),vec4f\(0\.0,0\.0,0\.0,1\.0\),fogFree\)/,
  )
  // The eye is the view's third-last vec4: 160 bytes of fields before it, 16 of its own; the pixel
  // ratio a line's width is scaled by (#348), the texture level offset (#816) and the display
  // layers' exposure and curve (#558) follow it, in the struct's 16-byte alignment.
  assert.match(
    wgslSource(BLEND_VIEW_WGSL),
    /pixelRatio:f32,mipBias:f32,exposure:f32,toneCurve:u32,pixelError:f32,clipPlane:vec4f,\}/,
  )
  // The clip plane of the view's, a vec4 behind them (`clipPlane`): 208 bytes.
  assert.equal(BLEND_VIEW_SIZE, 208)
})

/** The kind of resource a layout holds at each of `bindings`: a sampler, a texture by its dimension,
 *  a storage texture, a buffer by its type. */
function kindsAt(entries: GPUBindGroupLayoutEntry[], bindings: Record<string, number>) {
  const kind = (e: GPUBindGroupLayoutEntry | undefined) =>
    e?.sampler
      ? 'sampler'
      : e?.texture
        ? e.texture.viewDimension
        : e?.storageTexture
          ? `storage ${e.storageTexture.viewDimension}`
          : e?.buffer?.type
  return Object.fromEntries(
    Object.entries(bindings).map(([name, at]) => [
      name,
      kind(entries.find((e) => e.binding === at)),
    ]),
  )
}

test('every program that lays the fog over a pixel reads the cubemap and the volume through the sampler, on the numbers of its layout', () => {
  fakeDevice() // WebGPU's globals, which the layouts name their stages by
  const kinds = { fogSampler: 'sampler', fogCubemap: 'cube', fogVolume: '3d' }
  const declarations = {
    fogSampler: 'var fogSampler:sampler;',
    fogCubemap: 'var fogCubemap:texture_cube<f32>;',
    fogVolume: 'var fogVolume:texture_3d<f32>;',
  }
  const programs = [
    {
      texts: [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER],
      at: DEFERRED_BINDINGS,
      layout: deferredLayoutEntries(true, true),
    },
    // The translucent layers bind the same three: the casters' memory, the blue noise and the front's
    // radiance are read-only storage textures, which leave the sampled ones room (`stageLimits.test.ts`).
    { texts: [BLEND_SHADER, TRANSMIT_SHADER], at: BLEND_BINDINGS, layout: blendLayoutEntries(208) },
    {
      texts: [AIR_PROGRAMS.sky.code],
      at: AIR_BINDING,
      layout: airLayoutEntries(AIR_PROGRAMS.sky.bindings, 2),
    },
  ]
  for (const { texts, at, layout } of programs) {
    const place = (name: string) => at[name as keyof typeof at]
    for (const text of texts)
      for (const [name, declaration] of Object.entries(declarations))
        assert.ok(text.includes(`@binding(${place(name)}) ${declaration}`), `${name} at its number`)
    assert.deepEqual(
      kindsAt(layout, Object.fromEntries(Object.keys(kinds).map((name) => [name, place(name)]))),
      kinds,
    )
    // The volume's view lies in the light buffer, not in a binding of its own.
    for (const text of texts) assert.doesNotMatch(text, /var<uniform> fogView/)
  }
  // The unlit program lays no fog: it binds none.
  assert.doesNotMatch(UNLIT_LIGHTING_SHADER, /fogView|fogVolume/)
})

/** A lit scene drawn by the engine's own frame on the kit's device: a sun, the fog `fog`, and the
 *  frames its pipelines compile in (a frame is held while one does). */
async function litFrames(fog: SceneFog, options: Partial<EngineContext> = {}) {
  const { rt, gpu } = await drawnQuad(options)
  rt.lights.store.setView('lit')
  rt.lights.store.add({
    id: 'sun',
    kind: 'directional',
    direction: [0, -1, 0],
    color: [1, 1, 1],
    intensity: 3,
    castsShadow: false,
  })
  rt.lights.store.setEnvironment({ exposure: 1, fog })
  const draw = async () => {
    gpu.commands.length = 0
    gpu.dispatches.length = 0
    renderWebgpuPages(rt, quadCamera())
    await flushWebgpuPages(rt)
    return [...gpu.commands]
  }
  for (let i = 0; i < 6; i++) await draw()
  return { rt, gpu, draw }
}
const FOG_PASS = 'compute Trillion3D fog volume'
const LIGHTING_PASS = `render ${DEFERRED_LIGHTING_PASS}`

test('a frame with the volumetric fog on builds the volume between the light lists and the lighting, its three passes in order', async () => {
  const { rt, gpu, draw } = await litFrames({ baseDensity: 0.01, volumetric: true })
  const frame = await draw()
  const fog = frame.indexOf(FOG_PASS)
  assert.ok(frame.indexOf(`compute ${LIGHT_TILES_PASS}`) < fog, 'after the light lists')
  assert.ok(fog < frame.indexOf(LIGHTING_PASS), 'before the lighting that reads it')
  assert.equal(frame.filter((command) => command === FOG_PASS).length, 1, 'one compute pass')
  // Its furthest depth reads the pyramid of this very image: the raster's last build (the culling
  // layer, rebuilt after the rest pass) and the finished depth's layers (the depth pass of the
  // reflections) both come before it.
  const built = frame.lastIndexOf(`compute ${HIZ_PASS}`)
  const finished = frame.indexOf(`compute ${REFLECTION_PASS}`)
  assert.ok(built >= 0 && built < finished && finished < fog, 'after the pyramid is built')
  const entries = gpu.dispatches.map((d) => d.entryPoint)
  const first = entries.indexOf('furthestMain')
  assert.deepEqual(entries.slice(first, first + 3), [
    'furthestMain',
    'scatterMain',
    'integrateMain',
  ])
  // What the lighting, the blends and the sky are bound to is the volume it built, kept from one
  // image to the next while nothing changes; not the stand-ins a scene with no volume reads.
  const { placeholders } = rt.gpu.deferred!
  const read = rt.gpu.fogVolume?.read
  assert.ok(read && read === directLightResources(rt).fog)
  assert.notEqual(read.volume, placeholders.fog.volume)
  await draw()
  assert.equal(rt.gpu.fogVolume?.read, read)
})

test('a volumetric fog the run holds off draws no volume and the programs read the stand-ins', async () => {
  const { rt, draw } = await litFrames(
    { baseDensity: 0.01, volumetric: true },
    { volumetricFogQuality: 'off' },
  )
  assert.ok(!(await draw()).includes(FOG_PASS))
  assert.equal(directLightResources(rt).fog?.volume, rt.gpu.deferred!.placeholders.fog.volume)
  assert.equal(rt.gpu.fogVolume?.gpu, undefined, 'its pipelines are not even compiled')
})

test('a scene with no volumetric fog makes none of it: no pass, no state', async () => {
  const { rt, draw } = await litFrames({ baseDensity: 0.01 })
  assert.ok(!(await draw()).includes(FOG_PASS))
  assert.equal(rt.gpu.fogVolume, undefined)
})

/** The view block the last image wrote into the light buffer: its eye lane, 1 where the volume was built. */
function builtLane(gpu: Awaited<ReturnType<typeof litFrames>>['gpu']) {
  const written = gpu.writes.filter((w) => w.offset === LIGHT_BUFFER_AT.fogView).at(-1)
  assert.ok(written, 'the view block is written into the light buffer')
  const floats = new Float32Array(written.data.buffer, written.data.byteOffset, FOG_VIEW_FLOATS)
  return floats[FOG_VIEW_SLOT.eye * 4 + 3]
}

test('the volume tells the surfaces it was built in the light buffer: the view block, zeroed when it is not', async () => {
  const built = await litFrames({ baseDensity: 0.01, volumetric: true })
  await built.draw()
  assert.equal(builtLane(built.gpu), 1)
  const off = await litFrames(
    { baseDensity: 0.01, volumetric: true },
    { volumetricFogQuality: 'off' },
  )
  await off.draw()
  assert.equal(builtLane(off.gpu), 0)
})

test('each view holds its own volume and history: a released view lets its own go, the main view keeps its', async () => {
  const { rt, draw } = await litFrames({ baseDensity: 0.01, volumetric: true })
  await draw()
  const main = rt.gpu.fogVolume
  assert.ok(main?.gpu)
  const side = createWebgpuView(16, 16)
  useWebgpuView(rt, side)
  assert.equal(rt.gpu.fogVolume, undefined, 'the side view has none yet')
  for (let i = 0; i < 6; i++) {
    renderWebgpuPages(rt, awayCamera())
    await flushWebgpuPages(rt)
  }
  assert.ok(rt.gpu.fogVolume?.gpu && rt.gpu.fogVolume !== main, 'a volume of its own')
  releaseWebgpuView(rt, side)
  assert.equal(side.gpu.fogVolume, undefined, 'released with the view')
  assert.equal(rt.gpu.fogVolume, main, 'the main view finds its own back')
})

test('a scene that drops its fog lets its volume go', async () => {
  const { rt, draw } = await litFrames({ baseDensity: 0.01, volumetric: true })
  await draw()
  assert.ok(rt.gpu.fogVolume?.gpu)
  rt.lights.store.setEnvironment({ exposure: 1 })
  await draw()
  assert.equal(rt.gpu.fogVolume, undefined)
})

test('the fog’s stand-ins are made when a program first reads them, once, and let go with the others', () => {
  const gpu = fakeDevice()
  const standIns = () => gpu.textures.filter((t) => t.label?.startsWith('Trillion3D fog no'))
  const placeholders = createDeferredPlaceholders(gpu.device)
  assert.equal(standIns().length, 0, 'a scene with no fog makes none')
  const { fog } = placeholders
  assert.equal(standIns().length, 2, 'the cubemap and the volume')
  assert.equal(placeholders.fog, fog, 'the same object on every read')
  assert.equal(standIns().length, 2)
  placeholders.dispose()
  assert.ok(standIns().every((t) => gpu.destroyed.includes(t)))
})
