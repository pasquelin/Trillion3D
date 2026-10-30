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
import { REFLECTION_RAY_FORMAT } from '../grids.ts'
import { reflectionTraceShader } from './trace.ts'
import { KERNELS, device, filterableDevice, reached } from './traceLayouts.fixture.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'

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

test('the ray generation alone draws a ray’s direction, from the blue noise at the grid texel and the image’s turn, and no other kernel reads it', () => {
  const program = reflectionTraceShader(false)
  assert.ok(program.includes('blueNoiseVec2(g,reflectionView.temporal.x)'))
  assert.ok(!program.includes('additive2d'), 'no plastic-number sequence beside it')
  assert.ok(reached(program, 'generateRays').has(B.blue), 'generateRays reads the noise')
  for (const entry of [
    'classifyTiles',
    'clearTracing',
    'traceScreen',
    'traceScene',
    'resolveSurface',
    'temporalSurface',
  ])
    assert.ok(!reached(program, entry).has(B.blue), `${entry} does not`)
  const layouts = traceLayouts(device, false) as unknown as Record<
    string,
    { entries: { binding: number; storageTexture?: { access: string } }[] }
  >
  const entry = layouts.generate.entries.find(({ binding }) => binding === B.blue)
  assert.equal(entry?.storageTexture?.access, 'read-only', 'generate binds it as read-only storage')
  for (const kernel of ['screen', 'scene'])
    assert.ok(
      !layouts[kernel].entries.some(({ binding }) => binding === B.blue),
      `${kernel} binds no noise`,
    )
  const hardware = hardwareSceneLayout(device) as unknown as { entries: { binding: number }[] }
  assert.ok(
    !hardware.entries.some(({ binding }) => binding === B.blue),
    'nor does the scene stage through the scene’s triangles',
  )
})

