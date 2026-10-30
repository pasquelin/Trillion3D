// The traced reflections of the closures past the first: the target holds two layers a closure, each such closure has its own flags, grids and resolved
// pixels, the lit passes of several closures read the layers of the closure they light, and a view of one closure keeps every text and size.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { reservedNames, unbalanced, unresolvedNames } from '../../gpu/core/wgslNames.fixture.ts'
import { litPassShaders } from '../../gpu/core/shaderTexts.fixture.ts'
import { createScreenReflection, reflectionBytes } from './gpu.ts'
import { closureSideBytes } from './closureSides.ts'
import { CLOSURE_FLAGS_ENTRY, closureFlagsWgsl, encodeClosureFlags } from './closureFlags.ts'
import {
  NO_LOCAL_LIGHT_WGSL,
  REFLECTION_TARGET,
  REFLECTION_TARGET_LAYERS,
  reflectionResolveWgsl,
  resolvedReflectionWgsl,
} from './weight.ts'
import { traceGroups, type TraceInputs } from './trace/traceGroups.ts'
import { REFLECTION_TRACE_BINDINGS as B, traceLayouts } from './trace/traceBindings.ts'
import {
  CLOSURE_CLASSIFY_ENTRY,
  CLOSURE_LIST_ENTRY,
  CLOSURE_MARK_ENTRY,
  closureClassifyWgsl,
  listGroups,
} from './trace/closureClassify.ts'
import { reflectionTraceShader } from './trace/trace.ts'
import { CLASSIFY_TILE_STATEMENTS, REFLECTION_CLASSIFY_WGSL } from './tiles.ts'
import { CLOSURE_TILE_SIZE } from '../../visibility/closureTiles/closureTilesWgsl.ts'

installGpuGlobals()

test('a view of one closure holds the reflection it always did: two layers, no side, the same bytes', () => {
  const { device, textures } = fakeDevice()
  const reflection = createScreenReflection(device, 16, 8, false)
  assert.equal(reflection.closureSides.sides.length, 0)
  assert.equal(reflection.target.depthOrArrayLayers, REFLECTION_TARGET_LAYERS)
  assert.equal(
    textures.filter((texture) => /closure/.test(texture.label ?? '')).length,
    0,
    'no texture of a closure past the first',
  )
  assert.equal(reflectionBytes(16, 8, false, false, 1), reflectionBytes(16, 8, false))
  assert.equal(reflection.follow(1), 0)
})

test('a view of several closures holds two layers of the target a closure and the flags, grids and resolved pixels of each closure past the first', () => {
  const { device, textures } = fakeDevice()
  const reflection = createScreenReflection(device, 16, 8, false, false, 3)
  assert.equal(reflection.target.depthOrArrayLayers, 3 * REFLECTION_TARGET_LAYERS)
  const { sides } = reflection.closureSides
  assert.deepEqual(
    sides.map((side) => side.closure),
    [1, 2],
  )
  for (const side of sides) {
    assert.ok(side.flagsView && side.resolvedView && side.targetView)
    assert.equal(side.flags.format, 'r32uint')
    assert.equal(
      side.lobes.format,
      'rgba32uint',
      'the closure’s own lobes texel, not the first closure’s',
    )
  }
  const grids = textures.length
  assert.ok(sides[0]!.grids !== sides[1]!.grids, 'a grid of its own each, made when first read')
  assert.ok(textures.length > grids)
  assert.equal(
    reflectionBytes(16, 8, false, false, 3) - reflectionBytes(16, 8, false, false, 1),
    2 * (REFLECTION_TARGET.bytes(16, 8, true) + closureSideBytes(16, 8)),
    'the budget counts the layers and the sides',
  )
})

test('the reflection follows the closures the record holds: the target and the sides are made again, the old retired, and the bytes it holds more are told', () => {
  const { device } = fakeDevice()
  const reflection = createScreenReflection(device, 16, 8, false)
  const before = reflection.target
  const more = reflection.follow(2)
  assert.equal(more, reflectionBytes(16, 8, false, false, 2) - reflectionBytes(16, 8, false))
  assert.ok(more > 0)
  assert.notEqual(reflection.target, before)
  assert.equal(reflection.target.depthOrArrayLayers, 2 * REFLECTION_TARGET_LAYERS)
  assert.equal(reflection.closureSides.sides.length, 1)
  assert.equal(reflection.follow(2), 0, 'unchanged')
  assert.equal(reflection.follow(1), -more)
  assert.equal(reflection.closureSides.sides.length, 0)
})

