// The resolve classes of a material graph: values read from the material table, features in the
// class key, and a wired lobe in the lobe record.
import test from 'node:test'
import assert from 'node:assert/strict'
import { FEATURE_CLASS_KEYS } from './materialClass.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture as WorldTexture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { isProgram, programOf } from '../../materials/graph/surfaceProgram.ts'
import { graphClassKey } from '../../materials/graph/surfaceClasses.ts'
import { hasPhysicalLobes } from '../../materials/surface/physicalLobes.ts'
import { SHADE_SHADER, shadeShader } from './shadeWgsl.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { createWebgpuShadePipelines } from '../passes/shadePipelines.ts'
import { CLASS_FEATURE } from './classWords.ts'

const { HAS_UV, HAS_VERTEX_NORMAL } = CLASS_FEATURE

/** The program of a graph that reads a texture, for the surface resolve. */
function textured() {
  const graph = material.graph('surface')
  graph.output('baseColor', graph.channel(graph.textureSample(new WorldTexture()), 'rgb'))
  graph.output('normal', graph.constant(0, 0, 1))
  const program = programOf({ graph })
  if (!isProgram(program)) throw new Error('the graph of the test does not compile')
  return program
}

test('the resolve of a graph reads its values from the material table and asks the tiles of its textures', () => {
  const { compiled } = textured()
  const text = shadeShader({ graph: compiled })
  const fragment = text.slice(text.indexOf('fn shadeSurface'))
  assert.match(fragment, /mgGiven=mgLoad\(max\(m\.graph,1u\)-1u\);/, 'the values beside the record')
  assert.match(fragment, /rgb=saturate\(mgBaseColor\(mgPixel,mgGiven\)\);/)
  // Its two clocks are the uniform's own: the world's time, and the wall clock, which a pause leaves running.
  assert.match(fragment, /mgPixel\.time=uni\.time;mgPixel\.realTime=uni\.realTime;/)
  // The normal the graph wires bends the vertex normal as a map does, at the pixel alone: the roughness of a normal's change reads the vertex normal's.
  assert.match(fragment, /N=bendNormal\(N,mgT,mgB,mgFlip,mgMap\);/)
  // An output it does not wire is its default; one it wires is held to its range.
  assert.match(fragment, /metal=ormMetalness\(1\.0,saturate\(0\.00000000\)\);/)
  // The weights one pixel right and one down are declared once, for the footprints and the normal's change.
  assert.equal(text.match(/bx=perspectiveBarycentric\(/g)?.length, 1)
  assert.match(fragment, /if\(HAS_TANGENT&&\(true\)\)\{tangents=/)
  assert.doesNotMatch(fragment, /\|\|true/)
  // The pixel asks one of the graph's reads, never one of the maps': the tile request is its own.
  assert.match(text, /fn shadePick\(p:RequestPick,missing:bool,m:Material\)->u32\{return mgAsk\(/)
  assert.match(text, /let choices=1u;/)
  assert.doesNotMatch(text, /MAP_CHOICES\+1u\+select/)
  // The module of a surface with no graph holds none of it.
  assert.doesNotMatch(SHADE_SHADER, /mgPixel|mgLoad/)
  assert.match(SHADE_SHADER, /binOfClass\(CLASS_BIN\)/)
})

test('a class of a graph is compiled with its features, binned under its own key, over its program’s module', async () => {
  const program = textured()
  const first = graphClassKey(program, HAS_UV)!,
    second = graphClassKey(program, HAS_UV | HAS_VERTEX_NORMAL)!
  assert.ok(first >= FEATURE_CLASS_KEYS && second === first + 1)
  assert.equal(graphClassKey(program, HAS_UV), first, 'a class once made is kept')
  const { device, computePipelines } = fakeDevice()
  const plain = {} as GPUShaderModule
  const made = await createWebgpuShadePipelines(device, plain, [0, first, second])
  assert.equal(made.shadeClasses.of(first).ready, true)
  const [none, one, two] = computePipelines
  assert.deepEqual(none!.compute.constants, { CLASS_KEY: 0, FEEDBACK: 1 })
  assert.deepEqual(one!.compute.constants, { CLASS_KEY: HAS_UV, CLASS_BIN: first, FEEDBACK: 1 })
  assert.equal(two!.compute.constants!.CLASS_KEY, HAS_UV | HAS_VERTEX_NORMAL)
  assert.equal(none!.compute.module, plain, 'a class of the features keeps the shared module')
  const code = (one!.compute.module as unknown as { code: string }).code
  assert.equal(code, shadeShader({ graph: program.compiled }))
  assert.equal(one!.compute.module, two!.compute.module, 'the classes of one program share it')
})

test('a graph that wires a lobe sets it in the lobe record in place of the material’s, and the record stores it', () => {
  const lobed = material.graph('surface')
  lobed.output('anisotropy', lobed.constant(-0.5))
  lobed.output('tangent', lobed.constant(0, 1, 0))
  lobed.output('clearCoat', lobed.constant(0.75))
  const program = programOf({ graph: lobed })
  assert.ok(isProgram(program))
  const text = shadeShader({ graph: program.compiled })
  // The strength is the anisotropy's magnitude, its sign the axis, the coat the graph's; the record's own call stores them.
  assert.match(text, /let mgA=clamp\(mgAnisotropy\(mgPixel,mgGiven\),-1\.0,1\.0\);/)
  assert.match(
    text,
    /physicalRecord\.lobes=vec4f\(abs\(mgA\),0\.0,saturate\(mgClearCoat\(mgPixel,mgGiven\)\),/,
  )
  assert.match(
    text,
    /physicalRecord\.law=select\(1u,2u,mgA<0\.0\);\s*physicalTangent=mgTangent\(mgPixel,mgGiven\);/,
  )
  assert.ok(text.indexOf('physicalRecord.lobes=') < text.indexOf('flag|=physicalLobes('))
  // A surface that wires no lobe sets none; one that wires none has no lobe at all.
  const none = shadeShader({ graph: textured().compiled })
  assert.doesNotMatch(none, /physicalRecord\.law=/)
  assert.match(none, /flag\|=physicalLobes\(/)
  const base = { lit: true, anisotropy: 1, clearcoat: 1 }
  assert.equal(hasPhysicalLobes(base), true)
  assert.equal(
    hasPhysicalLobes({ ...base, graph: textured().graph }),
    false,
    'its factors are not read',
  )
  assert.equal(hasPhysicalLobes({ ...base, graph: lobed }), true)
})
