// The froxel marking also marks the single-layer water's surface (`froxelMarking.ts`): once the
// scene's froxels are marked, a second pass of the same kernels runs over the froxels of the pixels the
// water drew over, a grid and a list of its own, the suns' pages alone (`markLocalLights` off). The pass
// runs where the view drew the water's depth before the marking (`VsmMarkingView.water`). Its buffers
// are held while the marking is from the froxels and the view keeps its size.
import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { writtenBytes } from '../../../../../../../tests/kit/fakeDevice/fakeRecords.ts'
import { pipelinesSettled } from '../../../deferred/compileLedger.ts'
import { VSM_DEFAULT_SHADOWS } from '../mapSettings.ts'
import { createVsmMarking, type VsmMarkingFrame } from '../markingPass.ts'
import { createVsmResources } from '../resources.ts'
import { FROXEL_ARGS_ENTRY, FROXEL_BUILD_ENTRY, FROXEL_SCENE_BINDING } from './froxelBuildWgsl.ts'
import { FROXEL_MARK_ENTRY } from './froxelMarkWgsl.ts'

const FROXEL_STEPS = [FROXEL_BUILD_ENTRY, FROXEL_ARGS_ENTRY, FROXEL_MARK_ENTRY]
/** The word of the grid that says whether its froxels mark the local lights' pages: after the matrix, the
 *  tile scale and bias, the depth words, the room and the rect (36 words in). */
const MARK_LOCAL_LIGHTS_WORD = 36

async function marking(settings: Partial<typeof VSM_DEFAULT_SHADOWS>) {
  const fake = fakeDevice({ limits: { maxStorageBufferBindingSize: 1 << 27 } })
  const { device } = fake
  const res = createVsmResources(device, { coverMode: 'suns', fullMapCapacity: 63, poolPages: 256 })
  const marked = createVsmMarking(device, res)
  const depth = () =>
    device
      .createTexture({
        size: [16, 16],
        format: 'depth32float',
        usage: GPUTextureUsage.TEXTURE_BINDING,
      })
      .createView()
  const uniform = device.createBuffer({
    size: 256,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  })
  const storage = () => device.createBuffer({ size: 256, usage: GPUBufferUsage.STORAGE })
  const scene = depth(),
    water = depth()
  const bin = { offset: 0, count: 1 },
    none = { offset: 0, count: 0 }
  const frame = (
    withWater: boolean,
    size: number,
    override: Partial<typeof VSM_DEFAULT_SHADOWS>,
    mapCount: number,
  ) =>
    ({
      mapCount,
      perspective: true,
      perPage: {
        ids: new Uint32Array(2),
        all: [bin, none, none, none],
        directionalOnly: [bin, none, none, none],
      },
      settings: { ...VSM_DEFAULT_SHADOWS, ...settings, ...override },
      view: {
        depth: scene,
        water: withWater ? water : undefined,
        view: uniform,
        gridCells: 0,
        viewRectMin: [0, 0],
        viewSize: [size, size],
        sunMapCount: 1,
        viewToClip: new Float32Array(16),
        viewToShifted: new Float32Array(16),
        originShift: [0, 0, 0],
        ...{ directLights: storage(), tileLights: storage(), lightGrid: storage() },
        ...{ lightVsmIds: storage(), sunMapIds: storage() },
      },
    }) as unknown as VsmMarkingFrame
  const steps: string[] = []
  const pass = {
    setPipeline: (p: { entryPoint: string }) => steps.push(p.entryPoint),
    setBindGroup() {},
    dispatchWorkgroups() {},
    dispatchWorkgroupsIndirect() {},
  } as unknown as GPUComputePassEncoder
  /** The froxel kernels one encoding of the marking runs, after the pipelines had their turn to compile. */
  const encode = async (
    withWater: boolean,
    {
      size = 16,
      maps = 1,
      settings: override = {},
    }: { size?: number; maps?: number; settings?: typeof settings } = {},
  ) => {
    const f = frame(withWater, size, override, maps)
    marked.encode(pass, f)
    await pipelinesSettled(device)
    steps.length = 0
    marked.encode(pass, f)
    return steps.filter((step) => FROXEL_STEPS.includes(step))
  }
  const grids = () => fake.buffers.filter((b) => b.label === 'vsm.froxel.grid')
  const localLights = (grid: unknown) => {
    const last = fake.writes.filter((w) => w.buffer === grid).at(-1)!
    const bytes = writtenBytes(last)
    return new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4)[
      MARK_LOCAL_LIGHTS_WORD
    ]
  }
  return { fake, marked, encode, grids, localLights, scene }
}

