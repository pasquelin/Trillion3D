// Fog is a term of the one lighting model (#345): every pass that lays one over a surface — the fog pass
// over the lit image, the blended and transmissive surfaces — hands
// its colour through the fog before the display chain, measured from
// the eye each pass carries. An unlit material is fogged too; a normal or depth
// material, the diagnostic views and the composition are left as they were.
import test from 'node:test'
import assert from 'node:assert/strict'
import { CONTRACT_COMPOSITIONS } from './deferred/shaders.ts'
import { BLEND_VIEW_SIZE, BLEND_VIEW_WGSL } from '../blend/viewLayout.ts'
import { BAKE_BYTES } from './toneBakeWgsl.ts'
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts'
import {
  BLEND_SHADER,
  litPassShaders,
  TRANSMIT_SHADER,
  UNLIT_LIGHTING_SHADER,
} from '../gpu/core/shaderTexts.fixture.ts'
import { wgslSource } from '../../../math/src/wgsl/source.fixture.ts'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { fogComposeWgsl } from './fogCompose.ts'
import { newFogStaticLight, setFogStaticLight } from './fog/staticLight.ts'
import type { SkyLightPart } from '../../../sdk-core/src/modules/sky/skyLight.ts'
import type { VolumetricLightmapData } from '../../../sdk-core/src/lighting/volumetricLightmapFile.ts'
import { DEFERRED_BINDINGS } from './deferred/bindings.ts'
import { heightFogLayoutEntries } from './deferred/layoutEntries.ts'
import { BLEND_BINDINGS } from '../gpu/bind/bindLayout.ts'
import { blendLayoutEntries } from '../gpu/bind/blendBindEntries.ts'
import { AIR_PROGRAMS } from './atmosphere/airPrograms.fixture.ts'

