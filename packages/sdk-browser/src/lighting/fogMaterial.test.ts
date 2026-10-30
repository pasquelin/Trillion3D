import test from 'node:test'
import assert from 'node:assert/strict'
import * as G from '../scene/host/graph/graph.fixture.ts'
import { surfaceOf } from '../geometry/pages/surface.ts'
import { rowFlags, surfaceRow } from '../geometry/rows/surfaceRow.ts'
import { writeMaterialRecord } from '../materials/table/materialRecord.ts'
import { MATERIAL_RECORD, MATERIAL_RECORD_WORDS } from '../materials/table/materialLayout.ts'
import { CLOUD_FOG_MODEL_BIT, FOG_FREE_MODEL_BIT } from '../materials/surface/surfaceModelWord.ts'
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts'
import { BLEND_SHADER, DIRECT_LIGHTING_SHADER } from '../gpu/core/shaderTexts.fixture.ts'
import { surfaceWritten } from '../geometry/pages/surfaceWrites.ts'
import { FOG_PROGRAMS, fogGraphProgram } from './fog/programs.ts'
import { FOG_VOLUME_FLAG } from './fog/frame.ts'
import { CAM, frameScope, image } from './fogVolumeRun.fixture.ts'
import { createGraphValues, voxelGraphSet } from './fog/voxelGraph.ts'
import { createFogVolumeResources } from './fog/resources.ts'
import { takeGraphRefusals } from '../materials/graph/kept.ts'
import { graphSlotOf, writeGraphSlot, type GraphSlot } from './lightFunction/graphSlot.ts'
import { fakeDevice } from '../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { FOG_VOXEL_FRAME, FOG_VOXEL_OBJECT, writeVoxelObjects } from './fog/voxelLayout.ts'
import { createVoxelBuffers } from './fog/voxelGpu.ts'
import { installGpuGlobals } from '../../../../tests/kit/fakeDevice/globals.ts'
import { material } from '../../../sdk-core/src/world/material/index.ts'
import { Texture as WorldTexture } from '../../../sdk-core/src/world/texture/texture.ts'
import type { MaterialGraph } from '../../../sdk-core/src/world/material/graph/api.ts'
import {
  resolveFogVolume,
  type ResolvedFogVolume,
} from '../../../sdk-core/src/scene/volume/contracts.ts'
import { createSceneFogVolumeStore } from '../../../sdk-core/src/scene/volume/store.ts'
import { assertProgramAssembles } from '../gpu/core/wgslNames.fixture.ts'

test('a fog-free material reaches both the opaque flag and transparent shader', () => {
  const material = G.familySurface('standard', { fog: false })
  const surface = surfaceOf(material)
  assert.equal(surface.fog, false)
  const layers = { mapLayer: new Map(), dataLayer: new Map() }
  const row = rowFlags(surfaceRow(surface, layers), undefined, undefined)
  assert.equal(row.flags & (1 << 20), 1 << 20)
  assert.match(SHADE_SHADER, /page.flags&1048576u/)
  assert.match(DIRECT_LIGHTING_SHADER, /surfaceFlag&128u/)

  // The transparent pass reads it off the surface's record, above its model.
  const record = new Uint32Array(MATERIAL_RECORD_WORDS)
  writeMaterialRecord(record, 0, surface, layers, 0)
  assert.equal(record[MATERIAL_RECORD.at.model] & FOG_FREE_MODEL_BIT, FOG_FREE_MODEL_BIT)
  assert.match(BLEND_SHADER, /flags&1048576u/)
  material.fog = true
  surfaceWritten(material)
  assert.equal(surfaceOf(material).fog, true, 'a declared material change is heard')
  assert.equal(rowFlags(surfaceRow(surface, layers), undefined, undefined).flags & (1 << 20), 0)
})

test('a material that receives the clouds in its fog says so in its record, only with its fog', () => {
  const layers = { mapLayer: new Map(), dataLayer: new Map() }
  const modelOf = (options: G.SurfaceParameters) => {
    const record = new Uint32Array(MATERIAL_RECORD_WORDS)
    const surface = surfaceOf(G.familySurface('standard', options))
    writeMaterialRecord(record, 0, surface, layers, 0)
    return record[MATERIAL_RECORD.at.model] & CLOUD_FOG_MODEL_BIT
  }
  assert.equal(modelOf({}), 0, 'off by default')
  assert.equal(modelOf({ cloudFog: true }), CLOUD_FOG_MODEL_BIT)
  assert.equal(modelOf({ cloudFog: true, fog: false }), 0, 'the fog is where the clouds are laid')
})

/** A volume object of the unit box wearing `graph`. */
const worn = (id: string, graph?: MaterialGraph): ResolvedFogVolume =>
  resolveFogVolume({ id, material: { extinction: 0.5 }, graph })

