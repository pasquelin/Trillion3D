// One DAG across the world and its objects (#1333): twelve placements of one object DAG, each posed
// in world space, and the world DAG the cook builds over their roots — each object's roots ranked in
// the cook's own order (reversed here: not the page order), continued per cell into one super-root
// and the cells into one top. Every page knows the leaf units it covers, so a coverage check reads
// both DAGs at once.
import { ruleDag } from '../../page/cut/cutRule.fixture.ts';
import { worldRootDag } from '../../scene/worldSuperRoots.ts';
import { worldRootPages } from '../../scene/worldPageServe.ts';
import type { WorldRootsCluster } from '../../../../sdk-core/src/manifest/worldRoots.ts';
import type { ClusterGroup } from '../../../../sdk-core/src/index.ts';
import type { PackedDag } from './types.ts';

export const CELLS = 3,
  PER_CELL = 4,
  OBJECTS = CELLS * PER_CELL,
  /** An object's scale in the world: its four leaf units span one world unit. */
  SCALE = 0.25;

type Cooked = WorldRootsCluster & { units: [number, number] };

/** Object `o`'s world matrix: scaled by `SCALE`, its first leaf at `x = o`. */
export const objectPose = (o: number) =>
  Float64Array.of(SCALE, 0, 0, 0, 0, SCALE, 0, 0, 0, 0, SCALE, 0, o, 0, 0, 1);

export function linkedWorld() {
  const object = ruleDag(4),
    span = object.leaves,
    [e1, e2] = [0.05, 0.5];
  const clusters: Cooked[] = [],
    groups: ClusterGroup[] = [];
  const cellSphere = (cell: number) => [cell * PER_CELL + 2, 0, 0, 2.2],
    topSphere = [OBJECTS / 2, 0, 0, OBJECTS / 2 + 0.2];
  const cluster = (fields: Partial<Cooked> & Pick<Cooked, 'units' | 'level'>): Cooked => ({
    cluster: clusters.length,
    lodError: 0,
    sphere: [0, 0, 0, 0],
    parentError: null,
    parentSphere: null,
    min: [fields.units[0] / span, -0.1, -0.1],
    max: [fields.units[1] / span, 0.1, 0.1],
    triangles: 2 * (fields.units[1] - fields.units[0]),
    material: null,
    bundle: null,
    offset: null,
    origin: null,
    ...fields,
  });
  for (let o = 0; o < OBJECTS; o++)
    for (const root of [...object.structure.roots].reverse()) {
      const page = object.pages[root],
        [a, b] = page.units;
      clusters.push(
        cluster({
          level: 0,
          lodError: page.lodError * SCALE,
          sphere: [o + page.sphere[0] * SCALE, 0, 0, page.sphere[3] * SCALE],
          parentError: e1,
          parentSphere: cellSphere(Math.floor(o / PER_CELL)),
          origin: o,
          units: [o * span + a, o * span + b],
        }),
      );
    }
  const perCell = PER_CELL * object.structure.roots.length;
  for (let cell = 0; cell < CELLS; cell++) {
    const first = cell * PER_CELL * span;
    groups.push({
      level: 1,
      error: e1,
      sphere: cellSphere(cell),
      children: Array.from({ length: perCell }, (_, i) => cell * perCell + i),
      outputs: [clusters.length],
    });
    clusters.push(
      cluster({
        level: 1,
        lodError: e1,
        sphere: cellSphere(cell),
        parentError: e2,
        parentSphere: topSphere,
        bundle: cell + 1,
        offset: 0,
        units: [first, first + PER_CELL * span],
      }),
    );
  }
  const superRoots = Array.from({ length: CELLS }, (_, cell) => CELLS * perCell + cell);
  groups.push({
    level: 2,
    error: e2,
    sphere: topSphere,
    children: superRoots,
    outputs: [clusters.length],
  });
  clusters.push(
    cluster({
      level: 2,
      lodError: e2,
      sphere: topSphere,
      bundle: 0,
      offset: 0,
      units: [0, OBJECTS * span],
    }),
  );
  const world = worldRootDag(
    { clusters, groups, payload: { url: 'world-roots.bin' } },
    worldRootPages,
  )!;
  return { object, world, superRoots, top: clusters.length - 1, leaves: OBJECTS * span };
}
export type LinkedWorld = ReturnType<typeof linkedWorld>;

/** The leaf units packed page `page` of `packed` covers: an object's own page, or a world one. */
export function unitsOf({ object, world }: LinkedWorld, packed: PackedDag, page: number) {
  const worldBase = packed.cutLinks[OBJECTS].pageBase;
  if (page >= worldBase) return (world.pages[page - worldBase] as unknown as Cooked).units;
  const o = Math.floor(page / object.pages.length),
    [a, b] = object.pages[page - o * object.pages.length].units;
  return [o * object.leaves + a, o * object.leaves + b];
}
