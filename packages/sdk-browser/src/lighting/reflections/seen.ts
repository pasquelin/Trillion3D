import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { clipToFramebuffer, slabPerspective } from '../../../../math/src/wgsl/projection.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { RADIANCE_ANSWER } from '../bounce/runtime/runtimeRadianceWgsl.ts'
import { SCREEN_MARCH_WGSL } from '../../visibility/hiz/gpu/screenMarch.ts'
import { REFLECTION_CONSTANTS_WGSL } from './constantsWgsl.ts'
import { reflectionFootprintWgsl } from './footprint.ts'
import { reflectionRayWgsl } from './ray.ts'
import { reflectionRayLightWgsl } from './rayLightWgsl.ts'
import { REFLECTION_REACH_WGSL } from './reach.ts'
import { REFLECTION_DEPTH_BINDING } from './viewLayout.ts'

const SEEN_TEXT = `fn reflectionThickness()->f32{
 return select(REFLECTION_THICKNESS,reflectionView.march.x/reflectionView.slab.x,slabPerspective(reflectionView.slab));
}
fn reflectionSlabAt(P:vec3f,R:vec3f,d:f32)->f32{return reflectionThickness()*reflectionPixelAt(P+R*d);}
fn reflectionSeenAnswer(P:vec3f,lobe:ReflectionLobe,H:vec2f,cell:vec2f,plane:vec3f)->RadianceAnswer{
 var seen=RadianceAnswer(vec3f(0.0),0.0,0.0);
 let size=view.viewport.xy;
 if(plane.x<=0.0){return seen;}
 let depth=plane.x+dot(H-cell,plane.yz);
 let hit=worldAt(H,depth);
 let previous=reflectionView.radianceViewProj*vec4f(hit,1.0);
 if(previous.w<=0.0){return seen;}
 let Q=clipToFramebuffer(previous,reflectionView.radiance.xy).xy;
 let edge=reflectionEdgeFade(H,size)*reflectionEdgeFade(Q,reflectionView.radiance.xy);
 let pixel=reflectionPixelAt(hit);
 let cone=reflectionConeAt(distance(hit,P),pixel,lobe);
 // How surely the hit is the screen's to answer: its share of the ray, the scene stage the rest.
 let trust=edge*reflectionLevelTrust(cone.level,reflectionView.radiance.z);
 if(!(trust>0.0)){return seen;}
 let ratio=size/reflectionView.radiance.xy;
 let toView=vec4f(cell-Q*ratio,vec2f(textureDimensions(reflectionImage))*ratio);
 // The hit's surface: its plane across the image, a footprint's width deep on either side.
 let surface=ReflectionSurface(cell,plane,max(depth-screenBack(depth,cone.long,reflectionView.slab),REFLECTION_FLOOR));
 let taps=reflectionFootprint(Q,hit,pixel,lobe,cone,toView,surface);
 if(!(taps.color.a>0.0)){return seen;}
 seen.color=reflectionClampRay(taps.color.rgb/taps.color.a);
 seen.confidence=trust*min(taps.color.a/taps.weight,1.0);
 seen.distance=distance(hit,P);
 return seen;
}
struct ReflectionSeen{answer:RadianceAnswer,left:f32,}
fn reflectionSeen(P:vec3f,N:vec3f,lobe:ReflectionLobe,bias:f32)->ReflectionSeen{
 let ray=reflectionRaySpan(P,N,lobe,bias,0.0,reflectionView.march.w);
 let marched=screenMarch(ray.o,ray.d,ray.end,reflectionThickness(),reflectionView.thickness,reflectionView.slab,reflectionView.scene.x,true);
 var out=ReflectionSeen(RadianceAnswer(vec3f(0.0),0.0,0.0),reflectionRayDistance(ray,marched.above));
 if(marched.t<0.0){return out;}
 let H=ray.o+ray.d*marched.t;
 out.answer=reflectionSeenAnswer(P,lobe,H.xy,marched.pixel,marched.plane);
 if(out.answer.confidence>0.0){out.left=out.answer.distance;}
 return out;
}`

