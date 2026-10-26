// What a surface that wears a graph brings to its rows besides its colour (`surfaceRow.ts`): a cutout
// (`opacityMask`), the offset of its vertices (`worldPositionOffset`), and the words that carry them,
// each with the outputs the rasters cannot evaluate refused by name.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../pages/surface.ts'
import {
  FLAG_DEPTH_OFFSET,
  FLAG_HAS_COLOR,
  FLAG_MAP_UV_HIGH,
  FLAG_MAP_UV_LOW,
  FLAG_MAP_UV_TOP,
  FLAG_MASK,
  WPO_ROW_ALWAYS,
  WPO_ROW_MOVES,
  WPO_ROW_VELOCITY,
} from '../../visibility/types.ts'
import { objectOffsetRow, writeOffsetWords, type RootOffsetRow } from './page/offsetRow.ts'
import { PAGE_INFO } from '../../visibility/pageInfo.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'
import { emptySurfaceRow, rowFlags, surfaceRow } from './surfaceRow.ts'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture as WorldTexture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { graphRastersOf, NO_RASTERS } from '../../materials/graph/graphRasters.ts'
import { takeGraphRefusals } from '../../materials/graph/kept.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { maskUvWgsl } from '../../visibility/shader/pageUvSetWgsl.ts'

test('a graph that wires an opacityMask is a masked surface, cut at the one texture set the mask names; a mask the rasters cannot read is refused', () => {
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const masked = (wire: (g: ReturnType<typeof material.graph>) => void) => {
    const graph = material.graph('surface')
    graph.output('baseColor', graph.constant(1, 0, 0))
    wire(graph)
    return surfaceRow({ ...surfaceOf(G.standardSurface()), graph }, layers)
  }
  const bits = (row: { bits: number }) => [row.bits & FLAG_MASK, row.bits & FLAG_MAP_UV_LOW]
  const plain = surfaceRow({ ...surfaceOf(G.standardSurface()) }, layers)
  assert.deepEqual(bits(plain), [0, 0], 'a surface with no graph and no alpha test is not masked')
  assert.deepEqual(
    bits(masked((g) => g.output('opacityMask', g.componentMask(g.texCoord(0), 'r')))),
    [FLAG_MASK, 0],
  )
  // The set the mask reads is the one the rows carry to the cutout.
  assert.deepEqual(
    bits(masked((g) => g.output('opacityMask', g.componentMask(g.texCoord(1), 'r')))),
    [FLAG_MASK, FLAG_MAP_UV_LOW],
  )
  // A graph with no mask wired is drawn whole, whatever its material's alpha test says.
  assert.deepEqual(bits(masked((g) => g.output('emissive', g.constant(1, 0, 0)))), [0, 0])
  takeGraphRefusals()
  // A mask that reads the world, or two texture sets, has no value in a raster: refused, named, whole.
  for (const wire of [
    (g: ReturnType<typeof material.graph>) =>
      g.output('opacityMask', g.componentMask(g.worldPosition(), 'r')),
    (g: ReturnType<typeof material.graph>) =>
      g.output(
        'opacityMask',
        g.add(g.componentMask(g.texCoord(0), 'r'), g.componentMask(g.texCoord(1), 'r')),
      ),
  ])
    assert.deepEqual(bits(masked(wire)), [0, 0])
  const named = takeGraphRefusals()
  assert.equal(named.length, 2)
  assert.match(named[0]!, /world position/)
  assert.match(named[1]!, /more than one texture set/)
})

test('the texture set a cutout reads is one of the eight a page carries, in three flags', () => {
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const bitsOf = (set: number) => {
    const graph = material.graph('surface')
    graph.output('baseColor', graph.constant(1, 0, 0))
    graph.output('opacityMask', graph.componentMask(graph.texCoord(set), 'r'))
    return surfaceRow({ ...surfaceOf(G.standardSurface()), graph }, layers).bits
  }
  const flags = [FLAG_MAP_UV_LOW, FLAG_MAP_UV_HIGH, FLAG_MAP_UV_TOP]
  for (let set = 0; set < 8; set++)
    assert.deepEqual(
      flags.map((flag) => (bitsOf(set) & flag) !== 0),
      [0, 1, 2].map((bit) => ((set >> bit) & 1) === 1),
      `set ${set}`,
    )
})

test('a graph that reads the vertex colour has its rows carry the geometry’s colour, and no other graph does', () => {
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const row = (colour: boolean) => {
    const graph = material.graph('surface')
    graph.output('baseColor', colour ? graph.vertexColor() : graph.constant(1, 0, 0))
    return surfaceRow({ ...surfaceOf(G.standardSurface()), graph }, layers)
  }
  const carried = (colour: boolean, geometry: boolean) =>
    (rowFlags(row(colour), { hasColor: geometry } as never, undefined).flags & FLAG_HAS_COLOR) !== 0
  assert.deepEqual(
    [carried(true, true), carried(true, false), carried(false, true)],
    [true, false, false],
  )
})

