// The layouts of the reflection trace's kernels (`traceLayouts`) hold every binding of group 0 the kernel's code reaches
// (a pipeline asks the layout for each one it uses), and the scene stage, which reads the surface cache, holds the layers a
// hit reads and no more.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hardwareSceneLayout,
  REFLECTION_TRACE_BINDINGS as B,
  traceLayouts,
} from './traceBindings.ts'
import { REFLECTION_DIRECTION_FORMAT } from '../grids.ts'
import { reflectionTraceShader } from './trace.ts'
import { KERNELS, device, reached } from './traceLayouts.fixture.ts'

for (const statistics of [false, true]) {
  test(`every kernel's layout holds the bindings its code reaches${statistics ? ', counting' : ''}`, () => {
    const program = reflectionTraceShader(statistics)
    const layouts = traceLayouts(device, statistics) as unknown as Record<
      string,
      { entries: { binding: number }[] }
    >
    for (const [entry, layout] of Object.entries(KERNELS)) {
      const held = new Set(layouts[layout].entries.map(({ binding }) => binding))
      for (const [binding, name] of reached(program, entry))
        assert.ok(held.has(binding), `${entry} reaches ${name} (${binding}), its layout holds none`)
    }
  })
}

test('the scene stage reads the cache’s depth, direct, indirect and final layers, the feedback and the tables, and no other layer', () => {
  const program = reflectionTraceShader(false)
  const names = [...reached(program, 'traceScene').values()]
  for (const name of [
    'surfaceTables',
    'scDepthAtlas',
    'scFinalAtlas',
    'scFeedback',
    'gdfObjectGrid',
  ])
    assert.ok(names.includes(name), name)
  // The library's layers beside those a hit reads, the albedo, normal and emission, are in no kernel's reach nor its layout.
  const reads = [B.cards, B.cards + 1, B.cards + 7, B.cards + 8]
  const layers = [...program.matchAll(/@group\(0\)\s*@binding\((\d+)\)\s*var\s+(sc\w+Atlas)/g)]
  assert.deepEqual(
    layers.filter(([, binding]) => !reads.includes(Number(binding))).map(([, , name]) => name),
    ['scAlbedoAtlas', 'scNormalAtlas', 'scEmissiveAtlas'],
  )
  for (const [, binding, name] of layers)
    assert.equal(names.includes(name), reads.includes(Number(binding)), name)
  const layout = traceLayouts(device, false).scene as unknown as { entries: { binding: number }[] }
  const held = layout.entries.map(({ binding }) => binding)
  assert.ok(
    reads.every((binding) => held.includes(binding)),
    'what a hit reads is bound',
  )
  assert.ok(![B.cards + 2, B.cards + 3, B.cards + 4].some((binding) => held.includes(binding)))
})

test('the two ray stages draw a ray’s direction from the blue noise at the grid texel and the image’s turn, and no other kernel reads it', () => {
  const program = reflectionTraceShader(false)
  assert.ok(program.includes('blueNoiseVec2(g,reflectionView.temporal.x)'))
  assert.ok(!program.includes('additive2d'), 'no plastic-number sequence beside it')
  for (const entry of ['traceScreen', 'traceScene'])
    assert.ok(reached(program, entry).has(B.blue), `${entry} reads the noise`)
  for (const entry of ['classifyTiles', 'clearTracing', 'resolveSurface', 'temporalSurface'])
    assert.ok(!reached(program, entry).has(B.blue), `${entry} does not`)
  const layouts = traceLayouts(device, false) as unknown as Record<
    string,
    { entries: { binding: number; storageTexture?: { access: string } }[] }
  >
  for (const kernel of ['screen', 'scene']) {
    const entry = layouts[kernel].entries.find(({ binding }) => binding === B.blue)
    assert.equal(
      entry?.storageTexture?.access,
      'read-only',
      `${kernel} binds it as read-only storage`,
    )
  }
})

test('a mirror casts its reflection about its normal, and the roughness a ray is drawn at is the smooth-biased one', () => {
  const program = reflectionTraceShader(false)
  assert.ok(program.includes('if(own.top<0.001){ray.R=reflect(-own.V,own.topN);}'))
  assert.ok(program.includes('reflectionTopRay(own.N,own.V,own.top,u)'))
  assert.ok(
    program.includes('return r*x*x*(3.0-2.0*x);'),
    'the smoothstep of the roughness up to the bias',
  )
  assert.ok(program.includes('if(!(bias>0.0)){return r;}'), 'none at a bias of zero')
})

test('the tile jitter of a block of two across and one down alternates by row and frame index, which is not the turn of the ray directions; a block one pixel across has none', () => {
  const program = reflectionTraceShader(false)
  assert.ok(program.includes('let turn=reflectionView.temporal.z;'))
  assert.ok(program.includes('if(block.x<2u){return vec2u(0u);}'))
  assert.ok(program.includes('if(block.y<2u){return vec2u((g.y+turn)%2u,0u);}'))
})

