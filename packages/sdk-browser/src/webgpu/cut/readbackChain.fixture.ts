// A resident cut adopted two ways at once: by the engine's adopter, which follows the changes the
// GPU took against the list held (`../../gpu/dag/differenceChain.ts`, `./netDifference.ts`), and
// by the hashed difference beside it, the oracle, handed every list the adopted readback carries.
// Every adoption compares the sets, records and changes the two publish — the engine's list is the
// cut as a set, in no order —, and counts the catalogue lookups the engine took.
import assert from 'node:assert/strict'
import type { PageRec } from '../../page/selection/selection.ts'
import { createSelectionUniforms } from '../../gpu/core/selection.ts'
import { differenceRig, type RigCut } from '../../gpu/dag/differenceRig.fixture.ts'
import { createCutDelta, type CutDelta } from './delta.ts'
import { mountCutAdopter } from './adopter.fixture.ts'

/** Every readback in flight lands, every growth queued is made. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

export const range = (from: number, to: number) =>
  Array.from({ length: to - from }, (_, i) => from + i)

const idOf = (page: PageRec) => (page as unknown as { id: number }).id

/** Records for ids below `size`, and a catalogue over them that counts its lookups. */
function countedCatalogue(size: number) {
  const records = Array.from(
    { length: size },
    (_, id) => ({ id, url: `p${id}` }) as unknown as PageRec,
  )
  const counted = {
    lookups: 0,
    length: size,
    recordOf: (id: number) => (counted.lookups++, records[id]),
  }
  return { records, counted }
}

const sorted = (ids: ArrayLike<number>, count = ids.length) =>
  Array.from(ids)
    .slice(0, count)
    .sort((a, b) => a - b)

/** What a delta publishes as a set, its records by id, membership over ids below `ids`. */
function published(delta: CutDelta, pages: PageRec[], ids: number) {
  return {
    entered: sorted(delta.entered, delta.enteredCount),
    exited: sorted(delta.exited, delta.exitedCount),
    ids: sorted(delta.ids, delta.count),
    count: delta.count,
    pages: sorted(pages.map(idOf)),
    held: range(0, ids).filter(delta.has),
  }
}

/** `oracle` handed every list `delta` applies or holds; a list it follows by its changes, the list
 *  `list()` says the adopted readback carries. */
function shadow(delta: CutDelta, oracle: CutDelta, list: () => ArrayLike<number>) {
  const { apply, applyNet, hold } = delta
  delta.apply = (ids, count) => (oracle.apply(ids, count), apply(ids, count))
  delta.applyNet = (changes) => (oracle.apply(list()), applyNet(changes))
  delta.hold = () => (oracle.hold(), hold())
}

/** A cut on a list of `cap` ranks over a catalogue of `catalogue` records: fewer than the pages a
 *  cut names leaves some without a record. */
export async function mountReadbackChain(cap: number, catalogue: number) {
  const rig = await differenceRig(cap),
    { records, counted } = countedCatalogue(catalogue)
  const engine = mountCutAdopter({
    packedPages: counted,
    uniforms: createSelectionUniforms(),
    selection: () => rig.selection,
  })
  const desired: PageRec[] = [],
    drawn: PageRec[] = []
  const hashed = { asked: createCutDelta(records, desired), drawn: createCutDelta(records, drawn) }
  const inHand = () => rig.selection.peek()!.result
  shadow(engine.delta, hashed.asked, () => inHand().pageIds)
  shadow(engine.drawnDelta, hashed.drawn, () => inHand().drawablePageIds ?? [])
  const uniforms = createSelectionUniforms(),
    span = rig.pageCount
  let frame = 0
  return {
    rig,
    /** A cut of `cut`, sent: it lands at the next settle. */
    send(cut: RigCut, shared?: GPUCommandEncoder) {
      rig.cutNext(cut)
      uniforms.pixelError = ++frame
      return rig.selection.dispatch(uniforms, shared)
    },
    /** The host holds `ids` of its own, as the bootstrap does. */
    hold: (ids: number[]) => engine.delta.apply(ids),
    /** The readback in hand adopted both ways, compared; the catalogue lookups it took. */
    adopt() {
      const before = counted.lookups
      engine.adopter.adopt()
      const taken = counted.lookups - before
      assert.deepEqual(
        published(engine.delta, engine.desired, span),
        published(hashed.asked, desired, span),
      )
      assert.deepEqual(
        published(engine.drawnDelta, engine.drawnPages, span),
        published(hashed.drawn, drawn, span),
      )
      return taken
    },
  }
}
