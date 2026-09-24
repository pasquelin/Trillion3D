/** A drawn mesh as its depth reads it: its own sphere or its geometry's, and its world matrix. */
type DepthNode = {
  readonly geometry?: unknown;
  readonly matrixWorld: { elements: ArrayLike<number> };
};
type Centre = { readonly x: number; readonly y: number; readonly z: number };
type Bounded = {
  boundingSphere?: { center: Centre; radius?: number } | null;
  computeBoundingSphere?(): void;
};
type Instanced = {
  readonly kind?: string;
  readonly count?: number;
  readonly instanceMatrix?: { readonly array: ArrayLike<number>; readonly version?: number };
};

/**
 * The depth a mesh is sorted by, the reference's: the normalised-device z of its bounding
 * sphere's centre (clip z over clip w, so a point behind the camera sorts as the reference sorts it) — the mesh's own sphere where it has one, the union of its placements' spheres for an
 * instanced mesh, its geometry's otherwise — never its origin, which a mesh whose vertices carry
 * their pose sets at the scene's. `screen` is the projection times the view.
 */
export function depthOf(mesh: DepthNode, screen: ArrayLike<number>) {
  const own = (mesh as Bounded).boundingSphere;
  let centre = own?.center;
  if (own === undefined) {
    const geometry = mesh.geometry as Bounded | undefined;
    if (geometry && !geometry.boundingSphere) geometry.computeBoundingSphere?.();
    const sphere = geometry?.boundingSphere;
    const instanced = mesh as Instanced;
    centre =
      instanced.kind === 'instancedMesh' && instanced.instanceMatrix && sphere
        ? placementsCentre(instanced, sphere)
        : sphere?.center;
  }
  const c = centre ?? ORIGIN,
    m = mesh.matrixWorld.elements;
  const x = m[0] * c.x + m[4] * c.y + m[8] * c.z + m[12],
    y = m[1] * c.x + m[5] * c.y + m[9] * c.z + m[13],
    z = m[2] * c.x + m[6] * c.y + m[10] * c.z + m[14],
    w = m[3] * c.x + m[7] * c.y + m[11] * c.z + m[15];
  const inverseW = 1 / (screen[3] * x + screen[7] * y + screen[11] * z + screen[15] * w);
  return (screen[2] * x + screen[6] * y + screen[10] * z + screen[14] * w) * inverseW;
}

/** An instanced mesh's placement sphere, kept while its matrices and count are unchanged. */
type PlacementSphere = { readonly centre: Centre; readonly radius: number };
const placementSpheres = new WeakMap<
  object,
  PlacementSphere & { version: number; count: number }
>();

/**
 * The centre of the union of an instanced mesh's placement spheres — the geometry's sphere carried
 * by each placement matrix — grown one placement after the other exactly as the reference grows
 * it, so the two orders sort on the same number. Recomputed only when the matrices or the count
 * change.
 */
export const placementsCentre = (mesh: Instanced, geometry: { center: Centre; radius?: number }) =>
  placementsSphere(mesh, geometry).centre;

/** The union of an instanced mesh's placement spheres, in its own space: what the depth sorts on
 *  and what the frustum culls on. A radius below zero is an empty union (no placement). */
export function placementsSphere(
  mesh: Instanced,
  geometry: { center: Centre; radius?: number },
): PlacementSphere {
  const matrices = mesh.instanceMatrix!,
    count = mesh.count ?? 0,
    version = matrices.version ?? 0;
  const kept = placementSpheres.get(mesh);
  if (kept && kept.version === version && kept.count === count) return kept;
  const g = geometry.center,
    gr = geometry.radius ?? 0,
    e = matrices.array;
  // The union, empty first (a negative radius), as the reference's `Sphere.makeEmpty`.
  let cx = 0,
    cy = 0,
    cz = 0,
    r = -1;
  const expandBy = (px: number, py: number, pz: number) => {
    if (r < 0) {
      [cx, cy, cz, r] = [px, py, pz, 0];
      return;
    }
    const dx = px - cx,
      dy = py - cy,
      dz = pz - cz,
      lengthSq = dx * dx + dy * dy + dz * dz;
    if (lengthSq <= r * r) return;
    const length = Math.sqrt(lengthSq),
      delta = (length - r) * 0.5,
      s = delta / length;
    cx += dx * s;
    cy += dy * s;
    cz += dz * s;
    r += delta;
  };
  for (let i = 0, o = 0; i < count; i++, o += 16) {
    // The geometry's sphere through placement `i`: its centre carried (with the projective
    // divide), its radius scaled by the matrix's largest axis.
    const w = 1 / (e[o + 3] * g.x + e[o + 7] * g.y + e[o + 11] * g.z + e[o + 15]);
    const sx = (e[o] * g.x + e[o + 4] * g.y + e[o + 8] * g.z + e[o + 12]) * w,
      sy = (e[o + 1] * g.x + e[o + 5] * g.y + e[o + 9] * g.z + e[o + 13]) * w,
      sz = (e[o + 2] * g.x + e[o + 6] * g.y + e[o + 10] * g.z + e[o + 14]) * w;
    const sr =
      gr *
      Math.sqrt(
        Math.max(
          e[o] * e[o] + e[o + 1] * e[o + 1] + e[o + 2] * e[o + 2],
          e[o + 4] * e[o + 4] + e[o + 5] * e[o + 5] + e[o + 6] * e[o + 6],
          e[o + 8] * e[o + 8] + e[o + 9] * e[o + 9] + e[o + 10] * e[o + 10],
        ),
      );
    if (sr < 0) continue;
    if (r < 0) [cx, cy, cz, r] = [sx, sy, sz, sr];
    else if (sx === cx && sy === cy && sz === cz) r = Math.max(r, sr);
    else {
      // The farthest two points of the placement's sphere along the line between the centres.
      const dx = sx - cx,
        dy = sy - cy,
        dz = sz - cz,
        inverse = 1 / (Math.sqrt(dx * dx + dy * dy + dz * dz) || 1),
        vx = dx * inverse * sr,
        vy = dy * inverse * sr,
        vz = dz * inverse * sr;
      expandBy(sx + vx, sy + vy, sz + vz);
      expandBy(sx - vx, sy - vy, sz - vz);
    }
  }
  const sphere = { version, count, centre: { x: cx, y: cy, z: cz }, radius: r };
  placementSpheres.set(mesh, sphere);
  return sphere;
}
const ORIGIN: Centre = { x: 0, y: 0, z: 0 };
