// The closure slices of the surface record and the resolve that writes them: the layout a view's most closures asks, the record that holds
// it, the closure offsets word, and the module of a material of several closures, the single-closure module left as it was.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { isProgram, programOf } from '../graph/surfaceProgram.ts'
import { shadeShader, SHADE_SHADER } from '../../visibility/shader/shadeWgsl.ts'
import { closureWriter } from '../../visibility/shader/shadeClosuresWgsl.ts'
import { reservedNames, unbalanced, unresolvedNames } from '../../gpu/core/wgslNames.fixture.ts'
import { SURFACE_BYTES_PER_PIXEL } from './surfaceBuffer.ts'
import { createSurfaceBuffer } from './surfaceAllocation.ts'
import { closureOffsetsOf } from './closureOffsets.ts'
import { closureCountOf, closureSlotsOf } from '../closures/viewClosures.ts'
import {
  closureColourLayers,
  closureCoverageLayer,
  closureFlagsLayerOf,
  closureOffsetsLayerOf,
  SURFACE_WORD_LAYERS,
  closureWordLayers,
  closuresHeld,
} from './surfaceOutputs.ts'

test('a view of one closure holds no slice, a view of several two colour layers each past the first, a coverage word each, five words (flags and lobes) each past the first and the offsets', () => {
  assert.deepEqual([0, 1, 1.5].map(closuresHeld), [1, 1, 1])
  assert.equal(closuresHeld(8), 8)
  assert.deepEqual([1, 2, 3, 8].map(closureColourLayers), [0, 2, 4, 14])
  assert.deepEqual([1, 2, 3, 8].map(closureWordLayers), [0, 8, 14, 44])
  // The offsets are the last layer, the closure flags follow the coverages, five layers each: the layers the shaders compute, read from their text.
  const expression = /return (.*);\}$/.exec(closureFlagsLayerOf.text)![1].replace(/(\d)u\b/g, '$1')
  const flagsLayer = new Function('held', 'closure', `return ${expression}`) as (
    held: number,
    closure: number,
  ) => number
  assert.match(closureOffsetsLayerOf.text, /return closureFlagsLayerOf\(held,held\);\}$/)
  assert.deepEqual(
    [2, 3, 8].map((held) => flagsLayer(held, held)),
    [8, 14, 44],
  )
  assert.deepEqual(
    [2, 3, 8].map((held) => SURFACE_WORD_LAYERS + closureWordLayers(held) - 1),
    [8, 14, 44],
  )
  assert.deepEqual(
    [
      [2, 1],
      [3, 1],
      [3, 2],
      [8, 7],
    ].map(([held, k]) => flagsLayer(held, k)),
    [3, 4, 9, 39],
  )
  assert.deepEqual([0, 1, 7].map(closureCoverageLayer), [1, 2, 8])
})

test('the closure offsets are packed as relative steps of four bits, the first closure first', () => {
  assert.deepEqual([0, 1].map(closureOffsetsOf), [0, 0])
  assert.equal(closureOffsetsOf(2), 0x10)
  assert.equal(closureOffsetsOf(3), 0x110)
  assert.equal(closureOffsetsOf(8), 0x11111110)
  // A ninth closure is not packed.
  assert.equal(closureOffsetsOf(9), 0x11111110)
})

