// The page marking from the hair strands: the pixel pass's one program over the input `strands`
// (`vsmPixelPageMarkingWgsl`), one indirect dispatch over the list of all the tiles with strands, after
// the marking from the surfaces, the pixels' or the froxels' (`markingPass.ts`). Its pixels are those of
// those tiles the stride picks, at the depth of the nearest strand; it culls no back face, has no
// first-person pixel and reads no surface; past the pixel its kernel is the surfaces'.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { pipelinesSettled } from '../../deferred/compileLedger.ts'
import { VSM_DEFAULT_SHADOWS } from './mapSettings.ts'
import { createVsmMarking, vsmMarkingPipes, type VsmMarkingFrame } from './markingPass.ts'
import { vsmPixelPageMarkingWgsl } from './markingWgsl.ts'
import { createVsmResources } from './resources.ts'
import { vsmLayout } from './layout.ts'
import { FROXEL_MARK_ENTRY } from './froxel/froxelMarkWgsl.ts'

const layout = vsmLayout({ coverMode: 'suns', fullMapCapacity: 63, sunMapCapacity: 18 })
const strands = vsmPixelPageMarkingWgsl(layout, false, false, false, 'strands')
const surfaces = vsmPixelPageMarkingWgsl(layout)
const kernelOf = (code: string) => code.slice(code.indexOf('fn vsmMarkPagesFromPixels'))
const kernel = kernelOf(strands)

test('a group is a tile of the list of all the tiles with strands, past the count it marks nothing', () => {
  assert.ok(kernel.includes('if(rank>=hairTileCounts[0]){return;}'))
  assert.ok(kernel.includes('let tile=hairTiles[rank];'))
  assert.ok(strands.includes('var<uniform> hairTileCounts:vec4u;'), 'the counts a uniform')
})

test('the pixels are those the stride picks, wherever their tile lies, and those a strand holds the depth of', () => {
  assert.ok(kernel.includes('if(any(local%vsmMarking.markStride!=vec2u(0u))){return;}'))
  assert.ok(kernel.includes('let deviceZ=textureLoad(hairDepth,coord,0).x;'))
  assert.ok(kernel.includes('if(!(deviceZ>0.0)){return;}'))
})

test('no back face is culled, no pixel is a first-person one, no surface is read', () => {
  for (const name of [
    'surfaceFlags',
    'normalRough',
    'frontDepth',
    'backfaceCull',
    'vsmMarking.cullBackfacing',
    'isFirstPerson(',
  ])
    assert.ok(!strands.includes(name), name)
  assert.ok(kernel.includes('let firstPersonPixel=false;'))
  // The back-face tests come declared with the projection data every marking reads
  // (`VSM_PROJECTION_DATA_WGSL`): the program calls neither, each name stands in its declaration alone.
  for (const name of ['vsmFacesAwayFromSun', 'vsmFacesAwayFromLocal'])
    assert.equal(strands.split(`${name}(`).length, strands.split(`fn ${name}(`).length, name)
})

test('past the pixel, the strands’ kernel is the surfaces’ but for the back-face cull and the first-person test', () => {
  const pastPixel = (code: string) => {
    const k = kernelOf(code)
    return k
      .slice(k.indexOf(' let sceneDepth='))
      .split('\n')
      .filter((line) => !/backfaceCull|sourceRadius|source radius|let firstPersonPixel=/.test(line))
      .join('\n')
  }
  assert.equal(pastPixel(strands), pastPixel(surfaces))
})

/** The storage buffers a pipe's groups bind, of every stage. */
const storageBuffers = (groups: readonly GPUBindGroupLayout[]) =>
  groups
    .flatMap((g) => [...(g as unknown as GPUBindGroupLayoutDescriptor).entries])
    .filter((e) => e.buffer && e.buffer.type !== 'uniform').length

test('the strands’ pass holds the eight storage buffers a stage is given at least, the counts bound as a uniform', () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const pipes = vsmMarkingPipes(device, layout)
  assert.equal(storageBuffers(pipes.pixels(false, false, false, 'strands').groups), 8)
  assert.equal(storageBuffers(pipes.pixels(false, false, true, 'strands').groups), 8)
  assert.equal(storageBuffers(pipes.pixels().groups), 7, 'the surfaces’')
})

test('the strands are marked after the surfaces, from the pixels or the froxels: one indirect dispatch at the list of all the tiles', async () => {
  const { device } = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const res = createVsmResources(device, { coverMode: 'suns', fullMapCapacity: 63, poolPages: 256 })
  const marking = createVsmMarking(device, res)
  const steps: string[] = []
  const pass = {
    setPipeline: (p: { entryPoint: string }) => steps.push(p.entryPoint),
    setBindGroup() {},
    dispatchWorkgroups: () => void steps.push('dispatch'),
    dispatchWorkgroupsIndirect: (buffer: GPUBuffer, offset: number) =>
      void steps.push(`indirect ${buffer.label} ${offset}`),
  } as unknown as GPUComputePassEncoder
  const view = (format: GPUTextureFormat) =>
    device
      .createTexture({ size: [16, 16], format, usage: GPUTextureUsage.TEXTURE_BINDING })
      .createView()
  const buffer = (label: string, usage: number) => device.createBuffer({ label, size: 256, usage })
  const storage = (label: string) => buffer(label, GPUBufferUsage.STORAGE)
  const hair = {
    hairDepth: view('r32float'),
    // The tiles' counts, read as a uniform (`allocateHairTiles`).
    counts: buffer('counts', GPUBufferUsage.STORAGE | GPUBufferUsage.UNIFORM),
    tiles: storage('tiles'),
    dispatchArgs: buffer('dispatch', GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT),
  }
  const bin = { offset: 0, count: 1 },
    none = { offset: 0, count: 0 }
  const frame = (froxels: boolean) =>
    ({
      mapCount: 1,
      perspective: true,
      perPage: {
        ids: new Uint32Array(2),
        all: [bin, none, none, none],
        directionalOnly: [bin, none, none, none],
      },
      settings: {
        ...VSM_DEFAULT_SHADOWS,
        shadowMarkPixelPages: true,
        shadowMarkPagesUseFroxels: froxels,
      },
      view: {
        depth: view('depth32float'),
        normalRough: view('rgba16float'),
        flags: view('r32uint'),
        view: buffer('view', GPUBufferUsage.UNIFORM),
        gridCells: 0,
        viewRectMin: [0, 0],
        viewSize: [16, 16],
        sunMapCount: 1,
        viewToClip: new Float32Array(16),
        viewToShifted: new Float32Array(16),
        originShift: [0, 0, 0],
        ...{
          directLights: storage('lights'),
          tileLights: storage('tileLights'),
          lightGrid: storage('grid'),
        },
        ...{ lightVsmIds: storage('ids'), sunMapIds: storage('suns') },
        hair,
      },
    }) as unknown as VsmMarkingFrame
  for (const [froxels, surfaceStep] of [
    [false, 'vsmMarkPagesFromPixels'],
    [true, FROXEL_MARK_ENTRY],
  ] as const) {
    marking.encode(pass, frame(froxels))
    await pipelinesSettled(device)
    steps.length = 0
    marking.encode(pass, frame(froxels))
    const at = steps.indexOf(surfaceStep)
    assert.ok(at >= 0 && at < steps.length - 2, `${surfaceStep} first`)
    assert.deepEqual(
      steps.slice(-2),
      ['vsmMarkPagesFromPixels', 'indirect dispatch 0'],
      `after ${surfaceStep}`,
    )
  }
})
