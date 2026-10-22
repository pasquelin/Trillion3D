import type { ShadowMapField } from '../contracts/shadowMapOptions.ts'
import type { ShadowField } from '../contracts/shadowOptions.ts'

/** The settings of the shadows that govern how the raster groups the lights' views, and those of
 *  the shadow maps themselves (`../contracts/shadowOptions.ts`, `../contracts/shadowMapOptions.ts`). */
export type ShadowViewField = Extract<ShadowField, 'shadowMultipassViews'> | ShadowMapField

/** What each means. */
export const SHADOW_VIEW_MEANINGS: Readonly<Record<ShadowViewField, string>> = {
  shadowMultipassViews:
    'Whether the shadow raster draws the lights in several passes when their maps would pass what one pass takes: the cull runs one row of its dispatch a listed light, so a pass takes at most the rows a dispatch has, 65 535 on any device, counted in the maps of its lights, far more than a frame holds — the raster takes one pass for every frame of a device that grants it; each light whole in one pass; false, every light in one pass however many maps there are. The pages drawn are the same either way.',
  shadowClipmapFirstLevel:
    "The finest level of a directional light's clipmap, a power of two of centimetres: level L covers a radius of 2^(L+1) cm (6, the default: 1.28 m). Lower sharpens the shadows nearest the eye for more pages; the levels run from here to shadowClipmapLastLevel, and a change redraws the light's pages.",
  shadowClipmapLastLevel:
    "The coarsest level of a directional light's clipmap, which fixes how far its shadows reach (22, the default: about 84 km); each level more doubles the reach at one map more. Never below the first level.",
  shadowClipmapFirstCoarseLevel:
    'The first clipmap level whose coarse page is marked, so that a low-resolution shadow lies everywhere around the eye (15, the default: a radius of 655 m); from here to shadowClipmapLastCoarseLevel, and the last level of the clipmap always. None while shadowMarkCoarsePagesDirectional is 0.',
  shadowClipmapLastCoarseLevel:
    'The last clipmap level whose coarse page is marked (18, the default: a radius of 5.2 km): higher gives dense coarse shadow over a longer radius for more pages.',
  shadowClipmapZRangeScale:
    "Scale of each clipmap level's depth range on its radius (1000, the default): casters that far above a level still cast. Larger, the depth precision of a texel falls in proportion; a change redraws the light's pages.",
  shadowMarkCoarsePagesDirectional:
    "Coarse pages of a directional light's clipmap: 0 none, 1 marks them, 2 (the default) marks them and keeps the dynamic layer of those very large pages cached while casters move, so that a moving object does not redraw them.",
  shadowMarkCoarsePagesLocal:
    "Coarse pages of a point or spot light's maps, the page of the last mip, which every far receiver then finds: 0 none, 1 (the default) marks it, 2 marks it and keeps its dynamic layer cached while casters move. The quality levels write 2 below the top one.",
  shadowResolutionLodBiasDirectional:
    "Resolution bias of a directional light's maps while it rests: each unit below 0 doubles the resolution, each above halves it (-1.5, the default; 0 at the three lower quality levels). The clipmap never goes below the screen's own level.",
  shadowResolutionLodBiasDirectionalMoving:
    'Resolution bias of a directional light while it moves — its direction changed — (-1.5, the default; 0 at the three lower levels); it falls back to shadowResolutionLodBiasDirectional over shadowLightActiveFrameCount frames, and is never finer than that.',
  shadowResolutionLodBiasLocal:
    "Resolution bias of a point or spot light's maps while it rests (0, the default): each unit below 0 doubles the resolution, each above halves it. The quality levels write 1, 1 and 0 below the top one.",
  shadowResolutionLodBiasLocalMoving:
    'Resolution bias of a point or spot light while it moves or was just made (1, the default: half the resolution); it falls back to shadowResolutionLodBiasLocal over shadowLightActiveFrameCount frames, and is never finer than that. The quality levels write 2, 2 and 1 below the top one.',
  shadowLightActiveFrameCount:
    'The frames a light that was just made or moved counts as moving (10, the default): its moving bias falls back to its resting one in equal steps over them, and every light counts as able to move.',
  shadowRadiusThreshold:
    'The least radius of an object over its distance from the eye (0.01, the default: one hundredth) for it to be drawn into a shadow map redrawn whole — that of a light just made or moved: a smaller object is left out of such a map, and stays out of its pages until they are redrawn. 0 draws every caster; the quality levels write 0.06, 0.05 and 0.04 below the top one.',
  shadowRadiusThresholdUncached:
    'Whether shadowRadiusThreshold applies to the maps redrawn whole; false draws every caster into them.',
  shadowRayCountDirectional:
    "Rays a pixel's shadow trace takes across a directional light's disk, from 0 to 15 (8, the default): more smooth the penumbra, in proportion to the cost; 0 reads the shadow map once along the light's axis, a hard edge. The quality levels write 0, 4 and 8 below the top one.",
  shadowSamplesPerRayDirectional:
    "Steps each ray of a directional light's trace takes, from 0 to 64 (4, the default): more catch thinner occluders, in proportion to the cost; 0, one sample. The quality levels write 2, 2 and 4 below the top one.",
  shadowRayCountLocal:
    "Rays a pixel's shadow trace takes across a point or spot light's source, from 0 to 15 (8, the default): more smooth the penumbra, in proportion to the cost; 0 reads the shadow map once along the light's axis, a hard edge. The quality levels write 0, 4 and 4 below the top one.",
  shadowSamplesPerRayLocal:
    "Steps each ray of a point or spot light's trace takes, from 0 to 64 (4, the default): more catch thinner occluders, in proportion to the cost; 0, one sample. The quality levels write 2, 2 and 4 below the top one.",
  shadowMaxPhysicalPages:
    'The most pages the shadow pool takes (4096, the default; the pool holds at most one window of 2048, and a value reads as the power of two at or below it): more space means finer shadows for more memory. The quality levels write 512, 512 and 2048 below the top one.',
}
