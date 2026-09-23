import {
  drawnTriangles,
  type DrawnTriangles,
} from '../../../../sdk-core/src/world/geometry/drawn.ts';
import type { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import type { Material } from '../../../../sdk-core/src/world/material/material.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import { sha256Hex } from '../../measurement/sha256Hex.ts';
import { cutRuntimePrimitive, type RuntimePrimitive } from '../page/runtimePrimitive.ts';
import { packDrawn } from '../page/runtimeCut.ts';

/**
 * A geometry resource: triangles cut into pages once, whatever number of geometry objects carry
 * the same content and whatever number of meshes place them. `users` are the meshes that draw it
 * now; `held` says a session still reads its pages. It is released when both are gone.
 */
export type Cut = {
  readonly key: string;
  readonly drawn: DrawnTriangles;
  readonly runtime: RuntimePrimitive;
  readonly users: Set<Mesh>;
  held: boolean;
};

export const firstMaterial = (m: Material | Material[]) => (Array.isArray(m) ? m[0] : m);

/**
 * What decides a mesh's triangles, beside its geometry: how it reads it, and the material fields
 * that turn a point into an octahedron, a line into a prism, a face into its wireframe or its
 * flat normals. Two meshes equal on these draw the same triangles, whatever else they wear.
 */
function readingOf(mesh: Mesh) {
  const material = firstMaterial(mesh.material);
  const options = {
    size: material.size as number | undefined,
    linewidth: material.linewidth as number | undefined,
    wireframe: material.wireframe === true,
    flat: material.flatShading === true,
  };
  const key = [mesh.primitive, ...Object.values(options)].join('|');
  return { key, options };
}

/** Drawn triangles, packed once (`packDrawn`): the digest of that buffer is their content key,
 *  and the buffer itself is what the cut is handed — then yielded, and dropped here. */
type Content = { key: string; drawn: DrawnTriangles; packed: ArrayBuffer | null };

async function readContent(drawn: DrawnTriangles): Promise<Content> {
  const packed = packDrawn(drawn);
  return { key: await sha256Hex(packed), drawn, packed };
}

type Reading = { version: number; read: Promise<Content | null> };

/**
 * The geometry table of a world. A mesh's triangles are read (`drawnTriangles`) once per geometry
 * version and way of reading, keyed by their content, and cut into pages only when no resource of
 * that key exists (`cutRuntimePrimitive`): two geometry objects of the same content share one set
 * of pages, and `counts.duplicates` says how often the table folded one onto another.
 */
export function createWorldCuts() {
  const byKey = new Map<string, Promise<Cut | null>>();
  const readings = new WeakMap<Geometry, Map<string, Reading>>();
  const drawnBy = new Map<Mesh, Cut>();
  const counts = { duplicates: 0 };
  const release = (cut: Cut) => {
    if (cut.users.size || cut.held) return;
    cut.runtime.urls.forEach((url) => URL.revokeObjectURL(url));
    byKey.delete(cut.key);
  };
  const leave = (mesh: Mesh) => {
    const cut = drawnBy.get(mesh);
    if (!cut) return;
    drawnBy.delete(mesh);
    cut.users.delete(mesh);
    release(cut);
  };
  /** The resource of a content, cut when the table holds none; a geometry object that is not
   *  the first to bring this content is counted as folded. */
  const resourceOf = (content: Content, fresh: boolean) => {
    const { key, drawn } = content,
      packed = content.packed;
    content.packed = null;
    let pending = byKey.get(key);
    if (pending) {
      if (fresh) counts.duplicates++;
      return pending;
    }
    // A content read again after its resource was released packs its triangles again.
    pending = cutRuntimePrimitive(packed ?? packDrawn(drawn)).then(
      (runtime) => ({ key, drawn, runtime, users: new Set<Mesh>(), held: false }),
      // A failed cut leaves no trace: the next mesh with this content tries again.
      () => {
        if (byKey.get(key) === pending) byKey.delete(key);
        return null;
      },
    );
    byKey.set(key, pending);
    return pending;
  };
  return {
    counts,
    /** The resource `mesh` draws, cut if no resource of its content exists; null when it draws
     *  no triangle. The mesh is counted among its users until it leaves. */
    async of(mesh: Mesh): Promise<Cut | null> {
      const { key: way, options } = readingOf(mesh);
      let ways = readings.get(mesh.geometry);
      if (!ways) readings.set(mesh.geometry, (ways = new Map()));
      let reading = ways.get(way);
      const fresh = !reading || reading.version !== mesh.geometry.version;
      if (fresh) {
        const drawn = drawnTriangles(mesh.geometry, mesh.primitive, options);
        const read = drawn ? readContent(drawn) : Promise.resolve(null);
        reading = { version: mesh.geometry.version, read };
        ways.set(way, reading);
        // A read that failed (no digest on this origin) is forgotten: the next asks again.
        const held = ways;
        read.catch(() => held.get(way)?.read === read && held.delete(way));
      }
      const content = await reading!.read;
      const cut = content ? await resourceOf(content, fresh) : null;
      if (drawnBy.get(mesh) !== cut) leave(mesh);
      if (cut) {
        cut.users.add(mesh);
        drawnBy.set(mesh, cut);
      }
      return cut;
    },
    /** The mesh no longer draws: its resource loses a user. */
    leave,
    /** A session reads `cut`'s pages, or no longer does. */
    hold(cut: Cut, held: boolean) {
      cut.held = held;
      release(cut);
    },
    dispose() {
      for (const mesh of [...drawnBy.keys()]) leave(mesh);
      for (const pending of byKey.values())
        void pending.then((cut) => {
          if (cut) this.hold(cut, false);
        });
    },
  };
}