const DISTANT_TEXT = `fn reflectionFarthest(cell:vec2i)->f32{
 if(hizLevelCount()<2){return hizOpaqueDepth(cell);}
 return hizCellFarthest(cell/vec2i(2),1);
}
fn reflectionLinearTrace(ray:ReflectionRay,dither:f32)->vec3f{
 let n=f32(reflectionView.detail.z);
 let total=ray.d*ray.end;
 let each=total/n;
 let first=ray.o+each*(dither+reflectionView.march.z);
 let perspective=slabPerspective(reflectionView.slab);
 let drop=select(ray.span*reflectionView.slab.z/reflectionView.slab.x,(ray.o.z-reflectionView.slab.y)*ray.span/(ray.wb+ray.span),perspective);
 let tolerance=max(select(0.0,abs(total.z),perspective),drop*reflectionView.march.y)/n;
 var last=0.0;
 for(var k=1u;k<=reflectionView.detail.z;k++){
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
 let none=RadianceAnswer(vec3f(0.0),0.0,0.0);
 let start=reflectionDistantStart(P,lobe.R);
 let stop=reflectionView.reach.w;
 if(!reflectionDone(REFLECTION_DISTANT_TRACES)||start>=stop){return none;}
 let ray=reflectionRaySpan(P,N,lobe,reflectionRayBias(P,N),start,stop);
 if(!(ray.end>0.0)){return none;}
 let hit=reflectionLinearTrace(ray,interleavedGradientNoise(vec2f(coord)+vec2f(0.5),0.0));
 if(hit.z==0.0){return none;}
 let cell=vec2i(hit.xy);
 return reflectionSeenAnswer(P,lobe,hit.xy,vec2f(cell)+vec2f(0.5),hizPlane(cell));
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
 * or spent its iterations, the last point the march proved it in front of the depth — where the scene's walk begins.
 * `reflectionSeenAnswer`: the hit at the screen point `H` on the plane `plane` of the depth cell `cell` — the hit on its
 * plane, its footprint (`reflectionFootprint`) and its confidence: how surely the screen answers — the fades of the
 * image's border (in this image and in the one the radiance is read from) and of the footprint's pyramid level
 * (`reflectionLevelTrust`) — times the share of the depth-weighted reads the image covers, continuous both: a hit near
 * the border answers part of its ray, the scene stage the rest, never a coin toss between the two that leaves the denoiser
 * a field of dots to average. A hit has no fade of its own, neither by its depth in the slab nor by the side its plane
 * faces: either gate turns on and off between neighbouring pixels at a thin surface, whose plane and slab depth jump from
 * one to the next, and breaks the reflection of a body the ray passes through into shards of its edges. Its radiance
 * is held to the ceiling of a ray (`reflectionClampRay`).
 * `reflectionSlabAt`: the thickness of a surface of the march at distance `d` along the ray from `P`, in metres.
 *
 * `reflectionDistant`: the screen's far trace of a ray that left the outermost cube of the field (`reflectionDistantStart`):
 * a LINEAR march of `ReflectionView.detail.z` equal steps of the ray's screen span, jittered by the pixel's noise and
 * the offset bias (`march.z`), each step read in the furthest depth of its 2 × 2 block (the pyramid's first level) — a hit
 * where the ray lies behind it by less than twice a tolerance, the steepest the depth changes along a step or `march.y` times
 * the depth the whole ray's length spans, never on the far plane —, placed where the segment between the last step and
 * this one crosses the depth. A hit is read as the march's (`reflectionSeenAnswer`); none, where the ray starts off the
 * image, is out of the setting's range, or the settings turn the far trace off.
 */
export const reflectionSeenWgsl = (group: number) =>
  wgslBlock(
    `reflectionSeenWgsl(${group})`,
    [
      RADIANCE_ANSWER,
      reflectionFootprintWgsl(group),
      reflectionRayWgsl(group),
      reflectionRayLightWgsl(group),
      REFLECTION_REACH_WGSL,
      SCREEN_MARCH_WGSL(group, REFLECTION_DEPTH_BINDING),
      REFLECTION_CONSTANTS_WGSL,
      clipToFramebuffer,
      slabPerspective,
      interleavedGradientNoise,
    ],
    `${SEEN_TEXT}\n${DISTANT_TEXT}`,
  )
