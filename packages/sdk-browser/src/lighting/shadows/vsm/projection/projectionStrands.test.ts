// The projection onto the hair strands: the two passes of the projection over the input `strands`
// (`projectionWgsl.ts`, `../inputType.ts`), each an indirect dispatch over the list of all the tiles with
// strands into the strands' own masks (`hairProjectionPass.ts`). A strand is valid where it holds the
// depth of the nearest strand, reads no surface, is moved toward each light by the normal bias, culls no
// back face and casts no screen ray.
import test from 'node:test'
import assert from 'node:assert/strict'
import { pipelinesSettled } from '../../../deferred/compileLedger.ts'
import { ComputeRun } from '../../../../gpu/core/lazyComputePass.ts'
import { fakeHizDepth } from '../hizDepth.fixture.ts'
import { vsmLayout } from '../layout.ts'
import { encodeVsmHairProjection, vsmHairMasks } from './hairProjectionPass.ts'
import { projectionKit } from './projectionKit.fixture.ts'
import {
  writeVsmProjectionFrame,
  type VsmProjectionFrame,
  type VsmProjectionLight,
} from './projectionPass.ts'
import { localsPipeline, passesOf, pipelinesFor } from './projectionPipelines.ts'
import { camera, sun } from './projectionScene.fixture.ts'
import { vsmLocalsProjectionWgsl, vsmSunsProjectionWgsl } from './projectionWgsl.ts'

const layoutOptions = { coverMode: 'suns', fullMapCapacity: 63, sunMapCapacity: 18 } as const
const layout = vsmLayout(layoutOptions)
const suns = vsmSunsProjectionWgsl(layout, false, 'strands')
const locals = vsmLocalsProjectionWgsl(layout, 'rg32uint', false, 'strands')
const opaqueSuns = vsmSunsProjectionWgsl(layout)
const pixelOf = (code: string) => {
  const at = code.indexOf('fn vsmPixelOf')
  return code.slice(at, code.indexOf('\n}\n', at))
}
/** Whether `name` is called nowhere in `code` but declared (each name in its declaration alone). */
const neverCalled = (code: string, name: string) =>
  code.split(`${name}(`).length === code.split(`fn ${name}(`).length

test('a pixel is a tile’s of the list of all the tiles with strands, valid where a strand holds its depth', () => {
  for (const code of [suns, locals]) {
    const pixel = pixelOf(code)
    assert.ok(pixel.includes('let listed=rank<vsmHairCounts[0];'))
    assert.ok(pixel.includes('let deviceZ=textureLoad(vsmHairDepth,coord,0).x;'))
    assert.ok(pixel.includes('p.info.valid=p.inRect&&deviceZ>0.0;'))
    assert.ok(code.includes('vsmPixelOf(flatIndex(groupId,groups,1u),groupIndex)'))
    assert.ok(code.includes('var<uniform> vsmHairCounts:vec4u;'), 'the counts a uniform')
  }
})

test('a strand reads no surface: a hair whose shadow lets no light through', () => {
  const pixel = pixelOf(suns)
  assert.ok(pixel.includes('p.info.hair=true;'), 'its receiver plane faces the light')
  assert.ok(pixel.includes('p.info.opacity=-1.0;'), 'it lets no light through')
  assert.ok(!pixel.includes('p.info.subsurface'), 'whatever surface lies under it')
  for (const code of [suns, locals])
    for (const name of [
      'vsmSceneDepth',
      'vsmNormalRough',
      'vsmFlags',
      'vsmSurfaceOf',
      'vsmLobes',
      'subsurfaceColor',
    ])
      assert.ok(!code.includes(name), `no surface: ${name}`)
  assert.ok(!/\btileLights\b/.test(locals), 'the cells read in the shadowed lights’ grid alone')
})

test('a strand is moved toward each light by the normal bias, light by light, and casts no screen ray', () => {
  const receiver = suns.slice(suns.indexOf('fn vsmStrandReceiverOf'))
  assert.ok(receiver.includes('r.P+=axis*vsmNormalOffset(r.P-vsmView.shiftedEye);'))
  for (const code of [suns, locals]) {
    assert.ok(code.includes('let receiver=vsmStrandReceiverOf(pixel,vsmView.lights[k],inLight);'))
    assert.ok(!code.includes('let receiver=vsmReceiverOf('))
    assert.ok(!code.includes('startOffset=vsmScreenRayFrom('), 'no screen ray')
  }
  assert.ok(opaqueSuns.includes('startOffset=vsmScreenRayFrom('), 'the surfaces cast theirs')
})