test('the scene stage through the scene’s triangles holds the bindings its code reaches, the cut’s tables beside the cache’s, and neither the field nor its grid', () => {
  const program = reflectionTraceShader(false, true)
  const reachedHere = reached(program, 'traceScene')
  const layout = hardwareSceneLayout(device) as unknown as { entries: { binding: number }[] }
  const held = new Set(layout.entries.map(({ binding }) => binding))
  for (const [binding, name] of reachedHere)
    assert.ok(held.has(binding), `traceScene reaches ${name} (${binding}), its layout holds none`)
  // The cut's tables sit at the culling's bindings; the surface stage's pixels moved off the first of them.
  for (const binding of [1, 6, 7, 9]) assert.ok(held.has(binding), `the cut's table at ${binding}`)
  assert.notEqual(B.normals, 1)
  const names = [...reachedHere.values()]
  for (const name of ['hitInstances', 'scFeedback']) assert.ok(names.includes(name), name)
  assert.ok(!names.some((name) => name.startsWith('gdf')), 'no field is marched')
  assert.ok(!held.has(B.field) && !held.has(B.grid), 'neither the field nor its grid is bound')
  // The scene trace's own group holds its four bindings from 0.
  assert.match(program, /@group\(2\)\s*@binding\(0\)\s*var<uniform>\s+stParams/)
})

test('a drawn lobe ray is the mirror of the view about the drawn half vector, no fold under the surface', () => {
  const program = reflectionTraceShader(false)
  assert.ok(program.includes('return reflect(-V,normalize(h.x*f.T+h.y*f.B+h.z*N));'))
  assert.ok(!program.includes('min(dot(L,N),0.0)'))
})

test('no kernel binds more storage textures than a stage holds (four): the ray’s depth is a layer of the ray words, not a texture of its own', () => {
  const program = reflectionTraceShader(false)
  assert.ok(!program.includes('rayDataOut') && !program.includes('rayDataIn'))
  assert.ok(!('rayDataOut' in B) && !('rayDataIn' in B))
  for (const statistics of [false, true]) {
    const layouts = traceLayouts(device, statistics) as unknown as Record<
      string,
      { entries: { binding: number; storageTexture?: { viewDimension?: string } }[] }
    >
    for (const [kernel, layout] of Object.entries(layouts)) {
      const storage = layout.entries.filter(({ storageTexture }) => storageTexture)
      assert.ok(storage.length <= 4, `${kernel} binds ${storage.length} storage textures`)
    }
    const rays = layouts.screen.entries.find(({ binding }) => binding === B.rays)
    assert.equal(rays?.storageTexture?.viewDimension, '2d-array', 'the ray words are an array')
  }
  // The screen stage writes the depth in the layer after the word; the resolve reads it there.
  assert.ok(program.includes('textureStore(surfaceRays,texel,REFLECTION_RAY_DEPTH,'))
  assert.ok(program.includes('textureLoad(surfaceRaysRead,g,REFLECTION_RAY_DEPTH,0)'))
})

test('the screen stage writes each ray as the reference stores it, its direction and its cone angle in the four half floats of a texel, which the resolve alone reads, its pdf the inverse of the cone', () => {
  const program = reflectionTraceShader(false)
  assert.equal(REFLECTION_DIRECTION_FORMAT, 'rgba16float')
  assert.ok(
    program.includes(
      'textureStore(surfaceDirections,texel,vec4f(ray.R,reflectionCastCone(own,ray)));',
    ),
  )
  // A mirror's ray is drawn from no distribution: its cone is the least angle; any other's is that of its ray's pdf.
  assert.ok(program.includes('if(own.top<0.001){return REFLECTION_MIN_CONE;}'))
  assert.ok(
    program.includes(
      'return reflectionRayCone(own.topN,own.V,ray.axis.xyz,vec2f(ray.along,ray.alpha),ray.R);',
    ),
  )
  assert.ok(program.includes('textureLoad(surfaceDirectionsRead,g,0)'))
  assert.ok(program.includes('fn reflectionPdfOfCone(cone:f32)->f32{return 1.0/abs(cone);}'))
  assert.ok(
    !program.includes('fn rayPack') && !program.includes('fn rayDirection'),
    'no octahedral word',
  )
  assert.ok(reached(program, 'traceScreen').has(B.directions))
  assert.ok(reached(program, 'resolveSurface').has(B.directionsRead))
  for (const entry of ['traceScene', 'temporalSurface', 'bilateralOpaque'])
    assert.ok(!reached(program, entry).has(B.directionsRead), `${entry} does not read them`)
  const layouts = traceLayouts(device, false) as unknown as Record<
    string,
    { entries: { binding: number; storageTexture?: { access: string; format: string } }[] }
  >
  const written = layouts.screen.entries.find(({ binding }) => binding === B.directions)
  assert.deepEqual(
    [written?.storageTexture?.access, written?.storageTexture?.format],
    ['write-only', 'rgba16float'],
  )
  assert.ok(layouts.resolve.entries.some(({ binding }) => binding === B.directionsRead))
})

test('a screen hit is final and a miss is listed with the distance it reached: no partial answer is kept, no confidence chain', () => {
  const program = reflectionTraceShader(false)
  assert.ok(
    program.includes(
      'return ReflectionMissed(vec2u(g.x|(g.y<<16u),bitcast<u32>(b.distance)),true);',
    ),
  )
  assert.ok(
    program.includes(
      'reflectionSceneStage(own.P,own.topN,ray,bitcast<f32>(missed.y),g,cone,isFirstPerson(own.flags))',
    ),
  )
  for (const gone of ['partialOut', 'partialIn', 'reflectionChain', 'reflectionTake', 'confidence'])
    assert.ok(!program.includes(gone), gone)
  assert.ok(!('partialOut' in B) && !('partialIn' in B))
})
