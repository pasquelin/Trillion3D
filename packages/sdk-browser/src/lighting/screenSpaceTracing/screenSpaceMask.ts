/** The roughness mask's scale of a view whose maximum roughness is `maxRoughness`: the roughness fade is `min(roughness · scale + 2, 1)`,
 *  1 at half the maximum and 0 at the maximum; the two lowest levels double it. */
export function roughnessMaskScale(maxRoughness: number, code: number) {
  const clamped = Math.min(Math.max(maxRoughness, 0.01), 1)
  return (-2 / clamped) * (code < 3 ? 2 : 1)
}
