import { createWebgpuCutAdopter } from './adoption.ts'
import { createCutDelta } from './delta.ts'
import {
  createSelectionUniforms,
  type GpuCut,
  type GpuSelection,
  type SelectionUniforms,
} from '../../gpu/core/selection.ts'
import type { PageRec } from '../../page/selection/selection.ts'
import type { PageList } from '../pages/prepare/catalogue.ts'

/** Uniform block of a bench: the engine's, so a field added to the contract arrives here
 *  without being copied in. Never compared to anything but itself or its copy. */
export const fixtureUniforms = createSelectionUniforms

/** A catalogue of `count` clusters, one per rank, all with their bytes. */
export function fixturePages(count: number, transparent: (index: number) => boolean = () => false) {
  return Array.from(
    { length: count },
    (_, i) =>
      ({
        url: `p${i}`,
        triangles: i + 1,
        transparent: transparent(i),
        array: new Uint32Array(3),
      }) as unknown as PageRec,
  )
}

/** A selection that only knows how to return the current readback, whose readbacks claim no
 *  rank: all an adopter asks of it. */
export const peekOnly = (peek: () => GpuCut | null) =>
  ({ peek, adopt: () => undefined }) as unknown as GpuSelection

/** Triangle totals of a readback header, as `dagMask` ships them: all zero unless given. */
export const fixtureTotals = (totals: Partial<GpuCut['result']> = {}) => ({
  selectedTriangles: 0,
  drawnTriangles: 0,
  transparentTriangles: 0,
  ...totals,
})

/**
 * The adopter wired as the engine wires it (`publication.ts`): a difference for the
 * requested cut and another for the drawable cut. Four benches used to mount it by hand, and the
 * same wiring copied four times pins nothing more than this one.
 */
export function mountCutAdopter(options: {
  packedPages: PageList
  uniforms: SelectionUniforms
  selection: () => GpuSelection | undefined
  onDrawnMirrored?: () => void
  onAhead?: (ids: readonly number[]) => void
}) {
  const { packedPages } = options
  const desired: PageRec[] = [],
    shown: PageRec[] = [],
    drawn: PageRec[] = []
  // The packed ranks of the lists, rank by rank (#1235): one record may serve several placements.
  const desiredPacked: number[] = [],
    shownPacked: number[] = [],
    drawnPacked: number[] = []
  const drawnPages: PageRec[] = []
  const drawnDelta = createCutDelta(packedPages, drawnPages),
    delta = createCutDelta(packedPages, desired)
  const adopter = createWebgpuCutAdopter({
    selection: options.selection,
    desired,
    desiredPacked,
    shown,
    shownPacked,
    drawn,
    drawnPacked,
    uniforms: options.uniforms,
    delta,
    drawnDelta,
    drawnPages,
    onCutDelta: () => {},
    onDrawnDelta: () => {},
    onDrawnMirrored: options.onDrawnMirrored ?? (() => {}),
    onAhead: options.onAhead ?? (() => {}),
  })
  return {
    adopter,
    delta,
    drawnDelta,
    drawnPages,
    desired,
    desiredPacked,
    shown,
    shownPacked,
    drawn,
    drawnPacked,
  }
}
