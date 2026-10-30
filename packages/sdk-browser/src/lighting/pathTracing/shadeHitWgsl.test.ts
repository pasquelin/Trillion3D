// The shade of a hit, assembled: every name declared, the entry present, none of the resolve's bindings of pages and bins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture as WorldTexture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { isProgram, programOf } from '../../materials/graph/surfaceProgram.ts'
import { PT_SHADE_ENTRY, shadeHitProgram } from './shadeHitWgsl.ts'
import { PT_FINISH_ENTRY, ptFinishProgram } from './traceProgram.ts'

test('the shade of the hits of a class has its entry and declares every name it uses', () => {
  assertProgramAssembles(shadeHitProgram(), PT_SHADE_ENTRY, 'the hits shade')
})

test('the shade of the hits binds no page, bin nor surface target of the resolve', () => {
  const text = shadeHitProgram()
  assert.doesNotMatch(
    text,
    /var vis:|var<storage, read> (indices|positions|uvs|pages)|coloursOut|wordsOut|lobesOutput/,
  )
  const storage = [...text.matchAll(/var<storage[^>]*>\s*(\w+)/g)].map((m) => m[1])
  assert.ok(new Set(storage).size <= 8)
  assert.doesNotMatch(text, /Unreal|Epic|Lumen|Nanite|Substrate/)
})

/** The program of a graph that reads a texture and wires a normal. */
function textured() {
  const graph = material.graph('surface')
  graph.output('baseColor', graph.channel(graph.textureSample(new WorldTexture()), 'rgb'))
  graph.output('normal', graph.constant(0, 0, 1))
  const program = programOf({ graph })
  if (!isProgram(program)) throw new Error('the graph of the test does not compile')
  return program
}

test('the shade of the hits of a graph’s class declares every name it uses and shares the resolve’s graph text', () => {
  const { compiled } = textured()
  const text = shadeHitProgram(compiled)
  assertProgramAssembles(text, PT_SHADE_ENTRY, 'the hits shade of a graph')
  assert.match(text, /mgGiven=mgLoad\(max\(m\.graph,1u\)-1u\);/)
  assert.match(text, /rgb=saturate\(mgBaseColor\(mgPixel,mgGiven\)\);/)
})