test('no back face is culled: the region test is the light’s reach alone', () => {
  for (const code of [suns, locals]) {
    for (const name of ['vsmFacesAwayFromSun', 'vsmFacesAwayFromLocal'])
      assert.ok(neverCalled(code, name), name)
    assert.ok(!code.includes('vsm.cullBackfacing'))
  }
  assert.ok(!neverCalled(opaqueSuns, 'vsmFacesAwayFromSun'), 'the surfaces cull theirs')
})

/** The storage buffers the layouts `groups` (the kit's descriptors) bind. */
const storageBuffers = (...groups: GPUBindGroupLayout[]) =>
  groups
    .flatMap((g) => [...(g as unknown as GPUBindGroupLayoutDescriptor).entries])
    .filter((e) => e.buffer && e.buffer.type !== 'uniform').length

test('each pass of the strands holds the eight storage buffers a stage is given at least, the counts a uniform', () => {
  const { device } = projectionKit()
  for (const prefilteredDistant of [false, true]) {
    const p = pipelinesFor(device, vsmLayout({ ...layoutOptions, prefilteredDistant }))
    const strands = passesOf(p, 'strands')
    const sunsCount = storageBuffers(p.vsmLayout, strands.sunsLayout)
    const localsCount = storageBuffers(
      p.vsmLayout,
      localsPipeline(p, 'rg32uint', 'strands').groupLayout,
    )
    // The list of the tiles beside the surfaces' bindings, which hold none; the locals' in the place of
    // the light grid's lists.
    assert.equal(sunsCount, storageBuffers(p.vsmLayout, p.sunsLayout) + 1)
    assert.equal(
      localsCount,
      storageBuffers(p.vsmLayout, localsPipeline(p, 'rg32uint').groupLayout),
    )
    assert.ok(sunsCount <= 8 && localsCount <= 8, `${sunsCount}, ${localsCount}`)
  }
})

const point = (z: number): VsmProjectionLight => ({
  type: 'point',
  mapId: 8192,
  direction: [0, -1, 0],
  position: [0, 0, z],
  radius: 2,
})

test('both passes dispatch over the list of all the tiles, into the strands’ masks; none for the strands of no view', async () => {
  const kit = projectionKit()
  const { device, res } = kit
  const view = {} as GPUTextureView
  const buffer = (usage: number) => device.createBuffer({ size: 256, usage })
  const storage = () => buffer(GPUBufferUsage.STORAGE)
  const source = {
    ...{ depth: view, normalRough: view, flags: view, subsurface: view, lobes: view },
    ...{
      deferredView: buffer(GPUBufferUsage.UNIFORM),
      directLights: storage(),
      tileLights: storage(),
    },
    gridCells: 64,
  }
  const target = {
    suns: view,
    locals: view,
    localFormat: 'rg32uint' as const,
    lightGrid: storage(),
  }
  const hair = {
    hairDepth: view,
    counts: buffer(GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM),
    tiles: storage(),
    dispatchArgs: device.createBuffer({
      label: 'dispatch',
      size: 256,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT,
    }),
  }
  const frame: VsmProjectionFrame = {
    device,
    hizDepth: fakeHizDepth,
    ...{ width: 64, height: 32, camera, frameIndex: 1 },
    lights: [sun, point(-5)],
  }
  writeVsmProjectionFrame(res, frame)
  const project = (strands: typeof hair | undefined, onePass = true) => {
    const before = kit.dispatches.length
    const steps = new ComputeRun().begin(kit.encoder)
    const masks = encodeVsmHairProjection(
      steps,
      res,
      frame,
      source,
      { ...target, onePass },
      strands,
    )
    steps.end()
    return {
      masks,
      dispatched: kit.dispatches
        .slice(before)
        .map((d) => `${d.entryPoint} ${d.buffer?.label ?? 'direct'} ${d.offset ?? ''}`),
    }
  }
  project(hair)
  await pipelinesSettled(device)
  const both = project(hair)
  assert.deepEqual(both.dispatched, ['vsmProjectSuns dispatch 0', 'vsmProjectLocals dispatch 0'])
  assert.ok(both.masks?.suns && both.masks.locals && both.masks.sunLayers === 1)
  assert.equal(vsmHairMasks(res), both.masks)
  assert.deepEqual(
    project(hair, false).dispatched,
    ['vsmProjectSuns dispatch 0'],
    'per light: the suns’ alone',
  )
  assert.deepEqual(project(undefined).dispatched, [])
  assert.equal(vsmHairMasks(res), undefined, 'the masks given back')
})
