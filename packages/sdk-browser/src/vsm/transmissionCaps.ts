/**
 * THE TRANSMISSION'S CAPACITIES (`transmissionMade.ts`): the largest a device holds for a layout,
 * whether some fit it, and those that would hold what a frame counted.
 */
import { nextPow2 } from '../../../math/src/scalar/integers.ts'
import { storageBufferCap } from '../residency/pools.ts'
import { textureLimits } from '../gpu/core/textureLimits.ts'
import type { VsmLayout } from './layout.ts'
import {
  headerRows,
  VSM_TRANSMISSION_BLOCKS_A_ROW,
  VSM_TRANSMISSION_COUNTERS,
  vsmTransmissionRegions,
  type VsmTransmissionCaps,
} from './transmissionLayout.ts'

/**
 * The largest capacities a device of `limits` holds for `layout`: the blocks the largest texture
 * holds below the page headers, and the build buffer within one storage binding
 * (`storageBufferCap`). A growth stops there.
 */
export function vsmTransmissionMostCaps(
  layout: VsmLayout,
  limits?: Parameters<typeof storageBufferCap>[0] & { maxTextureDimension2D?: number },
) {
  const { side } = textureLimits(limits)
  return {
    blocks: (side - headerRows(layout.poolPages)) * VSM_TRANSMISSION_BLOCKS_A_ROW,
    buildWords: Math.floor(storageBufferCap(limits) / 4),
  }
}

/** Whether `caps` fit a device of `limits`. */
export function vsmTransmissionFits(
  layout: VsmLayout,
  caps: VsmTransmissionCaps,
  limits?: Parameters<typeof vsmTransmissionMostCaps>[1],
) {
  const most = vsmTransmissionMostCaps(layout, limits)
  return (
    caps.blocks <= most.blocks &&
    vsmTransmissionRegions(layout.poolPages, caps).words <= most.buildWords
  )
}

/** The capacities that hold what a frame counted (`counters`, the build buffer's first words):
 *  each short one to the power of two at or above its need, none when all held. */
export function vsmTransmissionWanted(
  caps: VsmTransmissionCaps,
  counters: Uint32Array,
): VsmTransmissionCaps | undefined {
  const C = VSM_TRANSMISSION_COUNTERS
  const grow = (held: number, need: number) => (need > held ? nextPow2(need) : held)
  const next = {
    records: grow(caps.records, counters[C.records]),
    patchWords: grow(caps.patchWords, counters[C.patchWords]),
    blocks: grow(caps.blocks, caps.blocks + counters[C.blocksShort]),
  }
  const same = (Object.keys(next) as (keyof VsmTransmissionCaps)[]).every(
    (key) => next[key] === caps[key],
  )
  return same ? undefined : next
}
