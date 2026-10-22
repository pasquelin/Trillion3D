import {
  DISPLACEMENT_RECORD,
  DISPLACEMENT_WORDS,
  type DisplacementRecords,
} from '../../materials/table/displacementRecord.ts'
import type { WebgpuTileStreamer } from '../../materials/virtual/streamer/streamer.ts'

/** The word of a record that holds its height map's atlas slot. */
const MAP = DISPLACEMENT_RECORD.at.map

/**
 * Asks, once an image, for the tiles of every displaced surface's height map: the dicing reads it at
 * the micro-triangles' corners, where no pixel posts a feedback request for it, so its tiles are
 * asked for the whole map at the level a view `pixels` across reads it (`warm`) — the map spans the
 * view and a micro-triangle is `dicingRate` pixels across, so a view's longest side over the rate.
 * A tile not yet resident is read at a coarser level by the sample until it lands.
 */
export function warmDisplacements(
  textures: Pick<WebgpuTileStreamer, 'warm'>,
  displaced: Pick<DisplacementRecords, 'ints'>,
  viewPixels: number,
  dicingRate: number,
  frame: number,
) {
  const pixels = viewPixels / dicingRate
  for (let at = MAP; at < displaced.ints.length; at += DISPLACEMENT_WORDS) {
    const slot = displaced.ints[at]!
    if (slot) textures.warm('data', slot, pixels, frame)
  }
}
