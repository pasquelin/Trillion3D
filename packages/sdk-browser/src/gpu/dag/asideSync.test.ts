// A view aside cut alone reads the tables as the main view's cut would: what moved since the last
// cut — a placement parked, a cell placed — reaches them before it encodes (`runtime.ts`,
// `syncTables`). On a generated field of 400 placements under its tree, and on the generated world
// of three cells of four objects beside twelve placements. A view aside made where another was
// released takes the world's fade from its own first cut.
import test from 'node:test'
import assert from 'node:assert/strict'
import { packDagSelection } from './pack.ts'
import { createDagResources } from './resources.ts'
import { createDagRuntime } from './runtime.ts'
import { placementField } from './placementTree.fixture.ts'
import { ruleDag } from '../../page/cut/cutRule.fixture.ts'
import { worldDag } from '../../scene/worldSuperRoots.fixture.ts'
import { createSelectionUniforms } from '../core/selection.ts'
import { worldFadeScale } from './worldFade.ts'
import { mockGpu } from '../../../../../tests/kit/gpu/mockGpu.ts'
import { DAG_NODE_FLOATS, type DagRoot } from './types.ts'

/** The followed selection over `roots`, its view aside made and its regions asked by one main
 *  image; `side`: one image of the view aside alone. */
async function asideOver(roots: DagRoot[]) {
  const packed = packDagSelection(roots),
    gpu = mockGpu({ packed })
  const resources = (await createDagResources(gpu.device, packed))!
  const selection = createDagRuntime(resources)
  const aside = selection.aside()
  const uniforms = { ...createSelectionUniforms(), pixelError: 1 }
  selection.dispatch(uniforms)
  await selection.flush()
  /** One image of `view` aside alone, its eye `x` metres along. */
  const image = async (view: typeof aside, x = 0) => {
    const encoder = gpu.device.createCommandEncoder()
    const cameraWorld: [number, number, number] = [x, 0, 0]
    view.dispatch({ ...uniforms, cameraWorld, pixelError: 2 }, encoder)?.(true)
    gpu.device.queue.submit([encoder.finish()])
    await view.flush()
  }
  const side = () => image(aside)
  /** The bytes the GPU holds of `buffer`. */
  const held = (buffer: GPUBuffer) => (buffer as unknown as { data: Uint8Array }).data
  return { packed, resources, selection, side, image, held }
}

const bytes = (view: ArrayBufferView, from = 0, to = view.byteLength) =>
  new Uint8Array(view.buffer, view.byteOffset + from, to - from)

test('a view aside cut alone reads the tree refitted and the root word of a parked placement', async () => {
  const roots = placementField(20, 6)
  const { packed, resources, selection, side, held } = await asideOver(roots)
  const tree = packed.placementTree!
  // The field's far corner moved a kilometre on: its group's box and the boxes above it grow.
  const before = packed.nodes.slice(),
    next = packed.worlds.slice()
  ;(roots[399].world.elements as Float64Array)[12] += 1000
  next[399 * 16 + 12] += 1000
  selection.updateWorlds(next, Int32Array.of(399))
  selection.parkWorld(5, true)
  await side()
  const nodes = held(resources.nodeParts.buffers[0])
  const from = tree.cellBase * packed.nodes.BYTES_PER_ELEMENT * DAG_NODE_FLOATS
  assert.notDeepEqual(bytes(packed.nodes, from), bytes(before, from), 'the refit moved nodes')
  assert.deepEqual(nodes.subarray(from, packed.nodes.byteLength), bytes(packed.nodes, from))
  const frames = held(resources.frames.buffers[0]),
    rows = bytes(
      resources.frameData,
      0,
      Math.min(frames.byteLength, resources.frameData.byteLength),
    )
  assert.deepEqual(frames.subarray(0, rows.byteLength), rows, 'the parked root word sent')
})

test('a view aside cut alone reads the links of a cell placed since', async () => {
  const world = worldDag(),
    manifest = ruleDag(8) as unknown as DagRoot
  const roots = [...Array.from({ length: 12 }, () => manifest), world as never]
  const { packed, resources, selection, side, held } = await asideOver(roots)
  for (let o = 4; o < 8; o++) selection.placeObject(o, o)
  await side()
  const { links, linkBase } = packed.world!
  const cold = new Uint32Array(held(resources.coldParts.buffers[0]).buffer)
  for (let w = 4; w < 8; w++) assert.equal(cold[linkBase + w], links[w], `placement ${w}`)
})

test('a view aside made after another is released counts its own camera from its first cut', async () => {
  const world = worldDag(),
    manifest = ruleDag(8) as unknown as DagRoot
  const roots = [...Array.from({ length: 12 }, () => manifest), world as never]
  const { packed, selection, image } = await asideOver(roots)
  const cut = async (aside: ReturnType<typeof selection.aside>, x: number) => {
    await image(aside, x)
    return packed.world!.scale
  }
  const first = selection.aside()
  for (const x of [5, 6, 7]) await cut(first, x)
  first.dispose()
  // The next view takes the released one's token, at the camera it last cut under.
  assert.equal(await cut(selection.aside(), 7), worldFadeScale(1), 'its first cut, its first move')
})
