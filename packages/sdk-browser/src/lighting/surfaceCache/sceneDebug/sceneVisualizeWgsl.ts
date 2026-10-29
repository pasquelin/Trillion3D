import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { equalAreaEncode } from '../../../../../math/src/wgsl/octahedral.ts'
import { pixelToNdc, unprojectPoint } from '../../../../../math/src/wgsl/projection.ts'
import { bilinear3, interleavedGradientNoise } from '../../../../../math/src/wgsl/sampling.ts'
import { FULLSCREEN_VERTEX } from '../../../gpu/shader/fullscreenTriangle.ts'
import {
  lightAtlasScalar,
  lightReadDeps,
  type LightAtlasFormat,
} from '../../../gpu/core/lightAtlasFormat.ts'
import { skyLightReadWgsl } from '../../../modules/sky/skyLight/read.ts'
import { SKY_READ_WGSL } from '../../atmosphere/skyReadWgsl.ts'
import { CACHE_WORDS_WGSL } from '../../bounce/cache/cacheWordsWgsl.ts'
import { bounceBindingsWgsl } from '../../bounce/gridWgsl.ts'
import { fieldMapReads } from '../../bounce/irradianceField/gatherWgsl.ts'
import { FIELD_MAP_BORDER } from '../../bounce/irradianceField/mapsWgsl.ts'
import { BOUNCE_CM_WGSL } from '../../bounce/tracedHitWgsl.ts'
import { surfaceHitBindingsFrom, surfaceHitWgsl, type SurfaceHitBindings } from '../hitWgsl.ts'
import { DIRECT_LIGHT_WGSL } from '../../direct/lightWgsl.ts'
import { heightFogOverWgsl } from '../../reflections/rayLightWgsl.ts'
import type { RayFogBindings } from '../../reflections/rayFog.ts'
import { linearToSrgb } from '../../../../../math/src/wgsl/color.ts'
import {
  isLayerMode,
  TILE_CORNER,
  VISUALIZE_MODE,
  visualizeHitIsColour,
  visualizeOutputOf,
} from '../visualizeModes.ts'
import { RADIANCE_PROBE_SKY_SHARE } from './radianceProbesWgsl.ts'
import { visualizeTonemapWgsl } from './visualizeTonemap.ts'

/**
 * THE SCENE SEEN FROM THE CAMERA (`scene-visualization`): a pixel of the display takes the ray from the eye through it, marched through the global distance field
 * from `minTrace` to `maxTrace` (`gdfTraceRay`, the step the noise of the pixel and the frame spreads over 0.8 to 1, the surface expanded by the largest distance read, the
 * ray not dithered); where it meets a surface the light is what the surface cache holds there (`scGlobalHit`), the cone of one pixel's width at the hit and the finest
 * pages read where `hiRes`. Where the world's probes cover the eye (`cache`), the trace ends at the distance the nearest of them starts its rays (`cacheCoverage` at a fixed
 * half) and the light past it is theirs: the eight probes round the eye weighed by its fractions between them, each read along the ray moved onto the sphere round it
 * of `reprojection` times its level's nearest start, at the level of detail of the pixel's cone, the share of their rays that left the scene filled in with the sky; else
 * the sky fills the ray that met nothing. The light is shown at the exposure of the image, through the composition's table or the display's transfer alone.
 */

/** The bindings of the draw: the levels' uniform and the cell table, the parameters, the probes' maps, the final light and the sky's share of the probes, the colour's four, the sky light's four, then the hit's reads. */
export const SCENE_VISUALIZE_BINDINGS = {
  grid: 0,
  table: 1,
  params: 2,
  maps: 3,
  final: 4,
  sky: 5,
  tone: 6,
} as const
const B = SCENE_VISUALIZE_BINDINGS

/** Where the draw reads the sky light, after the colour's four bindings. */
export const SCENE_VISUALIZE_SKY_LIGHT = {
  group: 0,
  cube: B.tone + 4,
  sampler: B.tone + 5,
  harmonics: B.tone + 6,
  params: B.tone + 7,
} as const

