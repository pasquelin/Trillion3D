import type { Projected } from './projection.ts'

/** CPU mirror of the shaders' UV derivatives (`UV_GRADIENTS_WGSL`, `shader/shadeDeclWgsl.ts`): same
 *  quotients, same order, two languages — the text is not shared between TypeScript and WGSL. */
export function uvDerivatives(
  a: Projected,
  b: Projected,
  c: Projected,
  uva: [number, number],
  uvb: [number, number],
  uvc: [number, number],
  x: number,
  y: number,
) {
  const dxb = b.x - a.x,
    dyb = b.y - a.y,
    dxc = c.x - a.x,
    dyc = c.y - a.y,
    det = dxb * dyc - dxc * dyb
  if (det === 0) return { duDx: 0, dvDx: 0, duDy: 0, dvDy: 0 }
  const inv = 1 / det,
    dsdx = dyc * inv,
    dsdy = -dxc * inv,
    dtdx = -dyb * inv,
    dtdy = dxb * inv
  const s = ((x - a.x) * dyc - (y - a.y) * dxc) * inv,
    t = ((y - a.y) * dxb - (x - a.x) * dyb) * inv,
    a0 = 1 - s - t
  const iw0 = a.invW,
    iw1 = b.invW,
    iw2 = c.invW
  const Uu = a0 * uva[0] * iw0 + s * uvb[0] * iw1 + t * uvc[0] * iw2,
    Uv = a0 * uva[1] * iw0 + s * uvb[1] * iw1 + t * uvc[1] * iw2,
    W = a0 * iw0 + s * iw1 + t * iw2
  if (W === 0) return { duDx: 0, dvDx: 0, duDy: 0, dvDy: 0 }
  const dUuds = -uva[0] * iw0 + uvb[0] * iw1,
    dUudt = -uva[0] * iw0 + uvc[0] * iw2,
    dUvds = -uva[1] * iw0 + uvb[1] * iw1,
    dUvdt = -uva[1] * iw0 + uvc[1] * iw2
  const dWds = -iw0 + iw1,
    dWdt = -iw0 + iw2
  const dUudx = dUuds * dsdx + dUudt * dtdx,
    dUudy = dUuds * dsdy + dUudt * dtdy,
    dUvdx = dUvds * dsdx + dUvdt * dtdx,
    dUvdy = dUvds * dsdy + dUvdt * dtdy
  const dWdx = dWds * dsdx + dWdt * dtdx,
    dWdy = dWds * dsdy + dWdt * dtdy,
    invW2 = 1 / (W * W)
  return {
    duDx: (dUudx * W - Uu * dWdx) * invW2,
    dvDx: (dUvdx * W - Uv * dWdx) * invW2,
    duDy: (dUudy * W - Uu * dWdy) * invW2,
    dvDy: (dUvdy * W - Uv * dWdy) * invW2,
  }
}
