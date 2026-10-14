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
import type { RootsOnGpu } from './runtimeOps.ts'
import { placementField } from './placementTree.fixture.ts'
import { ruleDag } from '../../page/cut/cutRule.fixture.ts'
import { worldDag } from '../../scene/worldSuperRoots.fixture.ts'
import { createSelectionUniforms } from '../core/selection.ts'
import { worldFadeScale } from './worldFade.ts'
import { BACKEND } from '../../../../../tests/kit/gpu/fakeRecords.ts'
import { fakeDevice } from '../../../../../tests/kit/gpu/fakeDevice.ts'
import type { DagRoot } from './types.ts'
import { hostStretches } from './hostStretches.fixture.ts'

/** The followed selection over `roots`, its view aside made and its regions asked by one main
 *  image; `side`: one image of the view aside alone. Its tree's leaves are the GPU's one writer's
 *  (`../../placement/treeLeaves.ts`), here one that records the placements each fit names. */
async function asideOver(roots: DagRoot[]) {
  const packed = packDagSelection(roots),
    gpu = fakeDevice({ ...BACKEND, packed })
  const named: number[][] = []
  const onGpu: RootsOnGpu = {
    roots: hostStretches(packed).roots,
    leaves: {
      ready: () => true,
      encode: (_encoder, _tables, { ranks, count }) =>
        void named.push(Array.from(ranks.subarray(0, count))),
    },
  }
  const resources = (await createDagResources(gpu.device, packed))!
  const selection = createDagRuntime(resources, undefined, onGpu)
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
  return { packed, resources, selection, side, image, gpu, named }
}

const bytes = (view: ArrayBufferView, from = 0, to = view.byteLength) =>
  new Uint8Array(view.buffer, view.byteOffset + from, to - from)

test('a view aside cut alone reads the tree refitted and the root word of a parked placement', async () => {
  const roots = placementField(20, 6)
  const { packed, resources, selection, side, gpu, named } = await asideOver(roots)
  // The field's far corner moved a kilometre on: its leaf is named to the GPU's writer of leaves,
  // and the GPU refit of its group and the nodes above it is encoded in the aside cut's own command
  // buffer.
  const next = packed.worlds.slice()
  ;(roots[399].world.elements as Float64Array)[12] += 1000
  next[399 * 16 + 12] += 1000
  selection.updateWorlds(next, Int32Array.of(399))
  selection.parkWorld(5, true)
  const sent = named.length,
    refits = () =>
      gpu.commands.filter((c) => c === 'compute Trillion3D placement tree refit').length
  await side()
  assert.ok(
    named.slice(sent).some((ranks) => ranks.includes(399)),
    'the moved placement’s leaf written',
  )
  assert.ok(refits() > 0, 'the tree refit pass encoded')
  // The frame words' first row of records holds the field's 400 placements, as the host laid them.
  const words = (resources.frames.rows.texture as unknown as { words: Uint32Array }).words,
    rows = bytes(resources.frameData)
  assert.deepEqual(bytes(words, 0, rows.byteLength), rows, 'the parked root word sent')
})

test('a view aside cut alone reads the links of a cell placed since', async () => {
  const world = worldDag(),
    manifest = ruleDag(8) as unknown as DagRoot
  const roots = [...Array.from({ length: 12 }, () => manifest), world as never]
  const { packed, resources, selection, side } = await asideOver(roots)
  for (let o = 4; o < 8; o++) selection.placeObject(o, o)
  await side()
  const { links, linkBase } = packed.world!
  // The cold words, one a record, laid as the packing laid them (`cutTables.ts`).
  const cold = (resources.cutTables.cold.texture as unknown as { words: Uint32Array }).words
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
