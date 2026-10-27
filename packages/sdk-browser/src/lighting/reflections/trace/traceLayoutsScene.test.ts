// The reflection trace's layouts, kernel by kernel: what the screen and scene stages write and read, and what a ray is fogged and cast by.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hardwareSceneLayout,
  hardwareTraceLayout,
  REFLECTION_TRACE_BINDINGS as B,
  traceLayouts,
} from './traceBindings.ts'
import { reflectionLayout } from '../reflectionPipelines.ts'
import { reflectionTraceShader } from './trace.ts'
import { REFLECTION_DEPTH_FORMAT } from '../grids.ts'
import { installGpuGlobals } from '../../../../../../tests/kit/fakeDevice/globals.ts'
import { KERNELS, device, reached } from './traceLayouts.fixture.ts'

// The reflection group's layout reads the stage flags (`GPUShaderStage`).
installGpuGlobals()

test('the scene stage is cast from the grid texel like the screen stage, and only the program through the scene’s triangles makes its radiance finite', () => {
  const field = reflectionTraceShader(false)
  const hardware = reflectionTraceShader(false, true)
  for (const program of [field, hardware])
    assert.ok(
      program.includes(
        'reflectionSceneStage(own.P,own.topN,stored.ray,bitcast<f32>(missed.y),g,stored.cone,stored.firstPerson)',
      ),
    )
  assert.ok(field.includes('freshPack(b.radiance,b.distance)'))
  assert.ok(hardware.includes('freshPack(makeFinite3(b.radiance),b.distance)'))
})

test('a coat’s biased roughness takes its width with it, the pixel’s lobes carrying one lobe', () => {
  const program = reflectionTraceShader(false)
  // The top lobe is biased once (`surfaceTopAt`'s own bias), and a coated pixel's lobes take that roughness whole, the width following it.
  assert.ok(program.includes('let top=vec4f(raw.xyz,reflectionSmoothed(raw.w));'))
  assert.ok(
    program.includes(
      'lobes.coatRough=top.w;\n  let coatFloor=lobeRoughness(lobes.coatRough);lobes.coatAlpha=coatFloor*coatFloor;',
    ),
  )
})

test('the two ray stages read the surfaces’ vectors and the depth the last image kept, and one kernel keeps this image’s depth', () => {
  const program = reflectionTraceShader(false)
  for (const entry of ['traceScreen', 'traceScene']) {
    const names = [...reached(program, entry).values()]
    for (const name of ['temporalVectors', 'reflectionDepthHistory'])
      assert.ok(names.includes(name), `${entry} reads ${name}`)
  }
  const layouts = traceLayouts(device, false) as unknown as Record<
    string,
    { entries: { binding: number; texture?: object; storageTexture?: { access: string } }[] }
  >
  const hardware = hardwareSceneLayout(device) as unknown as typeof layouts.screen
  for (const layout of [layouts.screen, layouts.scene, hardware])
    assert.ok(
      layout.entries.some((entry) => entry.binding === B.vectors && entry.texture),
      `sampled at ${B.vectors}`,
    )
  // The depth is sampled by the stages that fit it among the sixteen sampled textures of a stage; the scene stage through the scene's
  // triangles, which the fog's cubemap fills, loads it as a read-only storage texture (and the program declares it so).
  for (const layout of [layouts.screen, layouts.scene])
    assert.ok(
      layout.entries.some((entry) => entry.binding === B.depthHistory && entry.texture),
      `sampled at ${B.depthHistory}`,
    )
  assert.ok(
    hardware.entries.some(
      (entry) => entry.binding === B.depthHistory && entry.storageTexture?.access === 'read-only',
    ),
    'loaded as storage by the triangles',
  )
  assert.ok(
    reflectionTraceShader(false, true).includes(
      `var reflectionDepthHistory:texture_storage_2d<${REFLECTION_DEPTH_FORMAT},read>;`,
    ),
  )
  assert.ok(program.includes('var reflectionDepthHistory:texture_2d<f32>;'))
  // The kernel that keeps the depth writes it as storage, alone, and the denoising reads none of the two.
  assert.deepEqual(
    layouts.keepDepth.entries.map(({ binding, storageTexture }) => [
      binding,
      storageTexture?.access,
    ]),
    [[B.depthKeep, 'write-only']],
  )
  assert.ok(reached(program, 'keepDepth').has(B.depthKeep))
  assert.ok(!reached(program, 'resolveSurface').has(B.depthHistory))
})

test('the scene stage alone fogs a ray: it reaches the fog’s cubemap and sampler, both bound in each of its layouts, within the sixteen sampled textures of a stage', () => {
  const marched = reflectionTraceShader(false)
  const traced = reflectionTraceShader(false, true)
  for (const entry of Object.keys(KERNELS)) {
    const reachesFog = reached(marched, entry).has(B.fogCubemap)
    assert.equal(
      reachesFog,
      entry === 'traceScene',
      `${entry} ${reachesFog ? 'reaches' : 'does not reach'} the fog`,
    )
    assert.equal(
      reached(marched, entry).has(B.fogSampler),
      reachesFog,
      `${entry}: the sampler goes with the cubemap`,
    )
  }
  assert.ok(reached(traced, 'traceScene').has(B.fogCubemap), 'through the scene’s triangles too')
  type Layout = { entries: { binding: number; texture?: object; sampler?: object }[] }
  const groups = [
    traceLayouts(device, false).scene as unknown as Layout,
    hardwareSceneLayout(device) as unknown as Layout,
  ]
  for (const layout of groups) {
    const held = layout.entries.map(({ binding }) => binding)
    assert.ok(held.includes(B.fogCubemap) && held.includes(B.fogSampler))
    const cube = layout.entries.find(({ binding }) => binding === B.fogCubemap) as {
      texture: { viewDimension: string }
    }
    assert.equal(cube.texture.viewDimension, 'cube')
    // The sampled textures of the three groups the stage binds (the trace's, the reflection's, the scene trace's own).
    const sampled = [layout, reflectionLayout(device) as unknown as Layout]
    if (layout === groups[1]) sampled.push(hardwareTraceLayout(device) as unknown as Layout)
    const textures = sampled.flatMap(({ entries }) => entries).filter(({ texture }) => texture)
    assert.ok(textures.length <= 16, `${textures.length} sampled textures`)
  }
})
