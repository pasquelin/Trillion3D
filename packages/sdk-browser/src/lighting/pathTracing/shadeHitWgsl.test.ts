// The shade of a hit, assembled: every name declared, the entry present, none of the resolve's bindings of pages and bins.
import test from 'node:test'
import assert from 'node:assert/strict'
import { assertProgramAssembles } from '../../gpu/core/wgslNames.fixture.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture as WorldTexture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { isProgram, programOf } from '../../materials/graph/surfaceProgram.ts'
import { PT_SHADE_ENTRY, shadeHitProgram } from './shadeHitWgsl.ts'

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