test('a mirror casts its reflection about its normal, and the roughness a ray is drawn at is the smooth-biased one', () => {
  const program = reflectionTraceShader(false)
  assert.ok(program.includes('if(own.top<0.001){ray.R=reflect(-own.V,own.topN);}'))
  assert.ok(program.includes('reflectionTopRay(own.topN,own.V,own.top,u)'))
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

test('the scene stage through the scene’s triangles holds the bindings its code reaches and no other (not the cut’s tables, which the trace of the triangles alone reads), and neither the field nor its grid', () => {
  const program = reflectionTraceShader(false, true)
  const reachedHere = reached(program, 'traceScene')
  const layout = hardwareSceneLayout(device) as unknown as { entries: { binding: number }[] }
  const held = new Set(layout.entries.map(({ binding }) => binding))
  for (const [binding, name] of reachedHere)
    assert.ok(held.has(binding), `traceScene reaches ${name} (${binding}), its layout holds none`)
  // Only reachable bindings: the answer reads the triangles the trace kept, so the cut's tables (the culling's bindings 1, 6, 7 and 9,
  // which the surface stage's pixels moved off) are in the trace's layout alone.
  for (const binding of held)
    assert.ok(reachedHere.has(binding), `binding ${binding} is never reached`)
  for (const binding of [1, 6, 7, 9]) assert.ok(!held.has(binding), `no cut's table at ${binding}`)
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

test('no kernel binds more storage textures than a stage holds (four): the ray’s depth, direction and cone angle are layers of one ray texture, not textures of their own', () => {
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
    assert.equal(rays?.storageTexture?.viewDimension, '2d-array', 'the rays are an array')
  }
  // The ray generation writes the depth in the first layer; the resolve reads it there.
  assert.ok(program.includes('textureStore(surfaceRays,texel,REFLECTION_RAY_DEPTH,'))
  assert.ok(program.includes('textureLoad(surfaceRaysRead,g,REFLECTION_RAY_DEPTH,0)'))
})

test('the ray generation writes each ray as the reference stores it, its direction and its cone angle in the four half floats of two words beside the depth of its pixel, which the stages trace and the resolve reads, its pdf the inverse of the cone', () => {
  const program = reflectionTraceShader(false)
  assert.equal(REFLECTION_RAY_FORMAT, 'r32uint')
  assert.ok(
    program.includes(
      'let words=reflectionRayWords(ray.R,select(cone,-cone,isFirstPerson(own.flags)));',
    ),
    'the sign of the cone angle tells a first-person pixel',
  )
  assert.ok(
    program.includes(
      'textureStore(surfaceRays,texel,REFLECTION_RAY_DIRECTION,vec4u(words.x,0u,0u,0u));',
    ),
  )
  assert.ok(
    program.includes(
      'textureStore(surfaceRays,texel,REFLECTION_RAY_CONE,vec4u(words.y,0u,0u,0u));',
    ),
  )
  assert.ok(
    program.includes(
      'textureStore(surfaceRays,texel,REFLECTION_RAY_DEPTH,vec4u(bitcast<u32>(-surfaceDepthAt(layer,coord)),0u,0u,0u));',
    ),
    'a pixel that casts no ray keeps its depth negated',
  )
  // A mirror's ray is drawn from no distribution: its cone is the least angle; any other's is that of its ray's pdf.
  assert.ok(program.includes('if(own.top<0.001){return REFLECTION_MIN_CONE;}'))
  assert.ok(
    program.includes(
      'return reflectionRayCone(own.topN,own.V,ray.axis.xyz,vec2f(ray.along,ray.alpha),ray.R);',
    ),
  )
  assert.ok(program.includes('fn reflectionPdfOfCone(cone:f32)->f32{return 1.0/abs(cone);}'))
  assert.ok(
    !program.includes('fn rayPack') && !program.includes('fn rayDirection'),
    'no octahedral word',
  )
  // The generation writes them; the stages read them as the storage they are written through, the resolve sampled, no one else.
  for (const entry of ['generateRays', 'traceScreen', 'traceScene', 'clearTracing'])
    assert.ok(reached(program, entry).has(B.rays), `${entry} reaches the rays as storage`)
  assert.ok(reached(program, 'resolveSurface').has(B.raysRead))
  for (const entry of ['classifyTiles', 'temporalSurface', 'bilateralOpaque'])
    assert.ok(
      !reached(program, entry).has(B.rays) && !reached(program, entry).has(B.raysRead),
      `${entry} does not read them`,
    )
  const layouts = traceLayouts(device, false) as unknown as Record<
    string,
    { entries: { binding: number; storageTexture?: { access: string; format: string } }[] }
  >
  const written = layouts.generate.entries.find(({ binding }) => binding === B.rays)
  assert.deepEqual(
    [written?.storageTexture?.access, written?.storageTexture?.format],
    ['read-write', 'r32uint'],
  )
  assert.ok(layouts.resolve.entries.some(({ binding }) => binding === B.raysRead))
  assert.ok(
    !layouts.classify.entries.some(({ binding }) => binding === B.rays),
    'the classification writes none',
  )
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
      'reflectionSceneStage(own.P,own.topN,stored.ray,bitcast<f32>(missed.y),g,stored.cone,stored.firstPerson)',
    ),
  )
  for (const gone of ['partialOut', 'partialIn', 'reflectionChain', 'reflectionTake', 'confidence'])
    assert.ok(!program.includes(gone), gone)
  assert.ok(!('partialOut' in B) && !('partialIn' in B))
})

test('the field’s coarse mip is a filterable texture sampled once through the field’s sampler where the device has float32-filterable, else an unfilterable one read by loads', () => {
  const mipOf = (gpu: GPUDevice) =>
    (
      traceLayouts(gpu, false).scene as unknown as {
        entries: { binding: number; texture?: { sampleType: string } }[]
      }
    ).entries.find(({ binding }) => binding === B.field + 3)?.texture?.sampleType
  assert.equal(mipOf(device), 'unfilterable-float')
  assert.equal(mipOf(filterableDevice), 'float')
  const program = (filterable: boolean) =>
    reflectionTraceShader(false, false, 'none', WORD_LIGHT_FORMAT, undefined, undefined, undefined, filterable)
  const native = program(true)
  assert.equal(native.match(/textureSampleLevel\(gdfMip,/g)?.length, 1)
  assert.ok(!native.includes('textureLoad(gdfMip'))
  const polyfill = program(false)
  assert.ok(polyfill.includes('textureLoad(gdfMip') && !polyfill.includes('textureSampleLevel(gdfMip'))
})

test('the counting program declares no function, constant or variable twice, whatever the lanes (a march block included in two variants)', () => {
  for (const lanes of ['none', 'native', 'polyfill'] as const) {
    const text = reflectionTraceShader(true, false, lanes) as unknown as string
    const names = [...String(text).matchAll(/^(?:fn|const|struct|var<[a-z]+(?:,[a-z_]+)?>|var) +([A-Za-z_]\w*)/gm)].map((m) => m[1])
    const twice = names.filter((n, i) => names.indexOf(n) !== i)
    assert.ok(names.length > 100, 'the declarations are read')
    assert.deepEqual(twice, [], `${lanes}: declared twice`)
  }
})
