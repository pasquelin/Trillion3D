/** The height gained over `h` seconds from the vertical speed `vy`, and the speed after:
 *  rising under `up`, falling under `down`, the apex found inside the tick when it is there. */
export function arc(vy: number, h: number, up: number, down: number) {
  const rising = vy > 0 ? Math.min(h, vy / up) : 0,
    falling = h - rising,
    top = vy - up * rising
  const dy = vy * rising - 0.5 * up * rising * rising + top * falling - 0.5 * down * falling ** 2
  return [dy, top - down * falling] as const
}
