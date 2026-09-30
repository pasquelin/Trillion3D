import { residentProxyWgsl } from '../../bounce/nodeWgsl.ts';
import { directLightWgsl } from './lightWgsl.ts';
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { SUN_WINDOW } from '../../../../sdk-core/src/scene/light-shadow/virtual.ts';
import { RECT_SHADING_WGSL } from './rectLightWgsl.ts';
import { irradianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts';
import { SURFACE_MODEL_LIGHT_WGSL } from '../../scene/surfaceModel.ts';
import { declaredLightWgsl, sliceLightingWgsl } from './lightLoopWgsl.ts';
import { directLightSamplingWgsl } from './lightSamplingWgsl.ts';
import { directShadowWgsl } from './shadowWgsl.ts';
import { sunFarShadowWgsl, SUN_FAR_PROXY_BINDING } from '../../gpu/shadow/sunFarShadowWgsl.ts';
import { INVERSE_PI } from '../shaderConstants.ts';
import { FOG_WGSL } from '../fogShader.ts';

/** Shadow bindings of the opaque resolve: records and page table, the request buffer, and the
 *  transmittance layer's two textures — on the numbers the water composite reads them at too. */
export const CONTRACT_SHADOW_BINDINGS = {
  data: 8,
  requests: 14,
  transmittance: 18,
  translucentDepth: 19,
};

/** A tile's slice of lights: a list, a pool slice past `TILE_LIGHTS`, or every light — what the
 *  wide resolve walks, and the shadow demand pass (`../../webgpu/shadow/demandWgsl.ts`). */
export const TILE_SLICE_WGSL = `
/** Where the lights of a slice of a tile's list start, and how many: its count at countSlot, its
 *  list from firstSlot — past \`TILE_LIGHTS\`, from the start the list's first word names in the
 *  pool (#849). \`TILE_NO_SLICE\` when the pool had no room: every declared light of the scene. */
fn tileSlice(base:u32,countSlot:u32,firstSlot:u32)->vec2u{
 let kept=tileLights[base+countSlot];
 if(kept<=TILE_LIGHTS){return vec2u(base+firstSlot,kept);}
 let first=tileLights[base+firstSlot];
 return vec2u(first,select(kept,directLights.count,first==TILE_NO_SLICE));
}`;
/** The wide resolve's slices (`TILE_SLICE_WGSL`) and their lighting, the range reject without
 *  shadow code (`sliceLightingWgsl`). */
const wideSliceWgsl = (reject: boolean) => `${TILE_SLICE_WGSL}${sliceLightingWgsl(false, reject)}`;
/**
 * The narrow resolve's slices (#849): a scene of at most `TILE_LIGHTS` lights runs the narrow
 * tile pass, so no tile passes its list and none walks the pool or the whole scene. The slice is
 * the list itself — the same lights in the same order as the wide loop, so the same sum, bit for
 * bit — run on a device against the wide loop by `tests/browser/probes/narrow-resolve-gpu.ts`.
 */
const narrowSliceWgsl = (reject: boolean) => `
fn tileSlice(base:u32,countSlot:u32,firstSlot:u32)->vec2u{return vec2u(base+firstSlot,tileLights[base+countSlot]);}${sliceLightingWgsl(true, reject)}`;
/**
 * Base of the two lighting passes: contract types, shadow reads, and the contribution of a
 * single declared light at the point, its shadow included — the engine's only lighting
 * formula. The two loops below differ only by the light list they walk, never by the
 * physics or the surface type. A light out of range, or fully in shadow, yields exactly zero.
 *
 * The sun shadow beyond the last clipmap level is part of it: both passes bind the resident
 * proxy and fire the same ray. The parameters are the **ranks** of the bindings, which the
 * layouts number differently, and the right to write: the two count counters of the far ray,
 * and the shadow requests — the opaque resolve asks for the pages it reads; the blend and water
 * passes read what it asked for, and keep their early depth reject.
 */
const lightingBase = (
  proxyBinding: number,
  shadowBinding: number,
  requestBinding: number | null,
  transmittanceBinding: number,
  pages: number,
  narrow = false,
  shadowed = true,
  rects = true,
) => `
${directLightWgsl(narrow ? LIGHT_SETTINGS.tileLights : undefined)}
${residentProxyWgsl(proxyBinding, requestBinding !== null)}
${sunFarShadowWgsl(requestBinding !== null)}
${directShadowWgsl(shadowBinding, requestBinding, transmittanceBinding, pages)}
${SURFACE_MODEL_LIGHT_WGSL}
${RECT_SHADING_WGSL}
${FOG_WGSL}
var<private> thinSubsurface:vec3f=vec3f(0.0);
/** Thin two-sided diffuse transmission: projected back irradiance, normalized over a hemisphere.
 * Material contract: reference public Two Sided Foliage; this is our Lambert implementation. */
fn thinTransmission(cosine:f32,energy:f32)->f32{return max(-cosine,0.0)*energy*${INVERSE_PI};}
${declaredLightWgsl(shadowed, rects)}
/** The environment's irradiance at the normal N (\`packages/sdk-core/src/scene/core/environment.ts\`), on the diffuse lobe:
 *  what an ambient, a sky over a ground or a probe gives a surface, never shadowed. */
fn environmentLighting(rgb:vec3f,metal:f32,N:vec3f,ao:f32)->vec3f{
 let e=directLights.environment;
 let E=${irradianceShader((k) => `e[${k}].rgb`, 'N')};
 return rgb*(1.0-metal)*max(E,vec3f(0.0))*ao*${INVERSE_PI};
}
fn pixelTile(pixel:vec2f)->vec2u{return vec2u(u32(pixel.x)/TILE_SIZE,u32(pixel.y)/TILE_SIZE);}
${narrow ? narrowSliceWgsl(!shadowed) : wideSliceWgsl(!shadowed)}
fn tileLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,tile:vec2u,tilesX:u32,countSlot:u32,firstSlot:u32)->vec3f{
 return sliceLighting(rgb,metal,rough,N,V,P,ao,tileSlice((tile.y*tilesX+tile.x)*TILE_STRIDE,countSlot,firstSlot));
}`;

/**
 * Resolve of the direct-lighting contract in the visibility buffer. The pixel loop is bounded
 * by its tile list, never by the scene light count (X2); Lambert and GGX come from
 * `standardLighting`, the only reference implementation; attenuation is physical and cancels
 * at range.
 *
 * No light without a declared source (P6): there is no ambient term here, no constant sky, no
 * lighting written in the scene. A surface that no declared light reaches is exactly zero,
 * and a windowless corridor stays black in full daylight.
 *
 * `view.viewport.w` is the rank of a SAMPLED image — a moving one that temporal antialiasing
 * accumulates — and zero for every other: a still image, which converges to the exact sum,
 * and an image that does not accumulate, which is never noisy. At zero the loop is the one
 * over every light of the tile, character for character; so is it on a sampled image whose tile
 * list holds no shadowed light (`tileShadowed`, #1249), a flag the tile pass writes once.
 *
 * `narrow` is the resolve of a scene of at most `TILE_LIGHTS` lights (#849): its light array is
 * that long and its slice loop no pool branch (`narrowSliceWgsl`), as the narrow tile pass
 * writes (`../tiles/shader.ts`). Without `shadowed`, the resolve of a scene no light of which
 * holds a shadow slot: the same sums with no shadow code compiled in (`declaredLightWgsl`, #1249)
 * and the range reject in its loop (`sliceLightingWgsl`). Without `rects`, the resolve of a scene
 * that holds no rectangle light: the same sums with no rectangle code in the light loop
 * (`declaredLightWgsl`, #1369).
 */
export const directLightingWgsl = (
  narrow = false,
  pages = SUN_WINDOW,
  shadowed = true,
  rects = true,
) => `
${lightingBase(SUN_FAR_PROXY_BINDING, CONTRACT_SHADOW_BINDINGS.data, CONTRACT_SHADOW_BINDINGS.requests, CONTRACT_SHADOW_BINDINGS.transmittance, pages, narrow, shadowed, rects)}
${directLightSamplingWgsl(rects)}
/** Contribution of the contract lights to the pixel, tile by tile and light by light. */
fn contractLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f)->vec3f{
 if(u32(view.lightParams.x)==0u){return vec3f(0.0);}
 let tile=pixelTile(pixel);
 let tilesX=u32(view.lightParams.y);
 let tilesY=u32(view.lightParams.z);
 if(tile.x>=tilesX||tile.y>=tilesY){return vec3f(0.0);}
 let rank=u32(view.viewport.w);
 if(rank==0u||!tileShadowed(tile,tilesX)){return tileLighting(rgb,metal,rough,N,V,P,ao,tile,tilesX,0u,TILE_OPAQUE_BASE);}
 return sampledTileLighting(rgb,metal,rough,N,V,P,ao,tile,tilesX,rank,pixel);
}`;
export const DIRECT_LIGHTING_WGSL = directLightingWgsl();

/**
 * Declared lights that light a blend surface, taken from the **blend slice** of its tile
 * list: the one that goes from the near plane to the opaque background, and that is the tile's
 * whole column where any pixel sees the sky. That is the slice that is needed, because a
 * blend surface is drawn in front of its pixel's opaque: the opaque slice would take declared
 * lights away from it, and foliage placed in front of the sky would keep none.
 *
 * The loop stays **exact**, and its sum is that of the loop over every light, bit for bit:
 * a light absent from the list meets no point of the slice — its range sphere does not
 * touch the slice's box or column —, so `declaredLight` would have returned exactly `vec3f(0.0)`, and
 * removing a zero from a float sum does not change it. What changes is the number of lights
 * walked, hence the number of shadow-atlas reads.
 *
 * With no list — a device that could not fit the tile pass —, the loop falls back on the
 * declared lights, every one of them.
 */
export const declaredLightingWgsl = (
  proxyBinding: number,
  shadowBinding: number,
  transmittanceBinding: number,
  pages = SUN_WINDOW,
) => `
${lightingBase(proxyBinding, shadowBinding, null, transmittanceBinding, pages)}
fn declaredLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f)->vec3f{
 let tilesX=u32(uni.lightTiles.x);
 let tilesY=u32(uni.lightTiles.y);
 let tile=pixelTile(pixel);
 if(tilesX==0u||tilesY==0u||tile.x>=tilesX||tile.y>=tilesY){
  return sliceLighting(rgb,metal,rough,N,V,P,ao,vec2u(TILE_NO_SLICE,directLights.count));
 }
 return tileLighting(rgb,metal,rough,N,V,P,ao,tile,tilesX,1u,TILE_BLEND_BASE);
}`;