test('the flags kernel runs over the overflow tiles of a closure and keeps the flags of the pixels that hold it', () => {
  const code = closureFlagsWgsl()
  assert.deepEqual(unresolvedNames(code), [])
  assert.deepEqual(reservedNames(code), [])
  assert.equal(unbalanced(code), '')
  assert.match(code, new RegExp(`fn ${CLOSURE_FLAGS_ENTRY}\\(`))
  assert.match(code, new RegExp(`@workgroup_size\\(${CLOSURE_TILE_SIZE},${CLOSURE_TILE_SIZE},1\\)`))
  assert.match(code, /let tile=overflowTileAt\(group\);\n if\(tile\.z==0u\)\{return;\}/)
  // The pixel's flags where its normal is not zero, none elsewhere: the texture is written whole over the tiles.
  assert.match(code, /textureLoad\(closureNormals,vec2i\(pixel\),0\)\.xyz!=vec3f\(0\.0\)/)
  assert.match(code, /textureStore\(closureFlags,vec2i\(pixel\),vec4u\(flags,0u,0u,0u\)\)/)
  // The flags and lobes texel are the closure's own, read from the layers after the coverages by the closure's index in its entry.
  assert.match(
    code,
    /let closure=\(overflowList\[2u\+group\.y\*overflowList\[1\]\+group\.x\]>>24u\)&15u;/,
  )
  assert.match(
    code,
    /let at=closureFlagsLayerOf\(closuresHeldOf\(textureNumLayers\(words\)\),closure\);/,
  )
  assert.match(code, /textureStore\(closureLobes,vec2i\(pixel\),lobes\)/)
})

test('the flags of a closure are not written while the kernel is compiling or the view lists no tiles of it', () => {
  const { device } = fakeDevice()
  const encoder = device.createCommandEncoder()
  const reflection = createScreenReflection(device, 16, 8, false, false, 2)
  const side = reflection.closureSides.sides[0]!
  const surfaces = { words: {}, closureNormals: [{}], closures: 2 } as never
  assert.equal(
    encodeClosureFlags(
      device,
      encoder,
      surfaces,
      undefined,
      1,
      side.flags,
      side.flagsView,
      side.lobesView,
    ),
    false,
  )
})

test('the lit passes of several closures read the layers of the closure they light, those of one closure the first two', () => {
  const one = resolvedReflectionWgsl.text
  assert.doesNotMatch(one, /reflectionClosure/)
  assert.match(one, /textureLoad\(reflectionTarget,coord,0\);/)
  assert.match(one, /textureLoad\(reflectionTarget,coord,1\)\.a;/)
  const layered = reflectionResolveWgsl(NO_LOCAL_LIGHT_WGSL, false, true).resolvedReflectionWgsl
  assert.notEqual(layered.name, resolvedReflectionWgsl.name)
  assert.match(layered.text, /var<private> reflectionClosure:u32;/)
  assert.match(layered.text, /textureLoad\(reflectionTarget,coord,i32\(2u\*reflectionClosure\)\)/)
  assert.match(
    layered.text,
    /textureLoad\(reflectionTarget,coord,i32\(2u\*reflectionClosure\+1u\)\)\.a/,
  )
  // The texel run on the target: closure 2 reads layers 4 and 5.
  const read = (closure: number) =>
    shaderRun<{
      resolvedReflectionTexel: (coord: number[]) => number[]
      resolvedCoatLeft: (coord: number[]) => number
    }>(layered, ['resolvedReflectionTexel', 'resolvedCoatLeft'], {
      surfaceModel: 2,
      hasCoat: () => true,
      reflectionClosure: closure,
      reflectionTarget: { load: (_: number[], layer: number) => [layer, 0, 0, layer + 0.5] },
    })
  assert.deepEqual(read(0).resolvedReflectionTexel([0, 0]), [0, 0, 0, 0.5])
  assert.deepEqual(read(2).resolvedReflectionTexel([0, 0]), [4, 0, 0, 4.5])
  assert.equal(read(2).resolvedCoatLeft([0, 0]), 5.5)
})