test('a record of several closures holds their layers; of one it is the single-closure record', () => {
  const plain = fakeDevice({ limits: { maxTextureDimension2D: 4096 } })
  const one = createSurfaceBuffer(plain.device, 64, 32)
  const same = createSurfaceBuffer(plain.device, 64, 32, { closures: 1 })
  assert.equal(same.allocationBytes, one.allocationBytes)
  assert.equal(same.layers, one.layers)
  assert.equal(one.closures, 1)
  assert.equal(one.allocationBytes, 64 * 32 * SURFACE_BYTES_PER_PIXEL + 8 + 16)
  const many = fakeDevice({ limits: { maxTextureDimension2D: 4096 } })
  const three = createSurfaceBuffer(many.device, 64, 32, { closures: 3 })
  assert.equal(three.closures, 3)
  // The base and the normal, the emission and occlusion, two layers each of the two closures past the first.
  const layersOf = (name: string) =>
    many.textures.find((t) => t.label === `Trillion3D surface ${name}`)!.depthOrArrayLayers
  assert.equal(layersOf('colours'), 3 + 4)
  assert.equal(layersOf('words'), 1 + 14)
  // Their first layer and their count ride above the emission's layer in the head's word.
  assert.equal(three.layers >>> 16, (3 << 8) | 3)
  assert.equal(three.layers & 0xffff, 2)
  assert.equal(three.allocationBytes - one.allocationBytes, 64 * 32 * (4 * 8 + 14 * 4))
})

/** The program of a surface of closures, fitted to `limit`: `layers`, a mix of two slabs (one wiring a normal) over a third; `first`, the
 *  same with the mix blended from the start into the first closure; `second`, a slab over the mix, which a limit of two blends. */
function treeProgram(limit: number, shape: 'layers' | 'first' | 'second' = 'layers') {
  const g = material.graph('surface')
  const slab = (r: number, normal = false) =>
    g.slab({
      baseColor: g.constant(r, 0, 0),
      roughness: g.constant(r / 10),
      ...(normal && { normal: g.constant(0, 0, 1) }),
    })
  const a = slab(1),
    b = slab(2, true),
    c = slab(3)
  const mix = g.horizontalMix(a, b, g.scalarParameter('mix', 0.5), shape === 'first')
  g.closures(shape === 'second' ? g.verticalLayer(c, mix) : g.verticalLayer(mix, c))
  const program = programOf({ graph: g }, undefined, limit)
  assert.ok(isProgram(program))
  return program.compiled
}

function valid(code: string) {
  assert.deepEqual(unresolvedNames(code), [])
  assert.deepEqual(reservedNames(code), [])
  assert.equal(unbalanced(code), '')
}

