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
  volumetricFogEdgeFade:
    "Where above 0, the edge of a spot's cone and of a rectangle's plane fade over this many cells of the fog's volume, so that they flicker less; 1 is a good start. 0, the default, fades nothing.",
  volumetricFogReadJitter:
    "A random offset, in cells (of 4 to 16 pixels), of the point a surface reads the fog's volume at, so that the cells' pixelisation does not show; 0, the default, none.",
  fogEnabled:
    "Whether any fog is drawn: the height fog, its volume and the atmosphere's haze over the surfaces. false draws the scene as if it had none.",
  fogReadsAtmosphere:
    "Whether the atmosphere's light adds to the fog: its sky to the fog's colour, its sun on the ground and its second light to the fog's lobe. false leaves the fog its own colour and lobe, the lobe then not divided by 4π.",
  fogMatchesVolume:
    "Whether the fog is made to match the volume (heightFog.volumetric of the sky module): its colour is the volume's glow, its lobe the volume's phase function — from the sun alone, from the start — and its light times the volume's particle colour; the glow is then read in the engines' own unit, 10 000 times what it reads as otherwise.",
  fogOrthoHeightAdjustment:
    'Whether an orthographic view measures the fog from the height its position gives, not from its eye: the eye of such a view lies where the box begins, which is not where the air is.',
}
