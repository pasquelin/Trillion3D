/**
 * The pages of a primitive whose material moved into or out of blended in the session (#846).
 * The compiler cuts a blended primitive on finer grids than an opaque or masked one (#875), so
 * the pages a session opened for one class are not the ones it writes for the other. Such a
 * primitive is cut again by the runtime cutter (`runtimeCut.ts`), off the main thread, from the
 * source vertices its pages were cut from, on its own clusters — each page's corners, read from
 * its index page — and on the grids the compiler gives the new class (`Recut`); its resident
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
import type { PageRec } from '../../page/selection/selection.ts';
import { blendMoves, type AlphaChange } from '../../placement/backendSceneUpdates.ts';
import { primitiveFinder } from '../../scene/primitiveLookup.ts';
import { packDrawn } from '../../world/page/runtimeCut.ts';
import type { BackendContext } from '../types.ts';
import type { createAutonomousGeometry } from './geometry.ts';
import { readPages } from './manifest.ts';

type ClassPagesEnvironment = {
  context: BackendContext;
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

/** The largest world scale that places the records: the compiler's tile follows it. */
const largestScale = (records: readonly PageRec[]) =>
  records.reduce(
    (scale, rec) =>
      Math.max(scale, new Matrix4().fromArray(rec.matrix.elements).getMaxScaleOnAxis()),
    0,
  );

export function createClassPages(env: ClassPagesEnvironment) {
  const { context, geometryStore } = env;
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
  /** The last change each record followed: an earlier cut landing late writes nothing. */
  const turns = new WeakMap<PageRec, number>();
  let turn = 0,
    pending: Promise<unknown> = Promise.resolve();

  /** The pages of `primitive` for the class `blended`, by page id; null for the class it was
   *  compiled for, whose pages are the ones it reads. */
  async function pagesFor(primitive: Primitive, blended: boolean, records: readonly PageRec[]) {
    const mesh = records[0].sourceMesh as HostMesh;
    if (ownClass(primitive, blended)) return null;
    const [vertices, corners] = await Promise.all([
      pagedGeometry(mesh).loadVertices(),
      Promise.all(primitive.pages.map((page) => context.readPage!(page.url))),
    ]);
    const drawn = drawnTriangles(vertices, 'triangles');
    if (!drawn) throw new Error('MATERIAL_CLASS_SOURCE_MISSING');
    const ends = new Uint32Array(corners.length),
      indices = new Uint32Array(corners.reduce((sum, page) => sum + page.length, 0));
    let offset = 0;
    corners.forEach((page, k) => {
      indices.set(page, offset);
      ends[k] = offset += page.length;
    });
    // A mesh with no registered source reads its one-triangle stand-in: refused, never cut.
    if (indices.some((v) => v * 3 >= drawn.positions.length))
      throw new Error('MATERIAL_CLASS_SOURCE_MISSING');
    // The attributes the compiled pages carry, and those alone.
    const flags = primitive.pages[0].geometry!.flags;
    const carried = {
      ...drawn,
      indices,
      normals: flags & FLAG_NORMAL ? drawn.normals : new Float32Array(0),
      uvs: flags & FLAG_UV ? drawn.uvs : null,
      colors: flags & FLAG_COLOR ? drawn.colors : null,
    };
    const recut = { ends, finestError: finestError(primitive), scale: largestScale(records) };
    const cut = await cutPagesOffThread(packDrawn(carried, blended, recut));
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
    const current = () => records.filter((rec) => turns.get(rec) === mine);
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
    /** `alpha` moved the class of some of `records`: each primitive among them draws the pages
     *  of its new class. */
    follow(alpha: AlphaChange, records: readonly PageRec[]) {
      const byPrimitive = new Map<Primitive, PageRec[]>();
      for (const rec of moved(alpha, records)) {
        const primitive = compiledOf(rec);
        if (!primitive) continue;
        (byPrimitive.get(primitive) ?? byPrimitive.set(primitive, []).get(primitive)!).push(rec);
      }
      for (const [primitive, records] of byPrimitive) {
        const mine = ++turn;
        for (const rec of records) turns.set(rec, mine);
        const landed = pagesFor(primitive, alpha.to === 'blend', records)
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
