/**
 * The pages of a primitive whose material moved into or out of blended in the session (#846).
 * The compiler cuts a blended primitive on finer grids than an opaque or masked one (#875), so
 * the pages a session opened for one class are not the ones it writes for the other. Such a
 * primitive is cut again by the runtime cutter (`runtimeCut.ts`), off the main thread, from the
 * source vertices its pages were cut from — and the vertices a seam-locked solve placed, from the
 * pages naming them (`placedVertices.ts`, #877) —, on its own clusters — each page's corners, read
 * from its index page — and on the grids the compiler gives the new class (`Recut`); its resident
 * records then draw the new pages, and every page it reads later too (`PageRec.recut`). Moved
 * back to the class it was compiled for, it draws the pages it reads again. Until a cut lands,
 * the records draw their old pages in their new family; `settled` resolves once every cut has.
 */
import type { Primitive } from '../../../../sdk-core/src/index.ts';
import { drawnTriangles } from '../../../../sdk-core/src/world/geometry/drawn.ts';
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { FLAG_COLOR, FLAG_NORMAL, FLAG_UV, FLAG_UV1 } from '../../cluster/format.ts';
import { sendEngineDiagnostic } from '../../diagnostic/engineDiagnostic.ts';
import { pagedGeometry } from '../../host/prepared/pagedSource.ts';
import type { HostMesh } from '../../host/resources.ts';
import { cutPagesOffThread } from '../../page/decode/host.ts';
import { rootOf, type ClusterRoot, type PageRec } from '../../page/selection/selection.ts';
import { blendMoves, type AlphaChange } from '../../placement/backendSceneUpdates.ts';
import { primitiveFinder } from '../../scene/primitiveLookup.ts';
import { joinedCorners, withPlaced } from '../../world/page/placedVertices.ts';
import { packDrawn } from '../../world/page/runtimeCut.ts';
import type { BackendContext } from '../types.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import { readPages } from './manifest.ts';
import type { PageDraws } from './pageDraws.ts';

type ClassPagesEnvironment = {
  context: BackendContext;
  /** The roots a record's `placementIndex` ranks: its world is its root's. */
  roots: readonly ClusterRoot<PageRec>[];
  /** The per-instance draw state: the last class change an instance followed is `turn` there. */
  draws: PageDraws;
  geometryStore: ReturnType<typeof createAutonomousGeometry>;
  /** Whether `alpha` moves the surface a record wears (`collect.ts`). */
  wears: (rec: PageRec, alpha: AlphaChange) => boolean;
  /** Told the pages drawn changed: the next frame is drawn, not held. */
  gate: { resourcesChanged(): void };
};

/** The finest error the primitive's DAG published, which sets its grid with its extent; 0 for a
 *  primitive with no group. */
const finestError = (primitive: Primitive) =>
  primitive.pages.reduce(
    (finest, page) =>
      (page.level ?? 0) > 0 && (page.lodError ?? 0) > 0
        ? Math.min(finest || Infinity, page.lodError!)
        : finest,
    0,
  );

/** Whether the class `blended` is the one the compiler cut `primitive` for. */
const ownClass = (primitive: Primitive, blended: boolean) =>
  blended === (primitive.pass === 'clustered-blend');

/** The largest world scale that places the records: the compiler's tile follows it, read over
 *  every placement of the primitive (`mesh_scales`), not only those a change moves. */
const largestScale = (
  records: readonly PageRec[],
  roots: readonly ClusterRoot<PageRec>[],
  rankOf: (rec: PageRec) => number,
  scratch = new Matrix4(),
) =>
  records.reduce((scale, rec) => {
    // A per-primitive property: any placement of the record serves, so its first instance's root.
    const { elements } = rootOf(roots, rankOf(rec)).world;
    return Math.max(scale, scratch.fromArray(elements).getMaxScaleOnAxis());
  }, 0);