test('every indirect pass of several closures sets the closure its reflection reads; the passes of one closure keep their text', () => {
  for (const bounce of [false, true]) {
    const several = litPassShaders(bounce, { lobeless: true, closures: true }).indirect
    assert.match(several, /reflectionClosure=closure;/)
    assert.match(several, /var<private> reflectionClosure:u32;/)
    const one = litPassShaders(bounce, { lobeless: true, closures: false }).indirect
    assert.doesNotMatch(one, /reflectionClosure/)
    assert.deepEqual(one, litPassShaders(bounce, { lobeless: true }).indirect)
  }
})

/** A device that hands back the descriptor of what it is asked to make, the trace's groups read as they are named. */
const descriptors = {
  features: new Set<string>(),
  createBindGroupLayout: (descriptor: object) => descriptor,
  createBindGroup: (descriptor: object) => descriptor,
} as unknown as GPUDevice
const entryOf = (group: GPUBindGroup, binding: number) =>
  Array.from((group as unknown as GPUBindGroupDescriptor).entries).find(
    (entry) => entry.binding === binding,
  )?.resource

test('the groups of a closure past the first bind its flags, its normals and roughness, its grids, its resolved pixels and its layers of the target; the kernels are the first closure’s', () => {
  const { device } = fakeDevice()
  const reflection = createScreenReflection(device, 16, 8, false, false, 3)
  const layouts = traceLayouts(descriptors, false, 'r32uint')
  const view = (name: string) => ({ name }) as unknown as GPUTextureView
  const deep: object = new Proxy(() => undefined, { get: () => deep, apply: () => deep })
  const inputs = {
    flags: view('flags'),
    normals: view('normals'),
    lobes: view('lobes'),
    closureNormals: [view('normals 1'), view('normals 2')],
    lights: {},
    fog: { cubemap: {}, sampler: {} },
    field: deep,
    hit: deep,
    vectors: view('vectors'),
    blue: view('blue'),
  } as unknown as TraceInputs
  const groups = traceGroups(
    { ...reflection, device: descriptors, closureSides: reflection.closureSides },
    {},
    layouts,
    inputs,
  )
  assert.equal(groups.closures.length, 2)
  const [first, second] = groups.closures
  const { sides } = reflection.closureSides
  for (const [at, own] of [first!, second!].entries()) {
    const side = sides[at]!
    assert.equal(entryOf(own.classify[0]!, B.flags), side.flagsView)
    assert.equal(entryOf(own.classify[0]!, B.normals), inputs.closureNormals![at])
    assert.equal(
      entryOf(own.classify[0]!, B.lobes),
      side.lobesView,
      'the lobes are the closure’s own, written with its flags',
    )
    assert.notEqual(side.lobesView, inputs.lobes)
    assert.equal(
      (entryOf(own.classify[0]!, B.tracingOut) as GPUBufferBinding).buffer,
      side.grids.tracing,
      'its own tile lists',
    )
    assert.equal(entryOf(own.clear[0]!, B.target), side.targetView, 'its two layers of the target')
    assert.equal(entryOf(own.clear[0]!, B.resolvedOut), side.resolvedView)
    assert.equal(entryOf(own.resolve[0]!, B.resolvedOut), side.resolvedView)
    assert.equal(entryOf(own.generate[0]!, B.rays), side.grids.rays, 'its own rays')
    assert.equal(entryOf(own.bilateral[0]!, B.target), side.targetView)
  }
  assert.notEqual(entryOf(first!.clear[0]!, B.target), entryOf(second!.clear[0]!, B.target))
  assert.equal(entryOf(groups.opaque.clear[0]!, B.target), reflection.targetView)
  assert.equal(entryOf(groups.opaque.classify[0]!, B.normals), inputs.normals)
  // A closure whose normals the frame does not bind is not traced.
  inputs.closureNormals = [inputs.closureNormals![0]!]
  const again = traceGroups(
    { ...reflection, device: descriptors, closureSides: reflection.closureSides },
    {},
    layouts,
    inputs,
  )
  assert.equal(again.closures[1], undefined)
})

