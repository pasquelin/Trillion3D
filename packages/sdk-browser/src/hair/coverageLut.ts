import { oncePerDevice } from '../gpu/core/oncePerDevice.ts'
import { HAIR_STRANDS_PASS_PREFIX } from '../diagnostic/stage/passLabels.ts'

/** The strand counts and the normalized widths the table holds an entry for. */
export const HAIR_COVERAGE_LUT_SIZE = 64

/**
 * THE TABLE OF COVERAGE (`hairVisibilityCoverageMapping`): the share of a line that `count` segments, each
 * `width` of it wide and each at a place of the line drawn at random and alone, cover together, written
 * `table[count * HAIR_COVERAGE_LUT_SIZE + column]` for the width `(column + 0.5) / HAIR_COVERAGE_LUT_SIZE`
 * of the line. A segment misses a point with the probability one less its width, the segments being
 * alone: the coverage of `count` of them is one less that to the power `count`, which is the mean
 * of every placement and has none of the noise of a table drawn from a few of them. No segment covers nothing.
 */
export function hairCoverageTable() {
  const table = new Float32Array(HAIR_COVERAGE_LUT_SIZE * HAIR_COVERAGE_LUT_SIZE)
  for (let count = 0; count < HAIR_COVERAGE_LUT_SIZE; count++)
    for (let column = 0; column < HAIR_COVERAGE_LUT_SIZE; column++)
      table[count * HAIR_COVERAGE_LUT_SIZE + column] =
        1 - (1 - (column + 0.5) / HAIR_COVERAGE_LUT_SIZE) ** count
  return table
}

/** The table in a storage buffer of the device, written once and kept (`hairCoverageMapWgsl` reads it). */
export const hairCoverageLutBuffer = oncePerDevice((device) => {
  const table = hairCoverageTable()
  const buffer = device.createBuffer({
    label: `${HAIR_STRANDS_PASS_PREFIX}coverage table`,
    size: table.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  })
  device.queue.writeBuffer(buffer, 0, table)
  return buffer
})