test('the module of a material of several closures stores them; that of one closure is the single-closure module', () => {
  const three = shadeShader({ graph: treeProgram(4) })
  assert.match(three, /fn storeClosures\(at:vec2u\)/)
  assert.match(three, /var<private> closureOuts:array<ClosureOut,3>/)
  assert.match(three, /storeClosures\(at\.xy\);/)
  // The third closure is the base of a layering: its word holds the weight its top leaves it.
  assert.match(three, /closureOuts\[2\]\.coverage=closureWeightedWord\(/)
  // The offsets word follows the last coverage layer, for the material's three closures held to what the record holds.
  assert.match(three, /vec4u\(closureOffsets\(min\(3u,held\.y\)\),/)
  assert.match(three, new RegExp(`fn closureOffsets\\(n:u32\\).*${closureOffsetsOf(8)}u`))
  valid(three)
  // The closures past the first are written only where the record holds them, and add their emission, weighed by their coverage, to the pixel's.
  assert.match(three, /if\(mgHeld\.y>2u\)/)
  assert.match(three, /emissive\+=.*\*saturate\(/)
  // Fitted to one closure, the tree is a graph of one: the module has none of it.
  const one = shadeShader({ graph: treeProgram(1) })
  assert.doesNotMatch(one, /closureOuts|storeClosures|surfaceClosures/)
  valid(one)
  assert.doesNotMatch(SHADE_SHADER, /closureOuts|storeClosures|surfaceClosures/)
})

test('a closure blended from several slabs is mixed by its subtree; the first closure blended reads the blend', () => {
  const first = shadeShader({ graph: treeProgram(4, 'first') })
  assert.match(first, /let mgBlend0=mgClosureBlend\d+\(mgPixel,mgGiven\);/)
  assert.match(first, /rgb=saturate\(mgBlend0\.base\)/)
  assert.match(first, /let mgMap=mgBlend0\.normal;/)
  assert.match(first, /struct MgBlend\{/)
  assert.match(first, /closureOuts\[0\]\.coverage=closureCoverageWord\(saturate\(mgBlend0\.cov\)\)/)
  valid(first)
  // A blend in the second closure: the closure is stored from the blend's fields, the normal bent from its.
  const second = shadeShader({ graph: treeProgram(2, 'second') })
  assert.match(second, /let mgBlend1=mgClosureBlend\d+\(mgPixel,mgGiven\);/)
  assert.match(second, /closureOuts\[1\]\.baseMetal=vec4f\(saturate\(mgBlend1\.base\)/)
  assert.match(second, /bendNormal\(mgN0,mgTk,mgBk,.*mgBlend1\.normal\)/)
  valid(second)
})

test('every operator blends: the weight scales the coverage, the mix and the add share by coverage, the layering weighs top and base', () => {
  const g = material.graph('surface')
  const slab = (r: number) =>
    g.slab({ baseColor: g.constant(r, 0, 0), emissive: g.constant(0, r, 0) })
  const [a, b, c, d] = [1, 2, 3, 4].map(slab)
  const weighted = g.weightClosure(a, 0.25)
  const mixed = g.horizontalMix(weighted, b, 0.3)
  const layered = g.verticalLayer(mixed, c)
  g.closures(g.addClosures(layered, d))
  const program = programOf({ graph: g }, undefined, 1)
  assert.ok(isProgram(program))
  const text = program.compiled.wgsl.text
  assert.match(text, /\.cov=b\d+\.cov\*saturate\(0\.25/)
  assert.match(text, /let f\d+=saturate\(b\d+\.cov\)\*m\d+\/max\(1e-10,/)
  assert.match(text, /let tc\d+=saturate\(b\d+\.cov\);/)
  assert.match(text, /let cv\d+=tc\d+\+\(1\.0-tc\d+\)\*bc\d+;/)
  assert.match(text, /saturate\(b\d+\.cov\+b\d+\.cov\)/)
  // The add sums what adds light, as the reference's: the emission, and the diffuse albedo and the F0 held to one, given back as base colour, metalness and specular.
  const add = text.match(/let dd(\d+)=saturate\(b(\d+)\.base\*\(1\.0-b\d+\.metal\)\+/)
  assert.ok(add, 'the albedos are summed and saturated')
  assert.match(
    text,
    /let kk\d+=saturate\(mix\(vec3f\(0\.08\*b\d+\.spec\),b\d+\.base,b\d+\.metal\)\+mix\(/,
  )
  assert.match(text, /let b\d+=MgBlend\(ab\d+,am\d+,sp\d+,[^\n]*b\d+\.emissive\+b\d+\.emissive/)
  const shader = shadeShader({ graph: program.compiled })
  valid(shader)
  assert.equal(program.compiled.closures!.flat.closures.length, 1)
  assert.equal(program.compiled.closures!.blends.size, 1)
})

test('a closure past the first adds its emission to the pixel, weighed by its coverage', () => {
  const g = material.graph('surface')
  const lit = g.slab({ baseColor: g.constant(1, 0, 0), emissive: g.constant(0, 2, 0) })
  const dark = g.slab({ baseColor: g.constant(0, 1, 0), emissive: g.constant(0, 0, 3) })
  g.closures(g.horizontalMix(lit, dark, 0.25))
  const program = programOf({ graph: g }, undefined, 8)
  assert.ok(isProgram(program))
  const text = shadeShader({ graph: program.compiled })
  assert.match(text, /emissive\+=max\(mgEmissive\w*\(mgPixel,mgGiven\),vec3f\(0\.0\)\)\*saturate\(/)
  valid(text)
})

test('the base of a vertical layering stores the luminance weight its top leaves it, and weighs its emission by it', () => {
  const g = material.graph('surface')
  const top = g.weightClosure(g.slab({ baseColor: g.constant(1, 0, 0) }), 0.4)
  const base = g.slab({ baseColor: g.constant(0, 1, 0), emissive: g.constant(0, 0, 3) })
  g.closures(g.verticalLayer(top, base))
  const program = programOf({ graph: g }, undefined, 8)
  assert.ok(isProgram(program))
  const closures = program.compiled.closures!.flat.closures
  assert.deepEqual(closures[0]!.layers, [])
  assert.deepEqual(closures[1]!.layers, [{ tops: [0], outside: 0 }])
  const text = shadeShader({ graph: program.compiled })
  // The top's coverage is its weight; the weight is squared (the view's and the light's attenuation), the first closure keeps the full one.
  assert.match(text, /let mgLayer=\(1\.0-saturate\(saturate\(0\.4/)
  assert.match(text, /closureOuts\[1\]\.coverage=closureWeightedWord\(1\.0,mgLayer\*mgLayer\);/)
  assert.match(text, /closureOuts\[0\]\.coverage=closureCoverageWord\(/)
  assert.match(text, /emissive\+=.*\*saturate\(1\.0\)\*mgLayer;/)
  valid(text)
})

// The add's inverse of (albedo, F0) to (base, metalness, specular), written here as the blend's lines write it: exact where the sum can be written in the slab's three scalars.
type Slab = { base: number[]; metal: number; spec: number }
const lumaOf = (c: number[]) => 0.2126390059 * c[0]! + 0.7151686788 * c[1]! + 0.0721923154 * c[2]!
const albedoOf = (s: Slab) => s.base.map((x) => x * (1 - s.metal))
const f0Of = (s: Slab) => s.base.map((x) => 0.08 * s.spec * (1 - s.metal) + x * s.metal)
function addSlabs(a: Slab, b: Slab): Slab {
  const sat = (x: number) => Math.min(1, Math.max(0, x))
  const d = albedoOf(a).map((x, i) => sat(x + albedoOf(b)[i]!))
  const k = f0Of(a).map((x, i) => sat(x + f0Of(b)[i]!))
  const dd = d.reduce((s, x) => s + x * x, 0),
    du = d[0]! + d[1]! + d[2]!,
    dk = d.reduce((s, x, i) => s + x * k[i]!, 0),
    uk = k[0]! + k[1]! + k[2]!,
    det = 3 * dd - du * du
  const grey = Math.min(...k, 0.08)
  const fitted = det > 1e-4 * dd
  const c = fitted
    ? Math.max(0, (3 * dk - du * uk) / det)
    : lumaOf(k.map((x) => x - grey)) / Math.max(1e-10, lumaOf(d))
  const g = fitted ? Math.max(0, (dd * uk - du * dk) / det) : grey / (1 + c)
  const base = d.map((x, i) => sat(x + k[i]! - g))
  return { base, metal: c / (1 + c), spec: sat((g * (1 + c)) / 0.08) }
}

test('the add of two slabs gives back the summed albedo and F0 where the three scalars can hold them', () => {
  const near = (got: number[], want: number[]) =>
    got.forEach((x, i) => assert.ok(Math.abs(x - want[i]!) < 1e-6, `${got} vs ${want}`))
  // Two dielectrics: the albedos add, the greys add (up to the specular's most).
  const dielectric = addSlabs(
    { base: [0.2, 0.1, 0.05], metal: 0, spec: 0.25 },
    { base: [0.1, 0.3, 0.2], metal: 0, spec: 0.25 },
  )
  assert.ok(dielectric.metal < 1e-9)
  near(dielectric.base, [0.3, 0.4, 0.25])
  assert.ok(Math.abs(dielectric.spec - 0.5) < 1e-6)
  // Two metals: no albedo, the F0s add, the base colour is their sum.
  const metals = addSlabs(
    { base: [0.5, 0.2, 0.1], metal: 1, spec: 0.5 },
    { base: [0.3, 0.3, 0.1], metal: 1, spec: 0.5 },
  )
  assert.ok(Math.abs(metals.metal - 1) < 1e-6)
  near(metals.base, [0.8, 0.5, 0.2])
  // A metal and a dielectric of the same hue: the albedo and the F0 both come back.
  const a: Slab = { base: [0.4, 0.2, 0.1], metal: 1, spec: 0.5 },
    b: Slab = { base: [0.2, 0.1, 0.05], metal: 0, spec: 0 }
  const mixed = addSlabs(a, b)
  near(
    albedoOf(mixed),
    albedoOf(b).map((x, i) => Math.min(1, x + albedoOf(a)[i]!)),
  )
  near(
    f0Of(mixed),
    f0Of(a).map((x, i) => Math.min(1, x + f0Of(b)[i]!)),
  )
})

test("the pixel's occlusion is its first closure's alone: the reference keeps one material occlusion for the pixel, no closure past the first stores its own", () => {
  const g = material.graph('surface')
  const first = g.slab({ baseColor: g.constant(1, 0, 0), ambientOcclusion: g.constant(0.5) })
  const second = g.slab({ baseColor: g.constant(0, 1, 0), ambientOcclusion: g.constant(0.25) })
  g.closures(g.horizontalMix(first, second, 0.5))
  const program = programOf({ graph: g }, undefined, 8)
  assert.ok(isProgram(program))
  const { slabs, flat } = program.compiled.closures!
  const own = slabs.get(flat.closures[1].members[0].slab)!.ambientOcclusion
  assert.ok(own, 'the second slab compiles its occlusion')
  const text = shadeShader({ graph: program.compiled })
  // Declared, never called by the closure writer: one occurrence, its declaration.
  assert.equal(text.split(`${own}(`).length - 1, 1)
  valid(text)
})

test('a closure past the first keeps its own specular and lobes: flags and a lobes texel in its word layers, the first closure marked where only a later one has a lobe', () => {
  const g = material.graph('surface')
  const plain = g.slab({ baseColor: g.constant(1, 0, 0), roughness: g.constant(0.4) })
  const coated = g.slab({
    baseColor: g.constant(0, 1, 0),
    specular: g.constant(0.8),
    clearCoat: g.constant(1),
    clearCoatRoughness: g.constant(0.1),
    anisotropy: g.constant(0.5),
  })
  g.closures(g.horizontalMix(plain, coated, 0.5))
  const program = programOf({ graph: g }, undefined, 2)
  assert.ok(isProgram(program))
  const text = shadeShader({ graph: program.compiled })
  valid(text)
  // The second closure computes its lobes at its own normal, from its slab's outputs, and keeps its specular in the bits the first closure's takes.
  assert.match(text, /var mgLobes=physicalValues\(Nk,coatBase,/)
  assert.match(
    text,
    /closureOuts\[1\]\.lobes=physicalTexel\(mgLobes\);closureOuts\[1\]\.flags\|=64u;/,
  )
  assert.match(text, /closureOuts\[1\]\.flags\|=specularFlag\(/)
  // Its flags (the pixel's but for the specular and the lobe mark) and the four words of its texel follow the coverages, the offsets last.
  assert.match(
    text,
    /textureStore\(wordsOut,at,closureFlagsLayerOf\(held\.y,1u\),vec4u\(\(closureBase&~65344u\)\|closureOuts\[1\]\.flags/,
  )
  assert.match(
    text,
    /textureStore\(wordsOut,at,closureFlagsLayerOf\(held\.y,1u\)\+4u,vec4u\(closureOuts\[1\]\.lobes\[3\]/,
  )
  assert.match(text, /closureOffsetsLayerOf\(held\.y\),vec4u\(/)
  // The first closure has no lobe: it is marked all the same, with an empty texel, so that the pixel lights as one that holds lobes.
  assert.match(text, /\(\(closureOuts\[1\]\.flags\)&64u\)!=0u\)\{\n {2}textureStore\(lobesOutput,/)
  // A tree whose slabs wire neither has none of it.
  const bare = shadeShader({ graph: treeProgram(4) })
  assert.doesNotMatch(bare, /mgLobes|lobesOutput,vec2i\(pos/)
  valid(bare)
})

test('the fused vertical layering shows the base only where the top is absent, as the separate closures do (an opaque top has no transmittance)', () => {
  const g = material.graph('surface')
  const top = g.slab({ baseColor: g.constant(1, 0, 0) })
  const base = g.slab({ baseColor: g.constant(0, 1, 0) })
  g.closures(g.verticalLayer(top, base, true))
  const program = programOf({ graph: g }, undefined, 8)
  assert.ok(isProgram(program))
  const text = program.compiled.wgsl.text
  // The base's share is what the top leaves uncovered, over the coverage (the reference's SurfaceBottom over Coverage).
  assert.match(text, /let bf\d+=\(1\.0-tc\d+\)\*bc\d+\/max\(1e-10,cv\d+\);/)
  valid(shadeShader({ graph: program.compiled }))
})

test("the first closure's emission is weighed by its coverage as every closure's", () => {
  const g = material.graph('surface')
  const lit = g.slab({ baseColor: g.constant(1, 0, 0), emissive: g.constant(0, 2, 0) })
  const dark = g.slab({ baseColor: g.constant(0, 1, 0), emissive: g.constant(0, 0, 3) })
  g.closures(g.horizontalMix(lit, dark, 0.25))
  const program = programOf({ graph: g }, undefined, 8)
  assert.ok(isProgram(program))
  const writer = closureWriter(program.compiled)!
  assert.match(writer.emission, /^ \{\n {2}emissive\*=saturate\(/)
  assert.match(writer.after, /emissive\*=saturate\(/)
  assert.match(writer.choice, /emissive\*=saturate\(/)
  // A closure at full coverage keeps the pixel's emission as it is.
  const plain = material.graph('surface')
  plain.closures(plain.addClosures(plain.slab({}), plain.slab({})))
  const whole = programOf({ graph: plain }, undefined, 8)
  assert.ok(isProgram(whole))
  assert.ok(!closureWriter(whole.compiled)!.after.includes('emissive*='))
})

test('a tree that flattens to one closure carrying a weight keeps it: a writer, and a record that holds two closures', () => {
  const weighted = material.graph('surface')
  weighted.closures(
    weighted.weightClosure(weighted.slab({ emissive: weighted.constant(0, 2, 0) }), 0.3),
  )
  const program = programOf({ graph: weighted }, undefined, 8)
  assert.ok(isProgram(program))
  assert.equal(closureCountOf(program.compiled), 1)
  assert.equal(closureSlotsOf(program.compiled), 2)
  const text = shadeShader({ graph: program.compiled })
  assert.match(text, /closureOuts\[0\]\.coverage=closureCoverageWord\(saturate\(0\.3/)
  assert.match(text, /emissive\*=saturate\(saturate\(0\.3/)
  valid(text)
  // A weight of one, and a graph without a tree, are the plain one closure: no writer, one slot, the text as it was.
  for (const make of [
    (g: ReturnType<typeof material.graph>) => g.closures(g.weightClosure(g.slab({}), 1)),
    (g: ReturnType<typeof material.graph>) => g.closures(g.slab({})),
    () => undefined,
  ]) {
    const g = material.graph('surface')
    make(g)
    const plain = programOf({ graph: g }, undefined, 8)
    assert.ok(isProgram(plain))
    assert.equal(closureSlotsOf(plain.compiled), 1)
    assert.equal(closureWriter(plain.compiled), undefined)
  }
})