/** A volume graph: a coloured, textured density with a parameter and the time in its light. */
function densityGraph(textured: boolean) {
  const g = material.graph('volume')
  const albedo = g.vectorParameter('albedo', [0.5, 0.25, 1, 1])
  const noise = textured
    ? g.textureSample(new WorldTexture(), { uv: g.componentMask(g.worldPosition(), 'rg') })
    : albedo
  g.output('baseColor', g.channel(albedo, 'rgb'))
  g.output('subsurfaceColor', g.multiply(g.channel(noise, 'r'), g.constant(2, 2, 2)))
  g.output('emissive', g.multiply(g.constant(1, 0.5, 0), g.sine(g.time(), 2)))
  return g
}

test('the voxelisation of an object that wears a graph evaluates it at each cell, in place of its material', () => {
  assert.equal(voxelGraphSet([worn('plain')]), undefined, 'no graph, no program')
  const set = voxelGraphSet([
    worn('a', densityGraph(true)),
    worn('b', densityGraph(true)),
    worn('c'),
  ])
  assert.equal(set?.programs.length, 1, 'two graphs that compile alike are one program')
  assert.equal(set?.textured, true)
  const code = FOG_PROGRAMS.voxelize
  assert.doesNotMatch(code, /fogGraphAt/, 'the plain program holds none of it')
  const text = fogGraphProgram(set!)
  // The albedo held to [0, 1], the extinction the red channel to what a half float holds.
  assert.match(text, /out\.albedo=saturate\(mgBaseColor_\w+\(ctx,g\)\);/)
  assert.match(
    text,
    /out\.extinction=clamp\(\(mgSubsurfaceColor_\w+\(ctx,g\)\)\.x,0\.0,65000\.0\);/,
  )
  // A cell the mask or the fade leaves nothing of never evaluates the graph.
  assert.match(
    text,
    /if\(object\.graph\.x!=0u\)\{\s*if\(scale==0\.0\)\{continue;\}\s*let made=fogGraphAt\(object,position,right,below\);/,
  )
  // The footprint of a texture read is found at the cells beside.
  assert.match(text, /mgNeighbour\[0\]\.world=right\+frame\.eye\.xyz/)
  // A graph's context takes its two clocks from the frame: the world's time, the wall clock.
  assert.match(text, /ctx\.time=voxelFrame\.passes\.w;ctx\.realTime=voxelFrame\.realTime;/)
  assertProgramAssembles(text)
})

test('the objects of a volume write their graph word, and their values one block after the other', () => {
  const plain = worn('plain'),
    a = worn('a', densityGraph(false)),
    b = worn('b', densityGraph(false))
  const set = voxelGraphSet([plain, a, b])!
  const out = new Float32Array(3 * FOG_VOXEL_OBJECT.words)
  const values = createGraphValues()
  const count = writeVoxelObjects(out, 3, [plain, a, b], [0, 0, 0], 100, (object) =>
    values.add(object, set, () => undefined),
  )
  assert.equal(count, 3)
  const words = new Uint32Array(out.buffer)
  const at = (slot: number) => slot * FOG_VOXEL_OBJECT.words + FOG_VOXEL_OBJECT.at.graph
  assert.deepEqual([...words.slice(at(0), at(0) + 2)], [0, 0], 'no graph, no program')
  // A program's place from 1, the first texel of its values: a block is the texel of its vector of
  // parameters and the one of its texture words.
  assert.deepEqual([...words.slice(at(1), at(1) + 2)], [1, 0])
  assert.deepEqual([...words.slice(at(2), at(2) + 2)], [1, 2])
  assert.deepEqual([...new Float32Array(values.words.buffer, 0, 3)], [0.5, 0.25, 1])
  a.graph!.set('albedo', [0.1, 0.2, 0.3])
  values.reset()
  values.add(a, set, () => undefined)
  assert.deepEqual(
    [...new Float32Array(values.words.buffer, 0, 3)].map((x) => +x.toFixed(2)),
    [0.1, 0.2, 0.3],
  )
})

test('an object of the store changes with its graph: a write to the graph is a new record', () => {
  const store = createSceneFogVolumeStore()
  const graph = densityGraph(false)
  store.add({ id: 'smoke', graph })
  const before = store.revision
  store.set('smoke', { graph })
  assert.equal(store.revision, before, 'the same graph at the same version changes nothing')
  graph.set('albedo', [1, 1, 1])
  store.set('smoke', { graph })
  assert.equal(store.revision, before + 1, 'a value written to it does')
  assert.throws(
    () => store.add({ id: 'wrong', graph: material.graph('surface') }),
    /graph expects a graph of the volume domain/,
  )
})

/** A graph that wires an output the way the compile refuses: a width no output takes. */
function brokenGraph(domain: 'volume' | 'lightFunction') {
  const g = material.graph(domain)
  g.output(
    domain === 'volume' ? 'baseColor' : 'emissive',
    g.add(g.constant(1, 2), g.constant(1, 2, 3)),
  )
  return g
}

test('a graph the voxelisation cannot compile is named once with the others, the light function’s by its own frame', () => {
  takeGraphRefusals()
  const volume = brokenGraph('volume')
  const objects = [{ graph: volume }] as unknown as ResolvedFogVolume[]
  assert.equal(voxelGraphSet(objects), undefined, 'its object adds what its material gives')
  assert.equal(voxelGraphSet(objects), undefined)
  assert.equal(takeGraphRefusals().length, 1, 'once, not at each image')
  const slot = graphSlotOf(material.lightFunction({ graph: brokenGraph('lightFunction') }))
  assert.match((slot as { error: string }).error, /float2 and float3/)
  assert.deepEqual(takeGraphRefusals(), [], 'the light function names its own')
})

test('a light function’s slot carries the image’s two clocks, the ones the other passes read', () => {
  const graph = material.graph('lightFunction')
  graph.output('emissive', graph.sine(graph.time(), 2))
  const lamp = material.lightFunction({ graph })
  const slot = graphSlotOf(lamp) as GraphSlot
  assert.equal(slot.animated, true, 'it reads the time: its slot is drawn at each image')
  const out = new ArrayBuffer(slot.bytes)
  assert.equal(
    writeGraphSlot(slot, lamp, out, { time: 7.5, realTime: 19.25 }, () => 0),
    true,
  )
  assert.deepEqual(
    [...new Float32Array(out, 0, 2)],
    [7.5, 19.25],
    'the world’s time, the wall clock',
  )
})

test('the voxelisation of the set of graphs an image holds is kept, with the set before it: two sets alternating compile once each', () => {
  const { device } = fakeDevice()
  const resources = createFogVolumeResources(device, () => {})
  const setOf = (n: number) => {
    const g = material.graph('volume')
    g.output('baseColor', g.constant(n, 0, 0))
    return voxelGraphSet([worn(`g${n}`, g)])!
  }
  const [a, b, c] = [setOf(1), setOf(2), setOf(3)]
  const first = resources.graphVoxelize(a)
  assert.equal(resources.graphVoxelize(a), first, 'the same set, the same program')
  const second = resources.graphVoxelize(b)
  assert.notEqual(second, first)
  // A camera walking across the edge of a fog object flips between two sets: neither compiles again.
  for (let flip = 0; flip < 3; flip++) {
    assert.equal(resources.graphVoxelize(a), first)
    assert.equal(resources.graphVoxelize(b), second)
  }
  // A third set lets go of the older of the two.
  resources.graphVoxelize(c)
  assert.equal(resources.graphVoxelize(b), second, 'the set before the third is kept')
  assert.notEqual(resources.graphVoxelize(a), first, 'the older one let go')
  resources.dispose()
})

test('the voxelisation reads the image’s clocks, the world’s time and the wall clock’s, the ones the other passes read', () => {
  installGpuGlobals()
  const { device, writes } = fakeDevice()
  const store = createSceneFogVolumeStore()
  store.add({ id: 'smoke' })
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const camera = { depthViewProj: identity, world: identity, eye: [0, 0, 0] }
  const settings = {
    volumetricFogVoxelizationSlicesPerPass: 8,
    volumetricFogVoxelizationShowOnlyPass: -1,
  }
  const buffers = createVoxelBuffers(device)
  assert.equal(
    buffers.write(store, camera, settings as never, { farEnd: 1000 } as never, undefined, {
      ...{ time: 7.5, realTime: 19.25 },
    }),
    1,
  )
  const frame = writes.find(
    (write) => (write.buffer as { label?: string }).label === 'Trillion3D fog voxel frame',
  )!
  const words = new Float32Array(
    frame.data.buffer as ArrayBuffer,
    frame.data.byteOffset,
    FOG_VOXEL_FRAME.words,
  )
  assert.equal(words[FOG_VOXEL_FRAME.at.passes + 3], 7.5, 'the world’s time, the passes’ last')
  assert.equal(words[FOG_VOXEL_FRAME.at.realTime], 19.25, 'the wall clock beside it')
})

test('the lighting view voxelises every object with its diffuse colour, the frame telling it by a flag', () => {
  const flags = (lightingOnly: boolean) =>
    frameScope(image(CAM, true, {}, { lightingOnly })).medium[3]!
  assert.equal(flags(false) & FOG_VOLUME_FLAG.lightingOnly, 0)
  assert.equal(flags(true) & FOG_VOLUME_FLAG.lightingOnly, FOG_VOLUME_FLAG.lightingOnly)
  const code = FOG_PROGRAMS.voxelize
  assert.match(
    code,
    /fn voxelAlbedo\(albedo:vec3f\)->vec3f\{\s*return select\(albedo,vec3f\(0\.3\),/,
  )
  assert.match(code, /voxelAlbedo\(object\.albedo\.rgb\)\*object\.albedo\.w/)
})