export function createClassPages(env: ClassPagesEnvironment) {
  const { context, draws, geometryStore } = env;
  const primitiveOf = primitiveFinder(context.metadata.primitives);
  /** The compiled primitive a record draws a page of: none for a resource mounted later, which
   *  the open's manifest does not list. */
  const compiledOf = (rec: PageRec) => {
    const primitive = rec.sourceMesh && primitiveOf(context.associations.get(rec.sourceMesh));
    return primitive && primitive.pages[rec.id]?.geometry?.url === rec.url ? primitive : undefined;
  };
  /** The records whose class `alpha` moves into or out of blended, whatever family draws them. */
  const moved = (alpha: AlphaChange, records: readonly PageRec[]) =>
    blendMoves(alpha) ? records.filter((rec) => env.wears(rec, alpha)) : [];
  let turn = 0,
    pending: Promise<unknown> = Promise.resolve();

  /** The pages of `primitive` for the class `blended`, by page id, cut from the source `moved`
   *  records draw, on the tile of `placed`, its every placement; null for the class it was
   *  compiled for, whose pages it reads. */
  async function pagesFor(
    primitive: Primitive,
    blended: boolean,
    moved: readonly PageRec[],
    placed: readonly PageRec[],
  ) {
    if (ownClass(primitive, blended)) return null;
    // Read before the first wait: the cut holds no placement.
    const mesh = moved[0].sourceMesh as HostMesh,
      scale = largestScale(placed, env.roots, draws.rootRankOf);
    const [vertices, corners] = await Promise.all([
      pagedGeometry(mesh).loadVertices(),
      Promise.all(primitive.pages.map((page) => context.readPage!(page.url))),
    ]);
    const drawn = drawnTriangles(vertices, 'triangles');
    if (!drawn) throw new Error('MATERIAL_CLASS_SOURCE_MISSING');
    const { indices, ends } = joinedCorners(corners);
    // The attributes the compiled pages carry, and those alone.
    const flags = primitive.pages[0].geometry!.flags;
    const carried = {
      ...drawn,
      indices,
      normals: flags & FLAG_NORMAL ? drawn.normals : new Float32Array(0),
      uvs: flags & FLAG_UV ? drawn.uvs : null,
      colors: flags & FLAG_COLOR ? drawn.colors : null,
    };
    const pages = primitive.pages,
      url = (k: number) => pages[k].geometry!.url;
    const read = (k: number[]) => readPages(context, k.map(url));
    // A mesh with no registered source reads its one-triangle stand-in: refused, never cut.
    const grown = await withPlaced(carried, { indices, ends }, pages, read);
    const recut = { ends, finestError: finestError(primitive), scale };
    const cut = await cutPagesOffThread(packDrawn(grown, blended, recut));
    return new Map(
      primitive.pages.map((page, k) => [page.id, new Uint8Array(cut.pages[k].geometry)]),
    );
  }

  /** The records draw `pages`, or the pages they read when null: resident ones at once. */
  async function swap(
    records: readonly PageRec[],
    pages: Map<number, Uint8Array> | null,
    mine: number,
  ) {
    const current = () => records.filter((rec) => draws.find(rec)?.turn === mine);
    // Written before the pages are read: a record that turns resident meanwhile draws its class's.
    for (const rec of current()) rec.recut = pages?.get(rec.id);
    const urls = pages
      ? []
      : [...new Set(current().flatMap((rec) => (rec.array ? [rec.url] : [])))];
    const read = await readPages(context, urls);
    const resident = current().filter((rec) => rec.array);
    if (pages) geometryStore.restoreRecords(resident, undefined);
    urls.forEach((url, k) =>
      geometryStore.restoreRecords(
        resident.filter((rec) => rec.url === url),
        read[k],
      ),
    );
    env.gate.resourcesChanged();
  }

  return {
    /** Why a record of `records` that `alpha` moves into or out of blended cannot have its pages
     *  cut again, before any write: the runtime cutter reads each page's corners from its index
     *  page, and carries one texture coordinate. */
    refusal(alpha: AlphaChange, records: readonly PageRec[]) {
      for (const rec of moved(alpha, records)) {
        const primitive = compiledOf(rec);
        if (!primitive || ownClass(primitive, alpha.to === 'blend')) continue;
        if (!context.readPage) return 'MATERIAL_CLASS_PAGES: the session reads no index page';
        if (primitive.pages.some((page) => (page.geometry?.flags ?? 0) & FLAG_UV1))
          return 'MATERIAL_CLASS_PAGES: its pages carry a second texture coordinate';
      }
    },
    /** `alpha` moved the class of some of `all`, the session's records: each primitive among them
     *  draws the pages of its new class, cut on the tile every placement of it sets, moved or
     *  not, as the compiler's is. */
    follow(alpha: AlphaChange, all: readonly PageRec[]) {
      const movedRecords = new Set(moved(alpha, all));
      if (movedRecords.size === 0) return;
      const byPrimitive = new Map<Primitive, PageRec[]>();
      for (const rec of all) {
        const primitive = compiledOf(rec);
        if (!primitive) continue;
        (byPrimitive.get(primitive) ?? byPrimitive.set(primitive, []).get(primitive)!).push(rec);
      }
      for (const [primitive, placed] of byPrimitive) {
        const records = placed.filter((rec) => movedRecords.has(rec));
        if (records.length === 0) continue;
        const mine = ++turn;
        for (const rec of records) {
          const draw = draws.find(rec);
          if (draw) draw.turn = mine;
        }
        const landed = pagesFor(primitive, alpha.to === 'blend', records, placed)
          .then((pages) => swap(records, pages, mine))
          .catch((error: unknown) =>
            sendEngineDiagnostic(context.onDiagnostic, 'material-class-pages', String(error), {
              kind: 'error',
              mesh: primitive.mesh,
              primitive: primitive.primitive,
            }),
          );
        pending = Promise.all([pending, landed]);
      }
    },
    /** Resolves once every cut a class change asked for has landed. */
    settled: () => pending,
  };
}