/** Where the draw reads what a hit finds for the scene view's mode `mode` (a layer mode reads the layer it names, the coverage mode marks the mesh cards it met): the global field, its object grid and the surface cache. The cache's layers take eleven bindings past its tables, so the placements' table follows them. */
export const sceneVisualizeHit = (
  mode: number,
  feedback = false,
  compressed = false,
): SurfaceHitBindings => ({
  ...surfaceHitBindingsFrom(0, B.tone + 8),
  instances: B.tone + 8 + 18,
  visualize: isLayerMode(mode) || mode === VISUALIZE_MODE.surfaceCache ? mode : undefined,
  feedback,
  compressed,
})

/** Where the draw reads the lights (the height fog's constants) and the fog's own cube and its sampler, after the hit's reads. */
export const SCENE_VISUALIZE_LIGHTS = B.tone + 8 + 19
export const SCENE_VISUALIZE_FOG: RayFogBindings = {
  cubemap: SCENE_VISUALIZE_LIGHTS + 1,
  sampler: SCENE_VISUALIZE_LIGHTS + 2,
}

/** The words of the parameters: the display's size, the reprojection radius scale and the least distance the fog of a ray that met nothing reaches (metres); the first and last distance of the trace (centimetres); the tile
 *  drawn (its corner and size in display pixels); then the flags: x the bits of `SCENE_VISUALIZE_FLAG` (the probes' far light, the finest pages, the sky share kept, the height fog, a tile with rounded corners), y whether the light goes through the composition's table. */
export const SCENE_VISUALIZE_PARAM_WORDS = 16
export const SCENE_VISUALIZE_FLAG = { cache: 1, hiRes: 2, sky: 4, fog: 8, tiled: 16 } as const

/** What a hit of the trace gives `seen` for mode `mode`: its light, or a debug colour in the cache's unit of light (`invPre`). */
function hitShadeWgsl(mode: number) {
  if (mode === VISUALIZE_MODE.geometryNormals)
    return '   seen=(surface.face*0.5+vec3f(0.5))*invPre;'
  if (mode === VISUALIZE_MODE.surfaceCache)
    // Pink where a mesh has cards that none covers the point, yellow where it has none.
    return '   seen=select(surface.radiance,select(vec3f(1.0,1.0,0.0),vec3f(1.0,0.0,1.0),scSeenMeshCards)*invPre,!surface.valid);'
  return visualizeHitIsColour(mode)
    ? '   seen=surface.radiance*invPre;'
    : '   seen=surface.radiance;'
}

/** How `seen` becomes the pixel for mode `mode`: through the composition's table, or, for the albedo and the vectors, in the unit of the image. */
function outputWgsl(mode: number) {
  switch (visualizeOutputOf(mode)) {
    case 'srgb':
      return ' return vec4f(saturate(linearToSrgb(seen/invPre)),1.0);'
    case 'raw':
      return ' return vec4f(saturate(seen/invPre),1.0);'
    default:
      return ' return vec4f(saturate(visualizeTonemap(seen,scene.flags.y!=0u)),1.0);'
  }
}

