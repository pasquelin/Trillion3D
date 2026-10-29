import type { VolumetricFogField } from '../contracts/volumetricFogOptions.ts'

/** What each setting of the fog means (`../contracts/volumetricFogOptions.ts`): the volume's apply
 *  where the scene's fog turns it on (the sky module's `heightFog.volumetric`), the fog's own wherever a fog shows. */
export const VOLUMETRIC_FOG_MEANINGS: Readonly<Record<VolumetricFogField, string>> = {
  volumetricFogQuality:
    "The quality of the fog's volume, which fixes its grid: off draws none (the analytic fog alone); low cells of 16 pixels, 64 slices deep, 4 lighting samples where a cell has no history; high, the default, 8 pixels, 128 slices, 4 samples; ultra 4 pixels, 128 slices, 16 samples.",
  volumetricFogReadFilter:
    "How a surface reads the fog's volume: trilinear, one read; bicubic, a cubic B-spline across the screen from four reads; tricubic, across the depth too from eight. The translucent layers always read it trilinear.",
  volumetricFogUsesHistory:
    "Whether the fog's volume of the image before is blended into this one, so that the samples of many images average: smoother, at the cost of some lag on a light that moves.",
  volumetricFogMovesSamples:
    "Whether each image's lighting samples sit at another place in the cell (a low-discrepancy sequence), so that the blend over images averages them; effective with volumetricFogUsesHistory.",
  volumetricFogHistoryShare:
    'The share of the previous volume kept in each cell: the nearer 1, the smoother and the slower to follow. Any number; a share past 1 or below 0 extrapolates the history.',
  volumetricFogSliceSpread:
    "How the slices are spread along the depth of the fog's volume: the smaller, the more of them lie near the eye; a negative number puts them nearer the far end. Any number but 0.",
  volumetricFogGlow:
    'Whether the light the fog emits by itself is read: its glow (heightFog.volumetric.glow of the sky module) and the emissive light of the objects voxelised into it (material.volume).',
  volumetricFogSkipHidden:
    'Whether a cell wholly behind the surfaces of its pixels is left unlit, which spares its lighting and keeps what stands behind a wall out of the history.',
  volumetricFogLampSoftening:
    "Scale of the cell's size added to the distance a local light's inverse-square falloff is taken at, against the spike near the light; the added distance is at least one centimetre.",
  volumetricFogSampleScatter:
    'A random offset, in cells, added to each lighting sample, 0 none; effective with volumetricFogMovesSamples.',
  volumetricFogSurfaceLift:
    "Cells: how far a cell's sample is moved out of the depth buffer along the depth, so that a cell on a surface does not light itself with what stands behind it; any negative number, not at all.",
  volumetricFogLiftRange:
    'Cells: how far behind the depth buffer a sample is still brought forward (volumetricFogSurfaceLift); only the cells the surface cuts are moved at 1.',
  volumetricFogVoxelizationSlicesPerPass:
    'The slices of an object voxelised into the fog (a mesh or a fog volume with a volume material) that make one pass, at least 1; the passes only divide the slices, the sum is the same.',
  volumetricFogVoxelizationShowOnlyPass:
    'From 0, the one pass of each voxelised object that is kept, to see where the passes lie (a pass is volumetricFogVoxelizationSlicesPerPass slices from the nearest one the object reaches); -1 keeps them all.',
  volumetricFogLocalShadows:
    'Whether a point, spot or rectangle light whose shadow darkens the fog (shadowsFog) reads its shadow map in the volume, so that a shaft of it stops at what blocks it; on by default. Off, every local light lights the volume whole, which is cheaper; the sun keeps its own shadow.',
  volumetricFogRectLightTexture:
    "Whether a rectangle light that names a picture (sourceTexture) tints its light in the fog's volume by the picture's colour where the ray from the cell meets its face, at the level the rectangle's solid angle asks; off by default, where the rectangle lights the volume with its plain colour.",
  volumetricFogEdgeFade:
    "Where above 0, the edge of a spot's cone and of a rectangle's plane fade over this many cells of the fog's volume, so that they flicker less; 1 is a good start. 0, the default, fades nothing.",
  volumetricFogReadJitter:
    "A random offset, in cells (of 4 to 16 pixels), of the point a surface reads the fog's volume at, so that the cells' pixelisation does not show; 0, the default, none.",
  localFogVolumeSupport:
    "The project switch of the local fog volumes, read once when the session opens (changing it later changes nothing): on by default. false, no program holds any of the local fog volumes' code and no pass, buffer or block is made for them: they can still be declared (addLocalFogVolume) but are never drawn.",
  localFogVolumes:
    "Whether the local fog volumes of the scene (addLocalFogVolume) are drawn: spheres of fog whose density thins out radially and with height, lit by the sun and the sky light, over the scene's fog; on by default.",
  localFogVolumeInVolume:
    "Whether the local fog volumes are voxelised into the fog's volume where the scene's fog has one, the analytic law then drawing only what lies past the volume's far end; on by default. Off, the analytic law draws them whole, over the finished fog, the volume's light too.",
  localFogVolumeMaxVolumeDensity:
    "The most extinction, per metre, a local fog volume gives a cell of the fog's volume: the density at the bottom of its height law can grow so large that the volume's history leaks; 1 by default, 0 or more.",
  localFogVolumeStartDistance:
    'The distance from the eye, in metres, before which no local fog volume shows, whatever its own start distance; 10 by default, held to at least 0.1.',
  localFogVolumeMaxCount:
    'The most local fog volumes a view draws, the farthest and the lowest in priority dropped; 32 by default, held to 1 to 256.',
  localFogVolumeTileSize:
    'The side, in pixels, of the tiles of the screen the local fog volumes are culled by: each tile keeps the list of the volumes over it, and a pixel or a cell of the fog walks the list of its tile alone; 128 by default, held to 8 to 512; the lists are made for the tile grid the view cuts, and only while a view draws a volume.',
  localFogVolumeUsesDepthPyramid:
    "Whether a tile's list drops a local fog volume that lies wholly behind the surfaces the depth pyramid holds over the volume's footprint, so that no pixel walks a volume it cannot show; on by default. Off, or where the image has no pyramid, the tile's frustum alone culls.",
  localFogVolumeOnTranslucent:
    "Whether the translucent surfaces are fogged by the local fog volumes too; off by default, they are fogged by the scene's fog alone.",
  fogEnabled:
    "Whether any fog is drawn: the height fog, its volume and the atmosphere's haze over the surfaces. false draws the scene as if it had none.",
  fogReadsAtmosphere:
    "Whether the atmosphere's light adds to the fog: its sky to the fog's colour, its sun on the ground and its second light to the fog's lobe. false leaves the fog its own colour and lobe, the lobe then not divided by 4π.",
  fogMatchesVolume:
    "Whether the fog is made to match the volume (heightFog.volumetric of the sky module): its colour is the volume's glow, its lobe the volume's phase function — from the sun alone, from the start — and its light times the volume's particle colour; the glow is then read in the engines' own unit, 10 000 times what it reads as otherwise, and follows the density of the medium.",
  fogOrthoHeightAdjustment:
    'Whether an orthographic view measures the fog from the height its position gives, not from its eye: the eye of such a view lies where the box begins, which is not where the air is.',
  fogReadsSkyLight:
    "The project switch of the sky light lighting the height fog, off by default: with it on, a fog whose skyLightScattering has a strength above 0 takes the sky light's cube as the colour of its in-scattering, in the views that have sky lighting. Off, the fog's skyLightScattering is not read.",
}
