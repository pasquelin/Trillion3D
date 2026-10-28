/** A light's record as the shader tests hand it to the light term (`DirectLight`): every field of the contract, each overridable by the
 *  test that varies it. The defaults are a lamp at the origin of no range, white, looking down, of no shadow slot, no capsule, and no
 *  exposure blend, no tube and no draw range, and the full rough-diffuse weight of a source of no size (`sourceTerm`: 1, `DirectLight.traits`). */
export type TestLight = {
  positionRange: number[]
  colorIntensity: number[]
  directionCone: number[]
  params: number[]
  shape: number[]
  capsule: number[]
  contactGi: number[]
  traits: number[]
}

/** A light record of the defaults above, the fields of `overrides` replacing theirs. */
export const testLight = (overrides: Partial<TestLight> = {}): TestLight => ({
  positionRange: [0, 0, 0, 0],
  colorIntensity: [1, 1, 1, 1],
  directionCone: [0, -1, 0, -1],
  params: [0, 0, 0, 0],
  shape: [0, 0, 1, 1],
  capsule: [0, 0, 0, 0],
  contactGi: [0, 1, 0, 1],
  traits: [0, 0, 1, 0],
  ...overrides,
})