test('with froxels on and a water depth drawn, the water’s froxel pass is encoded once, after the scene’s, the suns’ pages alone', async () => {
  const m = await marking({ shadowMarkPagesUseFroxels: true })
  assert.deepEqual(await m.encode(false), FROXEL_STEPS, 'the scene alone')
  assert.equal(m.grids().length, 1)
  assert.deepEqual(await m.encode(true), [...FROXEL_STEPS, ...FROXEL_STEPS], 'then the water’s')
  const [sceneGrid, waterGrid] = m.grids()
  assert.equal(m.grids().length, 2, 'a grid and a list of its own')
  assert.equal(m.localLights(sceneGrid), 1, 'the scene marks the local lights')
  assert.equal(m.localLights(waterGrid), 0, 'the water marks the suns alone')
  // The water's build reads the water's depth and the scene's, to keep the pixels the water drew over.
  const group = m.fake.bindGroups.find((g) => g.label === 'vsm.buildWaterFroxels')!
  assert.deepEqual(
    [...group.entries].map((e) => e.binding),
    [0, 1, 2, FROXEL_SCENE_BINDING],
  )
  assert.equal((group.entries as GPUBindGroupEntry[])[FROXEL_SCENE_BINDING]!.resource, m.scene)
})

test('the water’s buffers are held while the marking is from the froxels, drawn water or not', async () => {
  const m = await marking({ shadowMarkPagesUseFroxels: true })
  await m.encode(true)
  const waterGrid = m.grids()[1]!
  assert.deepEqual(await m.encode(false), FROXEL_STEPS, 'an image without water: the scene alone')
  assert.deepEqual(await m.encode(true), [...FROXEL_STEPS, ...FROXEL_STEPS])
  assert.equal(m.grids().length, 2, 'no buffer made again')
  assert.ok(!m.fake.destroyed.includes(waterGrid as never))
})

test('the water’s buffers go with the view’s size, the marking from the froxels and the marking', async () => {
  const gone = (m: Awaited<ReturnType<typeof marking>>, grid: unknown) =>
    m.fake.destroyed.includes(grid as never)
  // A view resized, even by an image without water.
  const resized = await marking({ shadowMarkPagesUseFroxels: true })
  await resized.encode(true)
  const [sceneGrid, waterGrid] = resized.grids()
  await resized.encode(false, { size: 8 })
  assert.ok(gone(resized, sceneGrid) && gone(resized, waterGrid), 'the buffers of the size before')
  assert.equal(resized.grids().length, 3, 'the scene’s made again, the water’s not')
  // The marking no longer from the froxels (here, no page marked at all).
  const off = await marking({ shadowMarkPagesUseFroxels: true })
  await off.encode(true)
  const held = off.grids()
  assert.deepEqual(await off.encode(true, { settings: { shadowMarkPixelPages: false } }), [])
  assert.ok(held.every((grid) => gone(off, grid)))
  // The marking no longer from the froxels, in a frame without a map.
  const empty = await marking({ shadowMarkPagesUseFroxels: true })
  await empty.encode(true)
  const heldEmpty = empty.grids()
  await empty.encode(true, { maps: 0, settings: { shadowMarkPagesUseFroxels: false } })
  assert.ok(heldEmpty.every((grid) => gone(empty, grid)))
  // The marking released.
  const released = await marking({ shadowMarkPagesUseFroxels: true })
  await released.encode(true)
  released.marked.destroy()
  assert.ok(released.grids().every((grid) => gone(released, grid)))
})

test('with no page marked for the view, no froxel kernel runs, whatever water was drawn', async () => {
  const m = await marking({ shadowMarkPixelPages: false, shadowMarkPagesUseFroxels: true })
  assert.deepEqual(await m.encode(true), [])
  assert.equal(m.grids().length, 0, 'no froxel buffer made')
})
