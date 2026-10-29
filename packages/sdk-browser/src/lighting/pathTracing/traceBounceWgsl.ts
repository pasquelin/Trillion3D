import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { pixelToNdc, unprojectPoint } from '../../../../math/src/wgsl/projection.ts'
import { sceneHitCornersWgsl } from '../rays/sceneTrace/sceneHitCornersWgsl.ts'
import { PT_HIT_KIND, PT_HIT_WGSL } from './hitRecordWgsl.ts'
import { PT_T_MAX_WGSL } from './lightsWgsl.ts'
import { PT_STATE_WGSL } from './pathWgsl.ts'
import { PT_ROUND_WGSL, PT_VIEW_WGSL } from './viewWgsl.ts'

/** The words of a placement's record in the table of the surfaces the hits are shaded as: the surface's record in the material table, the row flags with and without the triangle's attributes,
 *  and the class key with and without them. */
export const PT_PLACEMENT_WORDS = 5

/** The class number of a hit no class shades: the path tracer's default surface stands in. */
export const PT_NO_CLASS = 0xffffff

/** The bindings of the scene trace's group in the trace stage, past the trace's four: the triangles' corners, the placements' surfaces and the hits written. */
export const PT_TRACE_STAGE_BINDINGS = { corners: 4, placements: 5, hits: 6 } as const

/**
 * THE TRACE OF A BOUNCE (`ptTraceBounce(path, bounce, pixel, index)`): what a path's ray meets, written as the path's `PtHit` (`hitRecordWgsl.ts`) in `ptHits`, the surface's material left to the shade of the
 * hits. It draws the numbers the reference draws to choose among the hits of a run of translucent surfaces (so that the dimensions that follow stay where they are); the last bounce, with emissive
 * surfaces off, traces nothing and ends the path; bounce 0 sends the camera's ray through the pixel point the path's jitter gives; every ray goes through the scene (`stTrace`, asking the barycentric
 * weights) and what it meets is given its attributes at the point (`stHitSurface`: texture coordinate, shading normal, vertex colour; the material is read at the finest of its textures, as the reference reads it with no derivative) and the surface its placement wears (`ptPlacements`, `PT_PLACEMENT_WORDS` a placement, its class by whether the triangle has attributes). A ray that meets
 * nothing escapes.
 */
export const PT_TRACE_BOUNCE_WGSL = (scene: { group: number; first: number }) =>
  wgslBlock(
    `PT_TRACE_BOUNCE_WGSL(${scene.group},${scene.first})`,
    [
      PT_VIEW_WGSL,
      PT_ROUND_WGSL,
      PT_STATE_WGSL,
      PT_HIT_WGSL,
      PT_T_MAX_WGSL,
      pixelToNdc,
      unprojectPoint,
      sceneHitCornersWgsl(scene, { binding: scene.first + PT_TRACE_STAGE_BINDINGS.corners }),
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
 if(ptRound()==0u){ptRand3(&(*path).rand);}
 if(bounce==maxBounces&&ptView.flags.x==0u){ptEndHit(index);return;}
 var h:PtHit;
 if(camera){
  let at=vec2f(pixel)+(*path).jitter;
  (*path).direction=ptCameraRay(at);
  (*path).origin=ptCameraOrigin(at);
 }
 let hit=stTrace(StRay((*path).origin,(*path).direction,0.0,PT_T_MAX,ST_MEET_TRANSLUCENT|ST_BARYCENTRIC));
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
 ptStoreHit(index,h);
}`,
  )