test('a graph that wires a worldPositionOffset moves its rows’ vertices unless its kind says no; an offset a vertex stage cannot read is refused', () => {
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const swaying = (g: ReturnType<typeof material.graph>) =>
    g.output('worldPositionOffset', g.multiply(g.time(), g.constant(1, 0, 0)))
  const row = (
    wire: (g: ReturnType<typeof material.graph>) => void,
    over: Record<string, unknown> = {},
  ) => {
    const graph = material.graph('surface')
    graph.output('baseColor', graph.constant(1, 0, 0))
    wire(graph)
    return surfaceRow({ ...surfaceOf(G.standardSurface()), graph, ...over }, layers)
  }
  assert.equal(surfaceRow({ ...surfaceOf(G.standardSurface()) }, layers).wpo, 0, 'no graph')
  assert.equal(row((g) => g.output('emissive', g.constant(1, 0, 0))).wpo, 0, 'no offset wired')
  // The surface says it moves its vertices; whether the object evaluates it, and whether it is a
  // motion, are the object’s (`writeOffsetWords`).
  assert.equal(row(swaying).wpo, WPO_ROW_MOVES)
  assert.equal(
    row(swaying, { alwaysEvaluateWorldPositionOffset: true }).wpo,
    WPO_ROW_MOVES | WPO_ROW_ALWAYS,
    'a surface that always evaluates says so in its row',
  )
  assert.equal(row(swaying, { maxWorldPositionOffset: 2 }).wpoMost, 2)
  assert.equal(row(swaying, { maxWorldPositionOffset: -1 }).wpoMost, 0)
  // A sprite and a line are built on the screen.
  assert.equal(row(swaying, { sprite: { size: 1 } }).wpo, 0)
  assert.equal(row(swaying, { lineWidth: 2 }).wpo, 0)
  // The texture set the vertex reads is the one the rows carry to the cutout.
  const set = (index: number) => (g: ReturnType<typeof material.graph>) =>
    g.output('worldPositionOffset', g.appendVector(g.texCoord(index), g.constant(0)))
  assert.equal(row(set(1)).bits & FLAG_MAP_UV_LOW, FLAG_MAP_UV_LOW)
  assert.equal(row(set(0)).bits & FLAG_MAP_UV_LOW, 0)
  takeGraphRefusals()
  // Two sets, the pixel's normal, or a set unlike the cutout's: refused, named, unmoved. A texture is
  // read where the device lets a vertex stage bind it (`grantsVertexTextures`).
  const sampled = (g: ReturnType<typeof material.graph>) =>
    g.output(
      'worldPositionOffset',
      g.multiply(g.textureSample(new WorldTexture()), g.constant(1, 0, 0)),
    )
  const twoSets = (g: ReturnType<typeof material.graph>) =>
    g.output(
      'worldPositionOffset',
      g.appendVector(g.add(g.texCoord(0), g.texCoord(1)), g.constant(0)),
    )
  const pixelNormal = (g: ReturnType<typeof material.graph>) =>
    g.output('worldPositionOffset', g.pixelNormal())
  const unlike = (g: ReturnType<typeof material.graph>) => {
    g.output('opacityMask', g.componentMask(g.texCoord(0), 'r'))
    g.output('worldPositionOffset', g.appendVector(g.texCoord(1), g.constant(0)))
  }
  assert.equal(row(sampled).wpo, WPO_ROW_MOVES, 'a texture is read where the device grants it')
  assert.deepEqual(takeGraphRefusals(), [])
  for (const wire of [twoSets, unlike, pixelNormal]) assert.equal(row(wire).wpo, 0)
  const named = takeGraphRefusals()
  assert.match(named[0]!, /more than one texture set/)
  assert.match(named[1]!, /different texture sets/)
  assert.match(named[2]!, /pixelNormal used for the worldPositionOffset output/)
  // On a device whose vertex stages have no room to bind it, the offset that reads one is not held.
  const graph = material.graph('surface')
  sampled(graph)
  const without = graphRastersOf([{ graph }], { ...NO_RASTERS, textures: false })
  assert.deepEqual(without.offsets, [])
  assert.match(takeGraphRefusals()[0]!, /reads a texture.*ten storage buffers/)
  assert.equal(graphRastersOf([{ graph }]).offsets.length, 1, 'held where it is granted')
})

