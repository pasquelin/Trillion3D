import type { SelectionUniforms } from '../../../gpu/core/selection.ts'
import { sameSelectionUniforms } from '../../../gpu/core/selectionCopy.ts'
import { twoPassOf } from '../shader/occlusionWgsl.ts'
import { sameValues } from '../../../../../math/src/matrix/matrixElements.ts'

/** The main view's token; a view drawn aside takes its own (`takeAsideView`). */
export const MAIN_VIEW = 1

/** What a cut or a readback was made under: its uniforms, the residency and the poses. */
export type CutStamp = {
  uniforms: SelectionUniforms
  residency: number
  world: number
}

/** A view's last cut on the shared tables: its inputs and its serial. */
type ViewCut = CutStamp & { serial: number }

/**
 * WHOSE CUT THE SHARED TABLES HOLD. A cut draws a frame's image in the command buffer that cuts it:
 * its visible clusters are decoded, binned and rastered behind it (`../visible/layout.ts`), and the
 * next cut, the same view's or another's, writes them anew — no cut stands across frames, none is
 * brought back. What a view that cuts after another overwrites is the readout, `out`: its lists
 * are `outOwner`'s, which a copy reads, `serial` counting every cut the tables ran so that a copy is
 * believed for the one cut it came from. `cuts` is each view's last cut, `alive` the views aside
 * in use, by token.
 */
export type CutOwner = {
  outOwner: number
  serial: number
  cuts: (ViewCut | undefined)[]
  alive: boolean[]
}

export const createCutOwner = (): CutOwner => ({
  outOwner: 0,
  serial: 0,
  cuts: [],
  alive: [true],
})

/** A token for a view drawn aside: the lowest no view alive holds. */
export function takeAsideView(owner: CutOwner) {
  let region = 1
  while (owner.alive[region]) region++
  owner.alive[region] = true
  return region + 1
}

/** `view` is released: its token is free for the next view aside, its cut believed no more. */
export function releaseAsideView(owner: CutOwner, view: number) {
  const region = view - 1
  owner.alive[region] = false
  owner.cuts[region] = undefined
  if (owner.outOwner === view) owner.outOwner = 0
}

/** True when `stamp` was made under `uniforms`, the residency and the poses in place: the view, and
 *  the render matrix and size its boxes' pixel centres were found with — a jittered image moves it
 *  every frame. A cut whose occlusion runs two passes read the pyramid of the image before it,
 *  which every image builds anew: it stands for its own frame alone. */
export function stampMatches(
  stamp: CutStamp | undefined,
  uniforms: SelectionUniforms,
  state: { residencyRevision: number; worldRevision: number },
) {
  if (!stamp || stamp.residency !== state.residencyRevision) return false
  const made = stamp.uniforms
  return (
    stamp.world === state.worldRevision &&
    sameSelectionUniforms(made, uniforms) &&
    sameValues(made.planes, uniforms.planes) &&
    sameValues(made.viewProj, uniforms.viewProj) &&
    sameValues(made.depthMap, uniforms.depthMap) &&
    sameValues(made.viewSize, uniforms.viewSize) &&
    (made.occlusion ?? 0) === (uniforms.occlusion ?? 0) &&
    (!twoPassOf(uniforms) || made.frame === uniforms.frame)
  )
}

/** True when `view`'s last cut was made under `uniforms`, the residency and the poses in place:
 *  cut again, it would be the same cut. */
export const sameCut = (
  owner: CutOwner,
  view: number,
  uniforms: SelectionUniforms,
  state: { residencyRevision: number; worldRevision: number },
) => stampMatches(owner.cuts[view - 1], uniforms, state)

/** `view` cuts the tables under `cut`'s inputs: its cut is the next serial, and holds `out`. */
export function noteCut(owner: CutOwner, view: number, cut: CutStamp) {
  owner.outOwner = view
  owner.cuts[view - 1] = { ...cut, serial: ++owner.serial }
  return owner.serial
}

/**
 * What one dispatch for `view` may change of the owner — whose cut `out` holds, the serial, `view`'s
 * last cut (`noteCut`) — held as the few values it is and given back by the returned function when
 * the command buffer is dropped: a cut that never ran is not remembered as run (the main view's
 * `../dispatch.ts`, a view's aside `../aside.ts`).
 */
export function holdOwner(owner: CutOwner, view: number) {
  const { outOwner, serial } = owner,
    viewCut = owner.cuts[view - 1]
  return () => {
    owner.outOwner = outOwner
    owner.serial = serial
    owner.cuts[view - 1] = viewCut
    // A view's first cut grew the list by its slot: the slot goes with it.
    if (viewCut === undefined && owner.cuts.length === view) owner.cuts.length = view - 1
  }
}
