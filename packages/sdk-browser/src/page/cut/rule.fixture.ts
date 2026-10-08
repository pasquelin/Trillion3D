/** The cut rule (`./rule.ts`) on the CPU, operand for operand: the oracle of `CUT_RULE_WGSL`. */
export function drawsCluster(
  resident: boolean,
  parentPixels: number,
  ownPixels: number,
  childResident: boolean,
  threshold: number,
) {
  return resident && parentPixels > threshold && (ownPixels <= threshold || !childResident)
}