test('the shade of a blended surface’s graph lets light through by the opacity the graph wires', () => {
  const graph = material.graph('surface')
  graph.output('baseColor', graph.constant(1, 0, 0))
  graph.output('opacity', graph.constant(0.25))
  const program = programOf({ graph, transparent: true })
  if (!isProgram(program) || program.kind !== 'blend')
    throw new Error('the blended graph does not compile')
  const text = shadeHitProgram(program.compiled)
  assertProgramAssembles(text, PT_SHADE_ENTRY, 'the hits shade of a blended graph')
  assert.match(text, /hitVolume\.w=saturate\(mgOpacity_\w+\(mgPixel,mgGiven\)\);/)
  assert.doesNotMatch(shadeHitProgram(), /hitVolume\.w=saturate\(mgOpacity/)
})

test('the shade of the hits of a material of several closures assembles and shades its first closure, none of the resolve’s closure stores', () => {
  const g = material.graph('surface')
  const slab = (r: number) => g.slab({ baseColor: g.constant(r, 0, 0) })
  const mix = g.horizontalMix(slab(1), slab(2), 0.5, true)
  g.closures(g.verticalLayer(mix, slab(3)))
  const program = programOf({ graph: g }, undefined, 8)
  if (!isProgram(program)) throw new Error('the closure tree does not compile')
  const text = shadeHitProgram(program.compiled)
  assertProgramAssembles(text, PT_SHADE_ENTRY, 'the hits shade of closures')
  assert.doesNotMatch(text, /closureOuts|storeClosures/)
})

test('the shade of the hits of a material of several closures adds the emission of the closures past the first, weighed by their coverage', () => {
  const g = material.graph('surface')
  const lit = g.slab({ baseColor: g.constant(1, 0, 0), emissive: g.constant(0, 2, 0) })
  const dark = g.slab({ baseColor: g.constant(0, 1, 0), emissive: g.constant(0, 0, 3) })
  g.closures(g.horizontalMix(lit, dark, 0.25))
  const program = programOf({ graph: g }, undefined, 8)
  if (!isProgram(program)) throw new Error('the closure tree does not compile')
  const text = shadeHitProgram(program.compiled)
  assertProgramAssembles(text, PT_SHADE_ENTRY, 'the hits shade of closures')
  assert.match(text, /emissive\+=max\(mgEmissive\w*\(mgPixel,mgGiven\),vec3f\(0\.0\)\)\*saturate\(/)
  assert.doesNotMatch(text, /closureOuts|storeClosures/)
})

test('the weighted shade of a material of several closures chooses one by resampling and writes the weight of the choice; without the weight the text has none of it', () => {
  const g = material.graph('surface')
  const slab = (r: number, rough: number) =>
    g.slab({ baseColor: g.constant(r, 0, 0), roughness: g.constant(rough) })
  g.closures(g.verticalLayer(g.horizontalMix(slab(1, 0.2), slab(2, 0.9), 0.25, true), slab(3, 0.5)))
  const program = programOf({ graph: g }, undefined, 8)
  if (!isProgram(program)) throw new Error('the closure tree does not compile')
  const text = shadeHitProgram(program.compiled, true)
  assertProgramAssembles(text, PT_SHADE_ENTRY, 'the weighted hits shade of closures')
  assert.match(text, /ptRisAccept\(&mgRis,/)
  assert.match(text, /hitSlabWeight=select\(1\.0,mgRis\.sum\*mgCover\/mgPick,mgPick>0\.0\);/)
  // Each slab is weighed by its coverage times the colour it sends back, and the chosen one's light by its coverage over that weight.
  assert.match(text, /mgPick=mgCover\*hitSlabAlbedo\(rgb,metal,rough,N,specularOfFlags\(flag\)\);/)
  assert.match(text, /let mgC=mgW\*hitSlabAlbedo\(mgRgb,mgMetal,mgRough,Nk,0\.5\);/)
  assert.match(text, /rgb=mgRgb;metal=mgMetal;N=Nk;rough=mgRough;mgPick=mgC;mgCover=mgW;/)
  assert.match(text, /@group\(1\) @binding\(4\) var<storage,read> ptStates:array<vec4f>;/)
  assert.match(text, /hitSlabView=-ptStates\[index\*8u\+3u\]\.xyz;/)
  assert.match(text, /ptMaterials\[index\*4u\+3u\]=vec4u\(bitcast<u32>\(hitSlabWeight\)/)
  assert.doesNotMatch(text, /closureOuts|storeClosures/)
  const plain = shadeHitProgram(program.compiled)
  assert.doesNotMatch(plain, /hitSlab|ptRis|index\*4u|ptStates|directLights/)
  assert.doesNotMatch(shadeHitProgram(), /hitSlab|ptRis|index\*4u/)
})

test('the weighted shade of a material of one closure keeps its closure and writes a weight of one', () => {
  const text = shadeHitProgram(undefined, true)
  assertProgramAssembles(text, PT_SHADE_ENTRY, 'the weighted hits shade')
  assert.match(text, /hitSlabWeight=1\.0;/)
  assert.doesNotMatch(text, /ptRisAccept\(&mgRis/)
})

test('the finish reads the material at the stride of its layout and, with the weight, multiplies the surface by it', () => {
  for (const clouds of [false, true]) {
    const weighted = ptFinishProgram(undefined, clouds, true)
    assertProgramAssembles(weighted, PT_FINISH_ENTRY, 'the weighted finish')
    assert.match(weighted, /ptMaterials\[index\*4u\+3u\]/)
    assert.match(weighted, /s\.selection\*=bitcast<f32>\(ptMaterials\[index\*4u\+3u\]\.x\);/)
    assert.doesNotMatch(weighted, /index\*3u/)
    const plain = ptFinishProgram(undefined, clouds)
    assert.match(plain, /ptMaterials\[index\*3u\]/)
    assert.doesNotMatch(plain, /index\*4u|s\.selection\*=/)
  }
})

/** The chosen slab's light weight, in doubles: the sum of the slabs' weights (coverage times colour sent back) times the chosen one's coverage over its own weight. */
const slabLightWeight = (slabs: readonly { cover: number; colour: number }[], picked: number) => {
  const weights = slabs.map((s) => s.cover * s.colour)
  const sum = weights.reduce((a, b) => a + b, 0)
  const own = weights[picked]!
  return own > 0 ? (sum * slabs[picked]!.cover) / own : 1
}

test('the lights of the slabs, chosen by coverage times colour and weighed back, sum to the coverage weighed lights', () => {
  const slabs = [
    { cover: 0.25, colour: 0.9 },
    { cover: 0.75, colour: 0.3 },
  ]
  // Expected over the choice: the sum over slabs of (chance of the slab) × (its light weight) = the sum of the coverages.
  const sum = slabs.reduce((a, s) => a + s.cover * s.colour, 0)
  const expected = slabs.reduce(
    (a, s, i) => a + ((s.cover * s.colour) / sum) * slabLightWeight(slabs, i),
    0,
  )
  assert.ok(Math.abs(expected - slabs.reduce((a, s) => a + s.cover, 0)) < 1e-12)
  assert.equal(slabLightWeight([{ cover: 1, colour: 0.5 }], 0), 1)
})

test('the hit that chooses a closure past the first takes its specular and its lobes (the cloth’s fuzz) for the hit, the choice weighing it by its own specular', () => {
  const g = material.graph('surface')
  const plain = g.slab({ baseColor: g.constant(1, 0, 0) })
  const fuzzy = g.slab({
    baseColor: g.constant(0, 1, 0),
    specular: g.constant(0.9),
    cloth: g.constant(0.6),
    subsurfaceColor: g.constant(1, 1, 1),
  })
  g.closures(g.horizontalMix(plain, fuzzy, 0.5))
  const program = programOf({ graph: g }, undefined, 8)
  if (!isProgram(program)) throw new Error('the closure tree does not compile')
  const text = shadeHitProgram(program.compiled, true)
  assertProgramAssembles(text, PT_SHADE_ENTRY, 'the weighted hits shade of closures with lobes')
  assert.match(text, /hitSlabAlbedo\(mgRgb,mgMetal,mgRough,Nk,saturate\(/)
  assert.match(text, /var mgKFlags=0u;/)
  assert.match(text, /hitLobes=mgLobes;mgKFlags\|=64u;/)
  assert.match(text, /mgKFlags\|=specularFlag\(/)
  assert.match(text, /flag=\(flag&~65344u\)\|mgKFlags;/)
  assert.doesNotMatch(text, /closureOuts|storeClosures/)
})
