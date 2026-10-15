/** ×31 polynomial by code points: a cluster identifier's colour seed. */
export function clusterHash(id: string) {
  return Array.from(id).reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 0)
}
