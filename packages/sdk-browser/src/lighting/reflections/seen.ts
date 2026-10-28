import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { slabPerspective } from '../../../../math/src/wgsl/projection.ts'
import { SCREEN_MARCH_WGSL } from '../../visibility/hiz/gpu/screenMarch.ts'
import type { MarchLanes } from '../../visibility/hiz/gpu/screenMarchLanes.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { RADIANCE_ANSWER, REFLECTION_CLAMP_WGSL, REFLECTION_LOBE_WGSL } from './field.ts'
import { reflectionRayWgsl } from './ray.ts'
import { reflectionRayLightWgsl } from './rayLightWgsl.ts'
import { reflectionPastWgsl } from './past.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_DEPTH_BINDING } from './viewLayout.ts'

const seenText = (lanes: MarchLanes) => `fn reflectionThickness()->f32{
 return select(REFLECTION_THICKNESS,reflectionView.march.x/reflectionView.slab.x,slabPerspective(reflectionView.slab));
}
fn reflectionPlaneDepth(H:vec2f,cell:vec2f,plane:vec3f)->f32{return plane.x+dot(H-cell,plane.yz);}
fn reflectionSeenAnswer(P:vec3f,H:vec2f,along:f32,cell:vec2f,plane:vec3f,coord:vec2u,tested:bool)->RadianceAnswer{
 var seen=RadianceAnswer(vec3f(0.0),false,0.0);
 if(plane.x<=0.0){return seen;}
 let depth=reflectionPlaneDepth(H,cell,plane);
 let past=reflectionPast(worldAt(H,depth),H,depth);
 if(!past.valid){return seen;}
 let noise=reflectionEdgeNoise(coord);
 // A hit near the border of this image or of the last is the screen's to answer by chance: its vignette against the pixel's noise.
 if(reflectionHitVignette(H,past.pixel)<noise){return seen;}
 // A hit on what the last image did not show at that place (hidden, or moved) is not the screen's, but for the far trace's.
 if(tested&&!reflectionPastAgrees(past,noise,reflectionView.historyThickness)){return seen;}
 // The last lit image at the texel the hit lands in: one point of its level 0, as the denoiser averages it.
 seen.color=reflectionClampRay(reflectionLitAt(reflectionPastTexel(past)));
 seen.hit=true;
 seen.distance=distance(worldAt(H,along),P);
 return seen;
}
struct ReflectionSeen{answer:RadianceAnswer,left:f32,}
/** The march of the screen along a ray (\`reflectionRaySpan\`), \`live\` false for a thread with no ray to march, which still takes part in it (\`screenMarchLanes.ts\`). */
fn reflectionSeenMarch(ray:ReflectionRay,live:bool)->ScreenHit{
 return screenMarch(ray.o,ray.d,select(0.0,ray.end,live),reflectionThickness(),reflectionView.thickness,reflectionView.slab,reflectionView.scene.x,true${lanes === 'none' ? '' : ',reflectionView.taps.z'});
}
fn reflectionSeen(P:vec3f,N:vec3f,lobe:ReflectionLobe,ray:ReflectionRay,bias:f32,marched:ScreenHit,coord:vec2u)->ReflectionSeen{
 // Where the screen stopped knowing the ray: the last point the march proved it in front of the depth (on a hit it was rejected, the
 // walk resumes from there), as the chord from the surface's own point, not from the biased origin.
 let clear=P+N*bias+lobe.R*reflectionRayDistance(ray,marched.above);
 var out=ReflectionSeen(RadianceAnswer(vec3f(0.0),false,0.0),distance(P,clear));
 if(marched.t<0.0){return out;}
 let H=ray.o+ray.d*marched.t;
 out.answer=reflectionSeenAnswer(P,H.xy,H.z,marched.pixel,marched.plane,coord,true);
 if(out.answer.hit){out.left=out.answer.distance;}
 return out;
}`

const DISTANT_TEXT = `fn reflectionFarthest(cell:vec2i)->f32{
 if(hizLevelCount()<2){return hizOpaqueDepth(cell);}
 return hizCellFurthest(cell/vec2i(2),1);
}
fn reflectionLinearTrace(ray:ReflectionRay,dither:f32)->vec3f{
 let n=f32(reflectionView.scene.y);
 let total=ray.d*ray.end;
 let each=total/n;
 let first=ray.o+each*(dither+reflectionView.march.z);
 let perspective=slabPerspective(reflectionView.slab);
 let drop=select(ray.span*reflectionView.slab.z/reflectionView.slab.x,(ray.o.z-reflectionView.slab.y)*ray.span/(ray.wb+ray.span),perspective);
 let tolerance=max(select(0.0,abs(total.z),perspective),drop*reflectionView.march.y)/n;
 var last=0.0;
 for(var k=1u;k<=reflectionView.scene.y;k++){
  let at=first+each*f32(k);
  if(any(at.xy<vec2f(0.0))||any(at.xy>=view.viewport.xy)){break;}
  let depth=reflectionFarthest(vec2i(at.xy));
  let diff=at.z-depth;
  if(depth>0.0&&abs(diff+tolerance)<tolerance){
   return vec3f(first.xy+each.xy*(f32(k-1u)+saturate(last/(last-diff))),1.0);
  }
  last=diff;
 }
 return vec3f(0.0);
}
fn reflectionDistant(P:vec3f,N:vec3f,lobe:ReflectionLobe,coord:vec2u)->RadianceAnswer{
 let none=RadianceAnswer(vec3f(0.0),false,0.0);
 if(!reflectionDone(REFLECTION_DISTANT_TRACES)){return none;}
 let stop=reflectionView.reach.y;
 let start=reflectionDistantStart(P,lobe.R,stop);
 if(start>=stop){return none;}
 let ray=reflectionRaySpan(P,N,lobe,reflectionRayBias(P,N),start,stop);
 if(!(ray.end>0.0)){return none;}
 let hit=reflectionLinearTrace(ray,reflectionEdgeNoise(coord));
 if(hit.z==0.0){return none;}
 let cell=vec2i(hit.xy);
 let centre=vec2f(cell)+vec2f(0.5);
 let plane=hizPlane(cell);
 return reflectionSeenAnswer(P,hit.xy,reflectionPlaneDepth(hit.xy,centre,plane),centre,plane,coord,false);
}`

