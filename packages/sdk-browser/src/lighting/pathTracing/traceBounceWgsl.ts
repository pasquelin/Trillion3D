import {
  NO_SCENE_MASKS,
  sceneMaskKey,
  type SceneMaskPrograms,
} from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { strongIntegerHash } from '../sobolScramblingWgsl.ts'
import { pixelToNdc, unprojectPoint } from '../../../../math/src/wgsl/projection.ts'
import { SCENE_MASK_END, sceneMaskWgsl } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneHitCornersWgsl } from '../rays/sceneTrace/sceneHitCornersWgsl.ts'
import { PT_HIT_KIND, PT_HIT_WGSL } from './hitRecordWgsl.ts'
import { PT_T_MAX_WGSL } from './lightsWgsl.ts'
import { PT_AIR_FLAG } from './airMediumWgsl.ts'
import { PT_AIR_WGSL, PT_GROUND_CLASS } from './airWgsl.ts'
import { PT_CLOUD_MARCH_WGSL } from './cloudWgsl.ts'
import { PT_STATE_WGSL } from './pathWgsl.ts'
import { PT_CAPTURE, PT_ROUND_WGSL, PT_VIEW_FLAGS_WGSL, PT_VIEW_WGSL } from './viewWgsl.ts'

/** The words of a placement's record in the table of the surfaces the hits are shaded as: the surface's record in the material table, the row flags with and without the triangle's attributes,
 *  the class key with and without them, and the mask of the lighting channels of the root's object (word 5, which the view of the channels reads). */
export const PT_PLACEMENT_WORDS = 6

/** The class number of a hit no class shades: the path tracer's default surface stands in. */
export const PT_NO_CLASS = 0xffffff

/** The bindings of the scene trace's group in the trace stage, past the trace's and the any-hit test's: the placements' surfaces and the hits written. */
export const PT_TRACE_STAGE_BINDINGS = {
  placements: SCENE_MASK_END,
  hits: SCENE_MASK_END + 1,
} as const

/**
 * THE TRACE OF A BOUNCE (`ptTraceBounce(path, bounce, pixel, index)`): what a path's ray meets, written as the path's `PtHit` (`hitRecordWgsl.ts`) in `ptHits`, the surface's material left to the shade of the
 * hits. It draws the numbers the reference draws to choose among the hits of a run of translucent surfaces (so that the dimensions that follow stay where they are); the last bounce, with emissive
 * surfaces off, traces nothing and ends the path; where the air is traced the ray goes through it up to the nearest of the surface and the planet, through the clouds in the way too where they are traced (`clouds`, `ptVolumeTrack`), the throughput the walk begins with kept for the lamps' light of the volume (`PtPath.segment`, `pathTracingVolumeMISMode`); bounce 0 sends the camera's ray through the pixel point the path's jitter gives, ignoring the back faces of the surfaces as the raster does (the view of the kind of hit keeps them); every ray goes through the scene (`stTrace`, asking the barycentric
 * weights) and what it meets is given its attributes at the point (`stHitSurface`: texture coordinate, shading normal, vertex colour; the material is read at the finest of its textures, as the reference reads it with no derivative) and the surface its placement wears (`ptPlacements`, `PT_PLACEMENT_WORDS` a placement, its class by whether the triangle has attributes). A ray that meets
 * nothing escapes. Only the camera's ray meets a sky mesh (`ST_MEET_SKY`): the rays of the later bounces and the shadow rays go through it, to the sky light and to the miss, so the sky is not counted twice; none follows `rayTracingExcludeSky` (`ST_PATH_RAY`).
 */
