/**
 * THE CELLS A PARTITION HOLDS BY THEIR SUPER-ROOTS ALONE (#1332).
 *
 * As World Partition's streaming policy does each update, a frame's plan (`plan.ts`) chooses each
 * cell's state from the source's real data: placed, its objects read and drawn, or held far, drawn
 * by its super-roots — the world bundles its objects' roots need held (`../worldRoots.ts`), its
 * object pages unread. That choice is the cut's, on the cut's own lens (`superRoots.ts`), and only
 * once the cut packs the world DAG (`GpuSelection.packsWorld`, #1333): until then no cell is ever
 * held far, since nothing would draw its super-roots, and the plan is the one it always was.
 *
 * The super-roots' bound per cell comes from the world stream (`WorldRootsHold.stream`), opened
 * here on the first frame whose cut packs the world DAG: a load never reads the DAG file (#1232).
 * A far cell's bundles are held as a placed cell's are (`createCellPages`), counted once per cell,
 * and the cut that packs the world DAG is told the bundles held, its super-roots' residency (#1333).
 */
import type { WorldRootsHold } from '../worldRoots.ts';
import { createCellPages } from './cellPages.ts';
import { planCells, type SuperRootPlan } from './plan.ts';
import { cellSuperRootError, type SuperRootLens } from './superRoots.ts';

/** The world bundles a cell holds, the stream its super-roots' bound is read from, and the table
 *  and bundles held the cut reads (#1333). */
type World = Pick<WorldRootsHold, 'hold' | 'release'> &
  Partial<Pick<WorldRootsHold, 'stream' | 'table' | 'pinned' | 'held' | 'revision'>>;
/** The cut's side of a frame: its lens while it packs the world DAG, and where it takes the world
 *  bundles held, true once taken (`BackendSceneUpdates.holdWorldBundles`). */
export type FarCut = {
  lens?: SuperRootLens;
  holdWorldBundles?(pinned: number, held: readonly number[]): boolean;
};

/** The far cells of a partition whose placed cells are `placed`, their bundles held on `world`. */
export function createFarCells(world: World | undefined, placed: ReadonlyMap<number, unknown>) {
  const far = new Set<number>();
  const holds = createCellPages(undefined, () => [], world);
  /** Each cell's super-root bound, once the world stream opened; whether it is opening. */
  let bounds: Float64Array | undefined,
    opening = false,
    /** The bundles' revision the cut took, -1 when none. */
    told = -1;
  /** Placed or held far: every cell the plan holds. */
  const held = {
    has: (cell: number) => placed.has(cell) || far.has(cell),
    *keys() {
      yield* placed.keys();
      yield* far;
    },
  };
  /** `cell`'s far hold is let go, once placed or past the keep sphere; whether it had one. */
  const release = (cell: number) => {
    if (!far.delete(cell)) return false;
    holds.release(cell);
    return true;
  };
  /** The bundles held go to `cut` while it packs the world DAG, once per change. */
  const tell = ({ lens, holdWorldBundles }: FarCut) => {
    if (!lens || !world?.pinned || !world.held) told = -1;
    else if (told !== world.revision && holdWorldBundles?.(world.pinned.bundles, world.held()))
      told = world.revision!;
  };
  /** The plan's reading of the super-roots from `eye` through the cut's `lens`, or none: no cut
   *  packs the world DAG, or its bound is not read yet (asked here, once; a refusal asks again). */
  const superRoots = (eye: ArrayLike<number>, lens?: SuperRootLens): SuperRootPlan | undefined => {
    if (!lens || !world?.stream) return undefined;
    if (!bounds && !opening) {
      opening = true;
      world.stream().then(
        (stream) => void (bounds = stream.superRoots),
        () => void (opening = false),
      );
    }
    const read = bounds;
    if (!read) return undefined;
    const projected = (cell: number) => cellSuperRootError(read, cell, eye, lens);
    return { placed, target: lens.pixelError, projected };
  };
  return {
    /**
     * The frame's plan (`planCells`) from `eye` (world space), in the cells' frame `local`, through
     * the `cut`'s lens while it packs the world DAG: the cells found far are held by their
     * super-roots, and those `demoted` give their objects back (`leave`) and are held far; the
     * bundles held then go to the cut. Without its lens, the plan of placed cells alone.
     */
    plan(
      index: Parameters<typeof planCells>[0],
      local: { eye: ArrayLike<number>; reach: number },
      eye: ArrayLike<number>,
      cut: FarCut,
      leave: (cell: number) => void,
    ) {
      const reading = superRoots(eye, cut.lens);
      // A cell placed since draws its objects; and a cut that no longer packs the world DAG draws
      // no super-root: neither stays held far.
      for (const cell of far) if (!reading || placed.has(cell)) release(cell);
      const plan = planCells(index, local.eye, local.reach, reading ? held : placed, reading);
      for (const cell of plan.far) {
        far.add(cell);
        holds.hold(cell);
      }
      // A demoted cell's far hold is taken before its placed hold goes: the world bundles both
      // need stay held, never read again.
      for (const cell of plan.demoted) {
        holds.hold(cell);
        leave(cell);
        far.add(cell);
      }
      // A hold that failed is asked again here, its cell still held far.
      if (reading) void holds.reads();
      tell(cut);
      return plan;
    },
    release,
  };
}