test('the front surface resolves into pixels of its own once it reflects, so the opaque surface’s accumulation reads its own', () => {
  const { device } = fakeDevice()
  const reflection = createScreenReflection(device, 16, 8, false)
  const layouts = traceLayouts(descriptors, false, 'r32uint')
  const view = (name: string) => ({ name }) as unknown as GPUTextureView
  const deep: object = new Proxy(() => undefined, { get: () => deep, apply: () => deep })
  const inputs = {
    flags: view('flags'),
    normals: view('normals'),
    lobes: view('lobes'),
    lights: {},
    fog: { cubemap: {}, sampler: {} },
    field: deep,
    hit: deep,
    vectors: view('vectors'),
    blue: view('blue'),
  } as unknown as TraceInputs
  const resources = () => ({ ...reflection, device: descriptors })
  // Before it reflects: the opaque surface's pixels are bound for it (it traces nothing).
  assert.equal(reflection.front.views.resolved, undefined)
  const before = traceGroups(resources(), {}, layouts, inputs)
  assert.equal(entryOf(before.front.resolve[0]!, B.resolvedOut), reflection.resolvedView)
  // Once its pass wrote the surface it resolves into its own, and the opaque surface keeps its.
  const bytes = { targetBytes: 0 }
  reflection.front.begin(1, view('front'), 1, bytes)
  assert.ok(reflection.front.views.resolved)
  assert.ok(bytes.targetBytes >= 16 * 8 * 8, 'its resolved pixels are counted')
  const after = traceGroups(resources(), {}, layouts, inputs)
  assert.equal(entryOf(after.front.resolve[0]!, B.resolvedOut), reflection.front.views.resolved)
  assert.equal(entryOf(after.front.temporal[0]!, B.temporalIn), reflection.front.views.resolved)
  assert.equal(entryOf(after.opaque.resolve[0]!, B.resolvedOut), reflection.resolvedView)
  assert.equal(entryOf(after.opaque.temporal[0]!, B.temporalIn), reflection.resolvedView)
})

test('a closure whose layers no trace wrote reads the first closure’s: the two layers are copied into its own', () => {
  const { device } = fakeDevice()
  const reflection = createScreenReflection(device, 16, 8, false, false, 3)
  const copies: { from: unknown; to: unknown; size: unknown }[] = []
  const encoder = {
    copyTextureToTexture: (from: unknown, to: unknown, size: unknown) =>
      copies.push({ from, to, size }),
  } as unknown as GPUCommandEncoder
  const [first, second] = reflection.closureSides.sides
  assert.equal(first!.written, false)
  first!.copyFirst(encoder)
  second!.copyFirst(encoder)
  assert.deepEqual(
    copies.map(({ from, to, size }) => [
      (from as { texture: unknown }).texture === reflection.target,
      (to as { origin: number[] }).origin,
      size,
    ]),
    [
      [true, [0, 0, 2], [16, 8, 2]],
      [true, [0, 0, 4], [16, 8, 2]],
    ],
  )
})

test('the classification of a closure runs over its overflow tiles: they mark their tracing tiles, the marked are listed, and the classification of a tile is the grid’s', () => {
  const code = closureClassifyWgsl()
  assert.deepEqual(unresolvedNames(code), [])
  assert.deepEqual(reservedNames(code), [])
  assert.equal(unbalanced(code), '')
  for (const entry of [CLOSURE_MARK_ENTRY, CLOSURE_LIST_ENTRY, CLOSURE_CLASSIFY_ENTRY])
    assert.match(code, new RegExp(`fn ${entry}\\(`))
  // The overflow tile marks the tracing tile that holds it, by an atomic; the list takes the mark back as it appends the tile.
  assert.match(code, /let overflow=overflowTileAt\(group\);\n if\(overflow\.z==0u\)\{return;\}/)
  assert.match(code, /atomicStore\(&closureMarks\[tile\.y\*tiles\.x\+tile\.x\],1u\)/)
  assert.match(code, /atomicExchange\(&closureMarks\[id\.x\],0u\)!=0u/)
  assert.match(code, /markedOut\.entries\[markedOutAppend\(1u,1u\)\]/)
  // The classification reads its tile off the list, told to the whole workgroup (the barrier below stays in uniform control flow), then is the grid's.
  assert.match(code, /workgroupUniformLoad\(&closureListed\)/)
  assert.ok(code.includes(CLASSIFY_TILE_STATEMENTS), 'the same classification as the grid’s')
  assert.ok(
    REFLECTION_CLASSIFY_WGSL.text.includes(CLASSIFY_TILE_STATEMENTS),
    'and the grid’s kernel is made of it too',
  )
  // The default module (a record of one closure) holds none of it.
  assert.doesNotMatch(reflectionTraceShader(false), /markClosureTiles|classifyClosureTiles/)
  assert.equal(listGroups([1920, 1080]), Math.ceil((240 * 135) / 64))
})