export const PT_TRACE_BOUNCE_WGSL = (
  scene: { group: number; first: number },
  programs: SceneMaskPrograms = NO_SCENE_MASKS,
  clouds = false,
) =>
  wgslBlock(
    `PT_TRACE_BOUNCE_WGSL(${scene.group},${scene.first},${sceneMaskKey(programs)}${clouds ? ',clouds' : ''})`,
    [
      PT_VIEW_WGSL,
      PT_ROUND_WGSL,
      PT_VIEW_FLAGS_WGSL,
      strongIntegerHash,
      PT_STATE_WGSL,
      PT_HIT_WGSL,
      PT_T_MAX_WGSL,
      PT_AIR_WGSL,
      ...(clouds ? [PT_CLOUD_MARCH_WGSL] : []),
      pixelToNdc,
      unprojectPoint,
      sceneHitCornersWgsl(scene),
      sceneMaskWgsl(scene.group, scene.first, programs),
    ],
    `@group(${scene.group}) @binding(${scene.first + PT_TRACE_STAGE_BINDINGS.placements}) var<storage,read> ptPlacements:array<u32>;
@group(${scene.group}) @binding(${scene.first + PT_TRACE_STAGE_BINDINGS.hits}) var<storage,read_write> ptHits:array<vec4u>;
fn ptCameraRay(at:vec2f)->vec3f{
 let ndc=pixelToNdc(at,vec2f(ptView.image.xy));
 let near=unprojectPoint(ptView.inverseViewProjection,vec3f(ndc,1.0));
 let far=unprojectPoint(ptView.inverseViewProjection,vec3f(ndc,0.5));
 return normalize(far-near);
}
fn ptCameraOrigin(at:vec2f)->vec3f{
 let ndc=pixelToNdc(at,vec2f(ptView.image.xy));
 return unprojectPoint(ptView.inverseViewProjection,vec3f(ndc,1.0))-ptView.eye.xyz;
}
fn ptStoreHit(index:u32,h:PtHit){
 let words=ptPackHit(h);
 for(var k=0u;k<6u;k++){ptHits[index*6u+k]=words[k];}
}
/** The hit of a path that has ended: nothing, which the shade and the finish of the bounce leave alone. */
fn ptEndHit(index:u32){
 var h:PtHit;
 h.kind=${PT_HIT_KIND.ended}u;
 ptStoreHit(index,h);
}
fn ptTraceBounce(path:ptr<function,PtPath>,bounce:u32,pixel:vec2i,index:u32){
 let maxBounces=ptView.seeds.y;
 // A later round of a bounce goes on along the ray that went through a surface: only the first round sends the camera's ray.
 let camera=bounce==0u&&ptRound()==0u;
 // The numbers the reference draws to choose among the hits of a run of translucent surfaces: drawn all the same, once a bounce.
 if(ptRound()==0u){
  // The first of them opens the reservoir that chooses among the scattering events of the air and the surface the ray meets.
  (*path).ris=ptRand3(&(*path).rand).x;
  (*path).risSum=0.0;
  (*path).eventThroughput=vec3f(0.0);
 }
 if(bounce==maxBounces&&!ptEmissive()){ptEndHit(index);return;}
 var h:PtHit;
 if(camera){
  let at=vec2f(pixel)+(*path).jitter;
  (*path).direction=ptCameraRay(at);
  (*path).origin=ptCameraOrigin(at);
 }
 let hit=stTrace(StRay((*path).origin,(*path).direction,0.0,PT_T_MAX,select(ST_MEET_TRANSLUCENT,0u,ptSkipsTranslucent())|select(0u,ST_CULL_BACK,bounce==0u&&!ptKeepsBackFaces())|ST_PATH_RAY|select(0u,ST_MEET_SKY,bounce==0u)|ST_BARYCENTRIC));
 if(ptAirOn()){
  // The air: the planet is a surface to the rays that the air has scattered (and to the camera's where the setting says), and the ray goes through the air up to the nearest of it, the surface and the planet.
  let ray=ptAirRayOf((*path).origin,(*path).direction);
  let span=ptAirSpan(ray);
  var reach=select(PT_T_MAX,hit.distance,hit.hit);
  let sees=(*path).scatter==PT_SCATTER_VOLUME||(ptAtmo.options.x&${PT_AIR_FLAG.ground}u)!=0u;
  let ground=sees&&span.ground>0.0&&span.ground<reach;
  if(ground){reach=span.ground;}
  // The throughput the walk begins with: the lamps light the stretch of the volume from it.
  if(ptAirVolumeLights()){(*path).segment=(*path).throughput;}
  ${clouds ? 'ptVolumeTrack' : 'ptAirTrack'}(path,ray,(*path).origin,(*path).direction,span.near,min(span.far,reach),bounce==0u,bounce==maxBounces);
  if(ground){
   let centre=vec3f(ray.q.x,ray.q.y+ptAirBottom(),ray.q.z)+(*path).direction*(reach*0.001);
   h.kind=${PT_HIT_KIND.surface}u;
   h.position=(*path).origin+(*path).direction*reach;
   h.distance=reach;
   h.geoNormal=normalize(centre);
   h.normal=h.geoNormal;
   h.front=true;
   h.classKey=${PT_GROUND_CLASS}u;
   ptStoreHit(index,h);
   return;
  }
 }
 if(!hit.hit){
  h.kind=${PT_HIT_KIND.escaped}u;
  h.distance=PT_T_MAX;
  ptStoreHit(index,h);
  return;
 }
 let surface=stHitSurface(hit);
 h.kind=${PT_HIT_KIND.surface}u;
 h.position=(*path).origin+(*path).direction*hit.distance;
 h.distance=hit.distance;
 h.geoNormal=hit.normal;
 h.normal=surface.normal;
 h.uv=surface.uv;
 h.edge1=surface.edge1;
 h.edge2=surface.edge2;
 h.colour=surface.colour;
 h.uvEdge1=surface.uvEdge1;
 h.uvEdge2=surface.uvEdge2;
 h.bary=hit.bary;
 h.front=hit.frontFace;
 h.attributed=surface.attributed;
 let at=hit.placement*${PT_PLACEMENT_WORDS}u;
 h.material=ptPlacements[at];
 h.flags=select(ptPlacements[at+2u],ptPlacements[at+1u],h.attributed);
 h.classKey=select(ptPlacements[at+4u],ptPlacements[at+3u],h.attributed);
 // The views whose value only the trace knows keep it in the row flags and are shaded as no class: the hash of the instance (with the triangle's or the record's), or the object's lighting channels.
 let capture=ptCapture();
 if(capture!=0u){
  h.classKey=${PT_NO_CLASS}u;
  var bits=strongIntegerHash(hit.placement);
  if(capture==${PT_CAPTURE.triangle}u){bits+=strongIntegerHash(hit.triangle);}
  else if(capture==${PT_CAPTURE.cluster}u){bits+=strongIntegerHash(hit.record);}
  else if(capture==${PT_CAPTURE.channels}u){bits=ptPlacements[at+5u];}
  h.flags=bits;
 }
 ptStoreHit(index,h);
}`,
  )
