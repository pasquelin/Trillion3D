/** Three numbers as a page writes them: `[x, y, z]` or anything with those three fields. */
export type Vec3Like =
  readonly [number, number, number] | { readonly x: number; readonly y: number; readonly z: number }

/** `v` read as three numbers. */
export const readVec3 = (v: Vec3Like): [number, number, number] =>
  Array.isArray(v)
    ? [v[0], v[1], v[2]]
    : [(v as { x: number }).x, (v as { y: number }).y, (v as { z: number }).z]
