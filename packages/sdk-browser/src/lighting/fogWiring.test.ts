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
import { unsettledMask, unsettledReasons } from '../frame/loop/unsettled.ts'
import { settledRt } from '../frame/loop/hold.fixture.ts'
import { historyHorizon } from './fog/layout.ts'
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
      /var rgb=litSurface\(lit,indirect\[0\][^,]*,[^\n]*,indirect\[1\],emissive\.rgb[^,;]*,[^;]*\);[^]*?if\(\(surfaceFlag&128u\)==0u\)\{rgb=foggedOpaque\(rgb,P,view\.display\.yzw,pixel\.xy\);\}/,
    )
  // An unlit or matcap surface (flag 1) is fogged; a diagnostic, normal or depth one (flag 3) is not.
  for (const shader of [DIRECT_LIGHTING_SHADER, BOUNCE_LIGHTING_SHADER]) {
    assert.match(shader, /if\(flag==3u\)\{return vec4f\(base\.rgb,1\.0\);\}/)
    assert.match(
      shader,
      /if\(flag==1u\)\{var rgb=base\.rgb;if\(\(surfaceFlag&128u\)==0u\)\{rgb=foggedOpaque\(rgb,P,view\.display\.yzw,pixel\.xy\);\}/,
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
  // layers' exposure, the image's pre-exposure and the curve (#558) follow it, in the struct's
  // 16-byte alignment.
  assert.match(
    wgslSource(BLEND_VIEW_WGSL),
    /pixelRatio:f32,mipBias:f32,exposure:f32,preExposure:f32,toneCurve:u32,pixelError:f32,clipPlane:vec4f,\}/,
  )
  // The clip plane of the view's, a vec4 behind them at the next 16 bytes (`clipPlane`): 224 bytes.
  assert.equal(BLEND_VIEW_SIZE, 224)
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

test('a volume still blending its history keeps the view drawn; once whole, the view may hold', () => {
  const rt = settledRt()
  type Held = NonNullable<typeof rt.gpu.fogVolume>
  rt.gpu.fogVolume = { gpu: { settling: true } } as unknown as Held
  assert.deepEqual(unsettledReasons(unsettledMask(rt)), ['fogVolume'])
  rt.gpu.fogVolume = { gpu: { settling: false } } as unknown as Held
  assert.equal(unsettledMask(rt), 0, 'a whole history is a steady state')
})

test('the images a volume takes to settle follow its history’s share', () => {
  const horizon = (share: number, uses = true) =>
    historyHorizon({ volumetricFogUsesHistory: uses, volumetricFogHistoryShare: share })
  // 0.9 per image: 0.9^53 is under a 256th, 0.9^52 is not.
  assert.equal(horizon(0.9), 53)
  assert.ok(horizon(0.5) < horizon(0.9) && horizon(0.9) < horizon(0.99))
  assert.deepEqual([horizon(0.9, false), horizon(0), horizon(1), horizon(1.5)], [1, 1, 1, 1])
})