/**
 * THE SCREEN'S ANSWER to a ray (`reflectionSeen`, the far trace's `reflectionDistant`), from the view's depth and its last
 * lit image.
 *
 * `reflectionSeen`: the march (`screenMarch`, `visibility/hiz/gpu/screenMarch.ts`: by default the reference's walk, which gives a ray up behind a surface) of the ray along the lobe's
 * centre from the surface to the longest ray, in `ReflectionView.scene.x` iterations, over surfaces as thick as
 * `ReflectionView.march.x` of their depth (`reflectionThickness`, in pixels of footprint: under a perspective the share of
 * the depth over the pixel's own, under an orthographic projection the constant `REFLECTION_THICKNESS`). It answers what the lit
 * image holds where the ray meets the depth (`reflectionSeenAnswer`) and, beside it, where the screen stopped knowing
 * the ray (`left`, a distance along it): the hit's, or, where the ray met nothing, gave the screen up behind a surface
 * or spent its iterations, the last point the march proved it in front of the depth — where the scene's walk begins
 * (`reflectionScreenEnd`, `wgsl.ts`).
 * `reflectionSeenAnswer`: the hit at the screen point `H` on the plane `plane` of the depth cell `cell` — the hit on its
 * plane, the lit image's texel it lands in (`reflectionPast`, `past.ts`: where the point stood in the last image, a surface that moves by
 * itself by its own vector), read as one point of its level 0 (the denoiser averages the rays). It is a hit, or a miss that
 * goes to the next stage: a miss where the hit's vignette (`reflectionHitVignette`: the smaller of this image's and the one the light is
 * read from at the hit) is under the noise of the pixel `coord` (`reflectionEdgeNoise`), or — `tested`, the march's hits, not the far trace's — the depth the last image
 * kept at that place is not the depth the hit is expected at there (`reflectionPastAgrees`): a hit near
 * the border is answered by the screen only by chance, one on what the last image did not show there not at all, the scene stage taking the rest. A hit has no fade of its own, neither by its depth in the slab nor by the side its plane
 * faces: either gate turns on and off between neighbouring pixels at a thin surface, whose plane and slab depth jump from
 * one to the next, and breaks the reflection of a body the ray passes through into shards of its edges. Its radiance
 * is held to the ceiling of a ray (`reflectionClampRay`).
 *
 * `reflectionDistant`: the screen's far trace of a ray that left the scene the trace walks, from where `reflectionDistantStart` says —
 * the march's (`sceneTrace.ts`): where the ray leaves the outermost clipmap of the global distance field, pulled back by the share
 * of the trace a jittered step spans; the scene trace's (`sceneTraceHardware.ts`): where it leaves the trace's culling radius:
 * a LINEAR march of `ReflectionView.scene.y` equal steps of the ray's screen span, jittered by the pixel's noise and
 * the offset bias (`march.z`) — the noise the vignette is held against too —, each step read in the furthest depth of its 2 × 2 block (the pyramid's first level) — a hit
 * where the ray lies behind it by less than twice a tolerance, the steepest the depth changes along a step or `march.y` times
 * the depth the whole ray's length spans, never on the far plane —, placed where the segment between the last step and
 * this one crosses the depth. A hit is read as the march's (`reflectionSeenAnswer`); none, where the ray starts off the
 * image, is out of the setting's range, or the settings turn the far trace off.
 *
 * `stored`: how the depth the last image kept is bound (`reflectionPastWgsl`). `lanes`: how the march counts the lanes still walking (`screenMarchLanes.ts`),
 * for the minimum occupancy (`ReflectionView.taps.z`) under which it gives the ray up; `none`, no such test.
 */
export const reflectionSeenWgsl = (group: number, stored = false, lanes: MarchLanes = 'none') =>
  wgslBlock(
    `reflectionSeenWgsl(${group},${stored},${lanes})`,
    [
      RADIANCE_ANSWER,
      REFLECTION_CLAMP_WGSL,
      REFLECTION_LOBE_WGSL,
      reflectionRayWgsl(group, lanes),
      reflectionRayLightWgsl(group, stored),
      reflectionPastWgsl(group, stored),
      REFLECTION_REACH_WGSL,
      SCREEN_MARCH_WGSL(group, REFLECTION_DEPTH_BINDING, lanes),
      REFLECTION_CONSTANTS_WGSL,
      slabPerspective,
    ],
    `${seenText(lanes)}\n${DISTANT_TEXT}`,
  )
