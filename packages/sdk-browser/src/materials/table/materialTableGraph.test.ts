// A surface that wears a material graph: its values written beside its record, its block given back (`materialTable.test.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaterialTable } from './materialTable.ts'
import { F, layers, lit, sentWords } from './materialTable.fixture.ts'
import { MATERIAL_RECORD_TEXELS, MATERIAL_RECORD_WORDS } from './materialLayout.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture as WorldTexture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { isProgram, programOf } from '../graph/surfaceProgram.ts'

test('a surface that wears a graph has its values written beside its record, in places it owns', () => {
  const tex = new WorldTexture()
  const graph = material.graph('surface')
  const tint = graph.channel(graph.vectorParameter('tint', [0.25, 0.5, 1, 1]), 'rgb')
  graph.output('baseColor', graph.multiply(graph.channel(graph.textureSample(tex), 'rgb'), tint))
  const sent = (slot: number | undefined, written?: () => void) => {
    const { device, textureWrites } = fakeDevice()
    const table = createMaterialTable()
    const l = layers()
    if (slot) l.mapLayer.set(tex as unknown as Texture, slot)
    const surface = { ...lit(), graph }
    const record = table.surface(surface, l).rank
    written?.()
    table.viewFor(device)
    const words = sentWords(textureWrites)
    const first = words[record * MATERIAL_RECORD_WORDS + F.graph] - 1
    const texel = (k: number) => words.slice((first + k) * 4, (first + k) * 4 + 4)
    return { record, first, texel, floats: new Float32Array(words.buffer) }
  }
  const held = sent(undefined)
  assert.equal(held.record, 0)
  // The block takes the place after the record, eleven texels to a place: its header is texel 10.
  assert.equal(held.first, MATERIAL_RECORD_TEXELS)
  assert.ok(held.texel(0)[0] > 0, 'the header names its graph’s program')
  const tintAt = (held.first + 1) * 4
  assert.deepEqual([...held.floats.slice(tintAt, tintAt + 3)], [0.25, 0.5, 1])
  assert.equal(held.texel(2)[0], 0, 'a texture the atlas lacks reads the fill texel')
  assert.equal(sent(7).texel(2)[0], 7, 'the slot of its texture in the colour atlas')
})

test('a surface that loses its graph gives its block back, which the next graph takes', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const graph = material.graph('surface')
  graph.output('baseColor', graph.vectorParameter('tint', [1, 1, 1, 1]) as never)
  const surface = { ...lit(), graph, version: 1 } as ReturnType<typeof lit> & {
    graph?: typeof graph
  }
  table.surface(surface, l)
  table.viewFor(device)
  const worn = sentWords(textureWrites)[0 * MATERIAL_RECORD_WORDS + F.graph]
  assert.ok(worn > 0)
  surface.graph = undefined
  surface.version = 2
  table.surface(surface, l)
  const other = { ...lit(), graph, version: 1 }
  const next = table.surface(other, l)
  table.viewFor(device)
  const words = sentWords(textureWrites)
  assert.equal(words[next.rank * MATERIAL_RECORD_WORDS + F.graph], worn, 'the freed block again')
})

test('a surface whose graph wires an offset writes its values and a header, with no clock and no limit', () => {
  const { device, textureWrites } = fakeDevice()
  const table = createMaterialTable()
  const l = layers()
  const graph = material.graph('surface')
  graph.output('worldPositionOffset', graph.multiply(graph.time(), graph.constant(1, 0, 0)))
  const worn = {
    ...lit(),
    graph,
    version: 1,
    maxWorldPositionOffset: 2,
  }
  const entry = table.surface(worn, l)
  table.viewFor(device)
  const words = sentWords(textureWrites)
  const first = words[entry.rank * MATERIAL_RECORD_WORDS + F.graph]! - 1
  const texel = (at: number) => [...words.slice((first + at) * 4, (first + at) * 4 + 4)]
  // Its header names the program, and says no more of an offset: the row carries the limits.
  assert.deepEqual(texel(0).slice(1), [0, 0, 0])
  // The record holds no trailer: the texels past its values stay empty (the limit was 2).
  const program = programOf(worn)
  assert.ok(isProgram(program))
  const past = 1 + (program.compiled.slots.bytes >> 4)
  assert.deepEqual(
    [texel(past), texel(past + 1)],
    [
      [0, 0, 0, 0],
      [0, 0, 0, 0],
    ],
  )
  // The image’s clocks and camera are the graph frame’s, written once an image, never a table’s.
  assert.equal(typeof (table as { tick?: unknown }).tick, 'undefined')
})
