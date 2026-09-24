/**
 * Frontier-count scene: a pyramid of detail levels, as many poses, and the cut
 * hierarchy packing gives them. No host-library dependency — the world matrix
 * comes from the caller — `tests/integration/engine-without-three.test.ts` forbids it here.
 */
import { flatHierarchy } from './hierarchy.ts';
import { CULL_STRIDE, type DagRoot } from './types.ts';

/** A page of level `level`, placed on a grid, with its replacement's error band. */
function page(level: number, i: number, gridSide: number, etendue: number) {
  const rayon = etendue / gridSide;
  const cx = ((i % gridSide) / gridSide - 0.5) * etendue * 2,
    cy = (Math.floor(i / gridSide) / gridSide - 0.5) * etendue * 2;
  const parent = level + 1 < 8 ? 2 ** (level + 1) * 0.01 : null;
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
  };
}

/** `niveaux` detail levels, each half as populated as the previous. */
export function scenePages(feuilles: number, niveaux: number) {
  const pages: ReturnType<typeof page>[] = [];
  for (let level = niveaux - 1; level >= 0; level--) {
    const compte = Math.max(1, feuilles >> level),
      gridSide = Math.ceil(Math.sqrt(compte));
    for (let i = 0; i < compte; i++) pages.push(page(level, i, gridSide, 3));
  }
  return pages;
}

/**
 * Hierarchy the compiler produces (`dag/culling.rs`, `build_culling_bvh`): the root is
 * split into ONE NODE PER DETAIL LEVEL, then each level gets its own spatial hierarchy.
 * Every node under the root therefore carries only one level — that is what decides
 * whether an error-floor reject can hold, a node straddling two levels having as floor
 * that of its finest level. Pages arrive already sorted by level.
 *
 * Renumbering: node `j` of block `k` goes to `1+k` if it is the block root, otherwise
 * behind all those roots. A node's children stay contiguous and behind it, which
 * `cullingBounds` and `hierarchyLevelSizes` both require.
 */
function hierarchieParNiveaux(pages: ReturnType<typeof page>[]) {
  const STRIDE = CULL_STRIDE;
  const tranches: number[][] = [];
  for (let i = 0, debut = 0; i <= pages.length; i++)
    if (i === pages.length || pages[i].level !== pages[debut].level) {
      tranches.push([debut, i]);
      debut = i;
    }
  const blocs = tranches.map(([de, a]) => ({
    arbre: flatHierarchy(pages.slice(de, a)),
    premierePage: de,
  }));
  let total = 1;
  const bases = blocs.map((bloc) => {
    const base = total;
    total += bloc.arbre.nodes.length / STRIDE - 1;
    return base;
  });
  const nodes = new Float64Array((total + blocs.length) * STRIDE);
  const corps = 1 + blocs.length;
  for (let a = 0; a < 3; a++) {
    nodes[a] = Infinity;
    nodes[3 + a] = -Infinity;
  }
  // The root spans every level, the coarsest included, whose clusters nothing replaces:
  // its ceiling certifies nothing, as `flatHierarchy` would say of it.
  nodes[10] = -1;
  nodes[11] = 1;
  nodes[12] = blocs.length;
  for (let k = 0; k < blocs.length; k++) {
    const { arbre, premierePage } = blocs[k];
    const compte = arbre.nodes.length / STRIDE;
    const place = (j: number) => (j === 0 ? 1 + k : corps - 1 + bases[k] + j - 1);
    for (let j = 0; j < compte; j++) {
      const de = j * STRIDE,
        vers = place(j) * STRIDE;
      for (let v = 0; v < STRIDE; v++) nodes[vers + v] = arbre.nodes[de + v];
      nodes[vers + 11] = arbre.nodes[de + 12] ? place(arbre.nodes[de + 11]) : 0;
      nodes[vers + 13] = arbre.nodes[de + 13] + premierePage;
      for (let a = 0; a < 3; a++) {
        if (j === 0 && arbre.nodes[de + a] < nodes[a]) nodes[a] = arbre.nodes[de + a];
        if (j === 0 && arbre.nodes[de + 3 + a] > nodes[3 + a])
          nodes[3 + a] = arbre.nodes[de + 3 + a];
      }
    }
  }
  return { nodes, stride: STRIDE };
}

/** Scene poses. The world matrix comes from the caller: this module does not know the
 *  host library, and the closed list in `tests/integration/engine-without-three.test.ts` forbids it.
 *  Without `parNiveaux` they carry `flatHierarchy`, what packing gives a primitive without a
 *  manifest — the CPU cut, which does not synthesise one, reads it from here too. */
export function sceneRoots(
  pages: ReturnType<typeof page>[],
  mondes: DagRoot['world'][],
  parNiveaux = false,
): DagRoot[] {
  const culling = parNiveaux ? hierarchieParNiveaux(pages) : flatHierarchy(pages);
  return mondes.map((world) => ({ world, pages: pages as DagRoot['pages'], culling }));
}
