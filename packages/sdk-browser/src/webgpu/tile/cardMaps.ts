import { impostorBakedByMesh } from '../../../../sdk-core/src/impostor/switchTable.ts'
import type { ImpostorMap, ImpostorSection } from '../../../../sdk-core/src/contracts/impostor.ts'
import type { CardTiles } from './cardTiles.ts'
import { tileLayout } from '../../texture/tiles.ts'
import type { TileTexture } from './tileTexture.ts'

/** Whether a session's impostor cards read their maps from the tile pool: its card code is loaded
 *  (`gpu.impostorCode`) and their levels have a reader. Their pixels then ask tiles, a scene
 *  wearing no texture included (`../pages/prepare/feedbackVariant.ts`). */
export const cardsStream = (rt: {
  gpu: { impostorCode?: object }
  context: { readTextureLevel?: object }
}) => !!rt.gpu.impostorCode && !!rt.context.readTextureLevel

/** One impostor map as a texture of the atlases: its chain's layout — down to its last level, frames
 *  of four texels, never one texel —, the lossless lane its decoded levels take (sRGB in the
 *  colour atlas, linear in the data one, as the maps were made), each level read at its own file. */
const mapTexture = ({ levels }: ImpostorMap): TileTexture => ({
  layout: tileLayout(levels[0].width, levels[0].height, levels.length),
  lane: 'lossless',
  source: { kind: 'files', levels },
})

/**
 * THE IMPOSTOR MAPS IN THE TILE CATALOGUE, appended at prepare (#1527): each baked mesh's colour
 * and coverage to the colour atlas, its normal and depth and its packed ORM to the data atlas,
 * after the scene's textures, so the pools are drawn with them counted — their tails among the
 * floor, their tiles among the demand — and no table grows mid-run. Returns each mesh's three
 * slots. A mesh whose chain the tiles cannot lay out (`tileLayout`: one that stops before its
 * tail) is left out, said to `onFailure`: it keeps its clusters.
 */
export function appendCardMaps(
  section: ImpostorSection | undefined,
  color: TileTexture[],
  data: TileTexture[],
  onFailure: (phase: string, error: unknown) => void,
) {
  const slots = new Map<number, CardTiles>()
  for (const [mesh, { maps }] of impostorBakedByMesh(section)) {
    let textures: TileTexture[]
    try {
      textures = [maps.colourCoverage, maps.normalDepth, maps.orm].map(mapTexture)
    } catch (error) {
      onFailure(`impostor-maps-refused ${mesh}`, error)
      continue
    }
    const [colour, normalDepth, orm] = textures
    slots.set(mesh, [color.push(colour) - 1, data.push(normalDepth) - 1, data.push(orm) - 1])
  }
  return slots
}