test('the fog pass fogs the surface at the pixel, from the eye in display.yzw, and no light pass does', () => {
  for (const passes of [litPassShaders(false), litPassShaders(true)]) {
    // The surface's fog: its point, from the eye, the transmittance and the inscattering laid over the lit image.
    assert.match(passes.fog, /let eye=view\.display\.yzw;/)
    assert.match(
      passes.fog,
      /over=fogOpaque\(worldAt\(pixel\.xy,textureLoad\(depth,coord,0\)\),eye,pixel\.xy\);/,
    )
    assert.match(passes.fog, /return vec4f\(preExposed\(over\.rgb\),1\.0-over\.a\);/)
    // An unlit or matcap surface (flag 1) is fogged; a diagnostic, normal or depth one (flag 3) is not, nor is
    // a surface that opts out.
    assert.match(passes.fog, /if\(flag==3u\|\|\(surfaceFlag&128u\)!=0u\)\{discard;\}/)
    // No other pass lays any: the lights and the surface's colour hand their light on as it is.
    for (const pass of ['colour', 'sun', 'local', 'indirect'] as const)
      assert.doesNotMatch(passes[pass], /fogOpaque|fogged|fogBeyond/, pass)
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
  // branch (a shadow catcher keeps its colour); the fog (per blend mode) closes the branch that skips the
  // unlit view, which keeps what it emits.
  assert.match(
    BLEND_SHADER,
    /if\(!unlit\)\{\s+if\(BLEND_LIGHTING!=L_UNLIT&&blendLit\(flags\)\)\{[^]*?rgb=litSurface\([^;]*s\.emissive,[^;]+\);\s+\}\s+\}\s+(?:\/\/.*\s+)+if\(!\(\(flags&1048576u\)!=0u\)\)\{[^]*?rgb=rgb\*fog\.a\+fog\.rgb\*inscatterShare\(alpha\);\s+\}\s+\}\s+\}else\{rgb\+=s\.emissive;\}/,
  )
  assert.match(TRANSMIT_SHADER, /let fogFree=unlit\|\|\(flags&1048576u\)!=0u;/)
  assert.match(
    TRANSMIT_SHADER,
    /var fog=vec4f\(0\.0,0\.0,0\.0,1\.0\);\s+if\(!fogFree\)\{fog=blendFog\(in\);\}/,
  )
  // The eye follows 176 bytes of fields (the matrix and four vec4 to 128, the light tiles' pair, five words — the view's flags, the vertex
  // shift, the feedback, the rough diffuse and the accurate shading's switches — and the viewport's pair, the eye's vec3 aligned to 16);
  // the pixel ratio a line's width is scaled by (#348), the texture level offset (#816) and the display
  // layers' exposure, the image's pre-exposure and the curve (#558) follow it, then the cut's pixel
  // error, the clocks a material graph reads (`time` and `realTime`) and the clear coat's switch
  // (`clearCoatNormal`), in the gap before the clip plane, in the struct's 16-byte alignment.
  assert.match(
    wgslSource(BLEND_VIEW_WGSL),
    /pixelRatio:f32,mipBias:f32,exposure:f32,preExposure:f32,toneCurve:u32,pixelError:f32,time:f32,realTime:f32,clearCoatNormal:u32,clipPlane:vec4f,bake:Bake,volumeCorner:array<vec4f,2>,volumeScale:array<vec4f,2>,volumeRead:vec4f,giGrid:vec4f,giZ:vec4f,holdout:u32,normalCurvature:vec3f,\}/,
  )
  // The clip plane of the view's, a vec4 behind them at the next 16 bytes (`clipPlane`): 240 bytes, the
  // clock in the gap the plane's alignment left, then the copy of the tone table's baking words, then the translucency
  // lighting volume's five vec4 (two cascades' corners and scales, the read words), the global illumination volume's two (its grid and
  // slices' law), then the holdout word (`holdout`) and the normal curvature's three
  // words, which the struct's 16-byte alignment pads to 32 bytes.
  assert.equal(BLEND_VIEW_SIZE, 240 + BAKE_BYTES + 7 * 16 + 32)
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
      texts: [litPassShaders(false).fog, litPassShaders(true).fog],
      at: DEFERRED_BINDINGS,
      layout: heightFogLayoutEntries(true),
    },
    // The translucent layers bind the same three: the casters' memory, the blue noise and the front's
    // radiance are read-only storage textures, which leave the sampled ones room (`stageLimits.test.ts`).
    { texts: [BLEND_SHADER, TRANSMIT_SHADER], at: BLEND_BINDINGS, layout: blendLayoutEntries(208) },
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
  // The fog pass reads the haze's volume as a 3D texture through the same sampler: the hardware blends its
  // cells; only a volume built at full precision (the view block's `flags.x`) is read by hand from the
  // light buffer, which holds it whole where the texture of half floats would round it.
  const { fog } = litPassShaders(false)
  assert.ok(
    fog.includes(`@binding(${DEFERRED_BINDINGS.hazeVolume}) var hazeVolume:texture_3d<f32>;`),
  )
  assert.match(fog, /textureSampleLevel\(hazeVolume,fogSampler,vec3f\(uv,at\.x\),0\.0\)/)
  assert.match(
    fog,
    /if\(flags\.x!=0\.0\)\{haze=hazeAt\(vec3f\(uv,at\.x\),volume\.xyz,true\);\}else\{haze=textureSampleLevel\(hazeVolume/,
  )
  assert.deepEqual(kindsAt(heightFogLayoutEntries(true), { haze: DEFERRED_BINDINGS.hazeVolume }), {
    haze: '3d',
  })
  // The ray of a sky pixel is parallel to the others in an orthographic view, as the sky is drawn.
  assert.match(
    fog,
    /if\(view\.camera\.w==0\.0\)\{dir=normalize\(worldAt\(pixel\.xy,0\.5\)-worldAt\(pixel\.xy,1\.0\)\);\}/,
  )
  // The unlit program lays no fog: it binds none; nor does the sky's, over which the fog pass lays it.
  assert.doesNotMatch(UNLIT_LIGHTING_SHADER, /fogView|fogVolume/)
  assert.doesNotMatch(AIR_PROGRAMS.sky.code, /fogVolume|fogSampler|fogBeyond/)
})

test('a translucency volume takes the sky light’s whole place in the cells: its term is not left to the static term’s pass either', () => {
  const sky = { light: { mobility: 'stationary', castShadows: true } } as unknown as SkyLightPart
  const from = {
    medium: { staticLightingScatteringIntensity: 1 },
    lit: true,
    skyLighting: true,
    lightmap: { skyBentNormal: {} } as unknown as VolumetricLightmapData,
    sky,
    translucencyGi: false,
  }
  const alone = setFogStaticLight(newFogStaticLight(), from)
  assert.deepEqual([alone.skyDiffuse, alone.skyShadowing], [true, true])
  const volume = setFogStaticLight(newFogStaticLight(), { ...from, translucencyGi: true })
  assert.deepEqual([volume.skyDiffuse, volume.skyShadowing], [true, false])
  assert.equal(volume.intensity, 1, 'the lightmap’s own light stays')
})

test('a fog that holds its light out holds out the local volumes’ and the haze’s inscattering too, as it does the height fog’s and the volume’s', () => {
  const text = wgslSource(fogComposeWgsl(true))
  assert.match(text, /over=fogStack\(fogHeld\(localFogOver\(toward,pixel\)\),over\);/)
  assert.match(text, /over=fogStack\(fogHeld\(localFogOver\(P-eye,pixel\)\),over\);/)
  assert.match(text, /return fogHeld\(localFogOverVertex\(P-eye\)\);/)
  assert.match(text, /over=fogStack\(over,fogHeld\(aerialPerspective\(P,eye\)\)\);/)
  assert.match(text, /fogStack\(fogHeld\(fogVolumeLookup\(P-eye\)\),layer\)/)
})