test('the words of a row’s offset are its surface’s bits with its object’s switches', () => {
  const ints = new Uint32Array(PAGE_INFO.words),
    floats = new Float32Array(ints.buffer)
  const at = PAGE_INFO.at
  const surface = (wpo: number, wpoMost = 0) => ({ ...emptySurfaceRow(), wpo, wpoMost })
  const object = (over: Partial<RootOffsetRow>): RootOffsetRow => ({
    ...objectOffsetRow(undefined, [0, 0, 0]),
    ...over,
  })
  const write = (row: ReturnType<typeof surface>, obj?: RootOffsetRow) => {
    writeOffsetWords(ints, floats, at, 0, row, obj)
    return {
      wpo: ints[at.wpo],
      stops: floats[at.wpoDisableSq],
      centre: [...floats.slice(at.wpoCentre, at.wpoCentre + 3)],
      most: floats[at.wpoMost],
    }
  }
  assert.equal(write(surface(0)).wpo, 0, 'a surface that moves nothing')
  assert.equal(write(surface(WPO_ROW_MOVES)).wpo, WPO_ROW_MOVES | WPO_ROW_VELOCITY, 'by default')
  assert.equal(
    write(surface(WPO_ROW_MOVES), object({ velocity: false })).wpo,
    WPO_ROW_MOVES,
    'not a motion',
  )
  assert.equal(write(surface(WPO_ROW_MOVES), object({ evaluate: false })).wpo, 0, 'off')
  assert.equal(
    write(surface(WPO_ROW_MOVES | WPO_ROW_ALWAYS), object({ evaluate: false })).wpo,
    WPO_ROW_MOVES | WPO_ROW_ALWAYS | WPO_ROW_VELOCITY,
    'off, unless the surface always evaluates',
  )
  assert.deepEqual(
    write(surface(WPO_ROW_MOVES, 1), object({ disable: 10, centre: [1, 2, 3], most: 4 })),
    { wpo: WPO_ROW_MOVES | WPO_ROW_VELOCITY, stops: 100, centre: [1, 2, 3], most: 4 },
    'the distance squared, the centre of the bounds, the greatest of the object’s surfaces',
  )
  assert.equal(write(surface(WPO_ROW_MOVES, 6), object({ most: 4 })).most, 6, 'its own, past it')
})

test('a graph that wires a pixelDepthOffset is a masked row that asks the rasters for the depth; one that reads the world is refused', () => {
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const row = (wire: (g: ReturnType<typeof material.graph>) => void) => {
    const graph = material.graph('surface')
    graph.output('baseColor', graph.constant(1, 0, 0))
    wire(graph)
    return surfaceRow({ ...surfaceOf(G.standardSurface()), graph }, layers).bits
  }
  const bits = row((g) => g.output('pixelDepthOffset', g.componentMask(g.texCoord(1), 'r')))
  assert.equal(bits & FLAG_MASK, FLAG_MASK)
  assert.equal(bits & FLAG_DEPTH_OFFSET, FLAG_DEPTH_OFFSET)
  assert.equal(bits & FLAG_MAP_UV_LOW, FLAG_MAP_UV_LOW, 'its coordinate is the set it reads')
  assert.equal(row((g) => g.output('emissive', g.constant(1, 0, 0))) & FLAG_DEPTH_OFFSET, 0)
  takeGraphRefusals()
  const world = row((g) => g.output('pixelDepthOffset', g.componentMask(g.worldPosition(), 'r')))
  assert.equal(world & (FLAG_MASK | FLAG_DEPTH_OFFSET), 0)
  assert.match(takeGraphRefusals()[0]!, /world position/)
})

test('a first-person row whose base map reads an odd texture set keeps both: the set from its row flags, the mark in its own page word', () => {
  const layers = { mapLayer: new Map<Texture, number>(), dataLayer: new Map<Texture, number>() }
  const masked = (set: number) => {
    const graph = material.graph('surface')
    graph.output('baseColor', graph.constant(1, 0, 0))
    graph.output('opacityMask', graph.componentMask(graph.texCoord(set), 'r'))
    return surfaceRow({ ...surfaceOf(G.standardSurface()), graph }, layers).bits
  }
  const { pageMaskSet } = shaderRun<{ pageMaskSet: (page: object) => number }>(
    maskUvWgsl(0),
    ['pageMaskSet'],
    {},
  )
  // The mark is a field of the page, so no row flag shares its bit with the texture set's low bit.
  assert.ok(PAGE_INFO.at.firstPerson > PAGE_INFO.at.wpoMost)
  assert.equal(PAGE_INFO.words, 40, 'the mark fills the record padding: the record does not grow')
  for (const set of [0, 1, 2, 3, 5]) {
    const flags = masked(set)
    for (const firstPerson of [0, 1])
      assert.equal(
        pageMaskSet({ flags, firstPerson }),
        set,
        `set ${set}, first person ${firstPerson}`,
      )
  }
})
