/**
 * Frontier-count scene: a pyramid of detail levels, as many poses, and the cut
 * hierarchy packing gives them. No host-library dependency — the world matrix
 * comes from the caller — `tests/integration/engine-without-three.test.ts` forbids it here.
 */
import { cullingInPlace } from './culling.fixture.ts'
import type { DagRoot } from './types.ts'

/** A page of level `level`, placed on a grid, with its replacement's error band. */
function page(level: number, i: number, gridSide: number, extent: number) {
  const rayon = extent / gridSide
  const cx = ((i % gridSide) / gridSide - 0.5) * extent * 2,
    cy = (Math.floor(i / gridSide) / gridSide - 0.5) * extent * 2
  const parent = level + 1 < 8 ? 2 ** (level + 1) * 0.01 : null
  return {
    url: `n${level}-${i}`,
    level,
    // A VARIABLE triangle count per cluster: frame totals accumulate it, and a scene that
    // left them all equal — or all zero — would make GPU and oracle agree on nothing.
    // The formula depends only on rank and level, so the scene stays reproducible.
    triangles: 64 + ((i * 7 + level * 13) % 129),
    min: [cx - rayon, cy - rayon, -rayon],
    max: [cx + rayon, cy + rayon, rayon],
    sphere: [cx, cy, 0, rayon],
    lodError: 2 ** level * 0.01,
    parentError: parent,
    parentSphere: parent === null ? null : [cx, cy, 0, rayon * 2],
  }
}

/** `levels` detail levels, each half as populated as the previous. */
export function scenePages(feuilles: number, levels: number) {
  const pages: ReturnType<typeof page>[] = []
  for (let level = levels - 1; level >= 0; level--) {
    const count = Math.max(1, feuilles >> level),
      gridSide = Math.ceil(Math.sqrt(count))
    for (let i = 0; i < count; i++) pages.push(page(level, i, gridSide, 3))
  }
  return pages
}

/** Scene poses. The world matrix comes from the caller: this module does not know the
 *  witness library, and the closed list in `tests/integration/engine-without-three.test.ts` forbids it.
 *  They carry the hierarchy the compiler gives (`cullingInPlace`): the root split into one node per
 *  detail level, each level its own spatial tree; `pages` are ranked in its order, in place, so the
 *  CPU cut, which reads the same array, reads the same ranks. */
export function sceneRoots(
  pages: ReturnType<typeof page>[],
  worlds: DagRoot['world'][],
): DagRoot[] {
  const culling = cullingInPlace(pages)
  return worlds.map((world) => ({ world, pages: pages as DagRoot['pages'], culling }))
}