export const sceneVisualizeWgsl = (
  light: LightAtlasFormat,
  mode: number,
  feedback = false,
  compressed = false,
) =>
  wgslProgram(
    `${wgslConsts({ FIELD_MAP_BORDER })}
struct SceneParams{size:vec4f,trace:vec4f,tile:vec4f,flags:vec4u,}
@group(0) @binding(${SCENE_VISUALIZE_LIGHTS}) var<storage,read> directLights:DirectLights;
@group(0) @binding(${B.params}) var<uniform> scene:SceneParams;
@group(0) @binding(${B.maps}) var<uniform> field:array<vec4f,3>;
@group(0) @binding(${B.final}) var finalAtlas:texture_2d<${lightAtlasScalar(light)}>;
@group(0) @binding(${B.sky}) var skyAtlas:texture_2d<f32>;
${fieldMapReads(light)}
${RADIANCE_PROBE_SKY_SHARE}
struct SceneFar{radiance:vec3f,sky:f32,}
// What the probe at 'cell' of 'level' gives along the ray 'd' from the eye 'P', of a cone of 'size' texels of its map a side: the ray moved onto the sphere round the probe
// of the radius 'reprojection' times the nearest a ray of the level starts, the light scaled by t squared over the radius times the cosine; none where the cell holds no probe.
fn sceneProbe(level:u32,cell:vec3i,P:vec3f,d:vec3f,mip:f32)->SceneFar{
 let held=cacheSlotOf(level,cell);
 if(held==0u){return SceneFar(vec3f(0.0),0.0);}
 let slot=held-1u;
 let radius=scene.size.z*cacheMinTrace(level);
 let local=P-probePosition(cell,bounce.levels[level].spacing);
 let b=dot(d,local);
 let reach=b*b-(dot(local,local)-radius*radius);
 let t=select(-1.0,sqrt(max(reach,0.0))-b,reach>=0.0);
 let towards=local+d*t;
 let correction=t*t/(radius*dot(towards,d));
 var sky=0.0;
 if((scene.flags.x&${SCENE_VISUALIZE_FLAG.sky}u)!=0u){sky=visSky(slot,towards);}
 return SceneFar(fieldRadiance(slot,towards,mip)*correction,sky);
}
// The light of the probes round the eye along 'd', the cone 'spread' wide: the eight probes of the level that covers the eye, weighed by its fractions between them, the share
// of the rays that left the scene filled in with the sky.
fn sceneFar(level:u32,P:vec3f,d:vec3f,spread:f32)->vec3f{
 let res=field[1].z;
 let texels=sqrt(1.0-cos(atan(spread)))*res;
 let mip=clamp(log2(max(texels,1.0)),0.0,field[1].w-1.0);
 let corner=bounceRead(level,P).corner;
 let alpha=probeFraction(level,P);
 var out=SceneFar(vec3f(0.0),0.0);
 for(var i=0u;i<8u;i++){
  let share=mix(vec3f(1.0)-alpha,alpha,vec3f(f32(i&1u),f32((i>>1u)&1u),f32((i>>2u)&1u)));
  let weight=share.x*share.y*share.z;
  let s=sceneProbe(level,corner+vec3i(vec3u(i&1u,(i>>1u)&1u,(i>>2u)&1u)),P,d,mip);
  out.radiance+=s.radiance*weight;
  out.sky+=s.sky*weight;
 }
 if(out.sky>0.0&&skyLit()){out.radiance=mix(out.radiance,skyProbeRadiance(d),out.sky);}
 return out.radiance;
}
// Under an orthographic view every ray runs along the view's direction, from the point of the plane through the eye that its pixel falls on.
fn sceneOrtho()->bool{return bounce.forward.w!=0.0;}
fn sceneRay(pixel:vec2f)->vec3f{
 if(sceneOrtho()){return normalize(bounce.forward.xyz);}
 let ndc=pixelToNdc(pixel,scene.size.xy);
 return normalize(unprojectPoint(view.inverseViewProjection,vec3f(ndc,0.5))-view.camera.xyz);
}
fn sceneEye(pixel:vec2f)->vec3f{
 if(!sceneOrtho()){return view.camera.xyz;}
 let ndc=pixelToNdc(pixel,scene.size.xy);
 let on=unprojectPoint(view.inverseViewProjection,vec3f(ndc,0.5));
 let forward=normalize(bounce.forward.xyz);
 return on-forward*dot(on-view.camera.xyz,forward);
}
// Whether the pixel at 'local' of a tile is inside its rounded corners (a whole display has none).
fn sceneInside(local:vec2f)->bool{
 if((scene.flags.x&${SCENE_VISUALIZE_FLAG.tiled}u)==0u){return true;}
 let low=vec2f(${TILE_CORNER}.0);
 let high=scene.tile.zw-vec2f(${TILE_CORNER}.0+1.0);
 let away=max(max(low-local,local-high),vec2f(0.0));
 return length(away)-${TILE_CORNER}.0<0.5;
}
@fragment fn sceneVisualizeFs(@builtin(position) at:vec4f)->@location(0) vec4f{
 let local=at.xy-scene.tile.xy;
 if(!sceneInside(local)){discard;}
 // The tile shows the whole display, scaled to it.
 let pixel=local/scene.tile.zw*scene.size.xy;
 let eye=sceneEye(pixel);
 let d=sceneRay(pixel);
 // The cone of one pixel: the angle to the ray of its neighbour.
 let spread=length(sceneRay(pixel+vec2f(1.0,0.0))-d);
 var reach=scene.trace.y;
 var cover=CacheCoverage(0u,false,0.0);
 if((scene.flags.x&${SCENE_VISUALIZE_FLAG.cache}u)!=0u){
  cover=cacheCoverage(eye,0.5);
  if(cover.valid){reach=min(reach,cover.minTrace*f32(BOUNCE_CM));}
 }
 let invPre=max(scF(SC_AT_INV_PRE_EXPOSURE),1e-12);
 // 'seen' is the light in the unit the cache keeps it in, or, where the mode shows a debug colour, the colour times that unit: both are what the table shows as light.
 var seen=vec3f(0.0);
 var travelled=reach;
 var escaped=true;
 if(gdfView.clipmaps!=0u&&reach>scene.trace.x){
  let noise=interleavedGradientNoise(floor(pixel),f32(bounce.frame.z%8u));
  let start=eye*f32(BOUNCE_CM);
  let marched=gdfTraceRay(start,d,scene.trace.x,reach,mix(0.8,1.0,noise),false,false,vec2u(0u),0.0);
  if(marched.hitTime>=0.0){
   escaped=false;
   travelled=marched.hitTime;
   let surface=scGlobalHit(start,d,marched,spread,false,-1.0,(scene.flags.x&${SCENE_VISUALIZE_FLAG.hiRes}u)!=0u,vec2u(0u));
${hitShadeWgsl(mode)}
  }
 }
 if(escaped){
  if(cover.valid){seen=sceneFar(cover.level,eye,d,spread);}
  else{seen=skyProbeRadiance(d);}
 }
 ${visualizeOutputOf(mode) === 'radiance' ? `if((scene.flags.x&${SCENE_VISUALIZE_FLAG.fog}u)!=0u)` : 'if(false)'}{
  // A ray that met nothing is fogged over the least distance the sky is, so that the longest trace is no part of the fog.
  let metres=select(max(scene.size.w,travelled/f32(BOUNCE_CM)),travelled/f32(BOUNCE_CM),!escaped);
  seen=heightFogOver(seen,eye,d*metres);
 }
${outputWgsl(mode)}
}`,
    [
      DIRECT_LIGHT_WGSL,
      heightFogOverWgsl(SCENE_VISUALIZE_FOG.cubemap, SCENE_VISUALIZE_FOG.sampler),
      linearToSrgb,
      pixelToNdc,
      unprojectPoint,
      interleavedGradientNoise,
      equalAreaEncode,
      bilinear3,
      CACHE_WORDS_WGSL,
      BOUNCE_CM_WGSL,
      bounceBindingsWgsl(0, B.grid, B.table),
      ...lightReadDeps(light),
      visualizeTonemapWgsl(B.tone),
      skyLightReadWgsl(SCENE_VISUALIZE_SKY_LIGHT),
      SKY_READ_WGSL,
      surfaceHitWgsl(sceneVisualizeHit(mode, feedback, compressed), light),
      FULLSCREEN_VERTEX,
    ],
  )
