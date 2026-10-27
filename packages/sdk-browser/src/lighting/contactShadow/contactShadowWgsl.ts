import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ndcToPixel } from '../../../../math/src/wgsl/projection.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { SURFACE_WORDS } from '../../materials/surface/surfaceOutputs.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../materials/surface/pixelModel.ts'
import { SHADING_MODEL_STATE_WGSL } from '../direct/shadingModelState.ts'
import { VSM_CM_PER_UNIT } from '../shadows/vsm/constants.ts'
import { subsurfaceDensity } from '../subsurfaceDensity.ts'

/** The steps of a contact shadow's ray, and the margin they hit within, in steps' depth. */
const CONTACT_STEPS = 8
const COMPARE_TOLERANCE_SCALE = 2
/** The ray of an eye pixel, whatever the light: half a centimetre; of a hair pixel under a light with no
 *  shadow, this share of the screen's half height at its depth. */
const EYE_RAY_CM = 0.5
const HAIR_RAY = 0.2

/** What the rays of a pixel share, and the march of one: the pixel's clip point, own texel and depth, the dither,
 *  and the ray through eight steps of the scene's depth. */
const CONTACT_RAYS_WGSL = wgslBlock(
  'CONTACT_RAYS_WGSL',
  [ndcToPixel, interleavedGradientNoise],
  `
struct ContactHit{distance:f32,pixel:vec2i,}
var<private> contactHeld:bool=false;
var<private> contactPoint:vec3f;
var<private> contactStart:vec4f;
var<private> contactOwn:vec2i;
var<private> contactDepth:f32;
var<private> contactDither:f32;
var<private> contactScale:f32;
fn contactPixel(ndc:vec2f)->vec2i{
 return clamp(vec2i(ndcToPixel(ndc,view.viewport.xy)),vec2i(0),vec2i(view.viewport.xy)-vec2i(1));
}
/** What the rays of a pixel share, taken at the first ray: the clip point of \`P\`, its own pixel and depth, the
 *  dither, and the world length of a screen unit there (an orthographic camera's is 1). */
fn contactHold(P:vec3f){
 if(contactHeld&&all(contactPoint==P)){return;}
 contactHeld=true;
 contactPoint=P;
 contactStart=view.viewProjection*vec4f(P,1.0);
 contactOwn=contactPixel(contactStart.xy/contactStart.w);
 contactDepth=textureLoad(depth,contactOwn,0);
 contactDither=interleavedGradientNoise(vec2f(contactOwn)+0.5,f32(u32(view.jitter.w)&7u));
 contactScale=select(view.contact.w*dot(P-view.camera.xyz,view.contact.xyz),1.0,view.camera.w==0.0);
}
fn contactRay(L:vec3f,ray:f32,hairNoShadow:bool)->ContactHit{
 let end=contactStart+view.viewProjection*vec4f(L*ray,0.0);
 let deeper=contactStart+view.viewProjection*vec4f(view.contact.xyz*ray,0.0);
 let origin=contactStart.xyz/contactStart.w;
 let along=end.xyz/end.w-origin;
 let tolerance=abs(deeper.z/deeper.w-origin.z)*${wgslF32(COMPARE_TOLERANCE_SCALE / CONTACT_STEPS)};
 var time=(contactDither-0.5)/${CONTACT_STEPS}.0+1.0/${CONTACT_STEPS}.0;
 for(var i=0;i<${CONTACT_STEPS};i++){
  let at=origin+along*time;
  let pixel=contactPixel(at.xy);
  let seen=textureLoad(depth,pixel,0);
  if(seen!=contactDepth||hairNoShadow){
   if(abs(at.z-seen+tolerance)<tolerance){
    return ContactHit(select(-1.0,ray*time,all(abs(at.xy)<vec2f(1.0))),pixel);
   }
  }
  time+=1.0/${CONTACT_STEPS}.0;
 }
 return ContactHit(-1.0,contactOwn);
}`,
)

/** The light's share past what stands against the surface, along `L` (`contactShadow`). */
const shadowOf = (models: boolean) => {
  const { subsurface, skin, hair, eye } = PIXEL_MODEL
  return `fn contactShadow(light:DirectLight,P:vec3f,L:vec3f,casts:bool)->f32{
 let record=light.contactGi;
 var ray=0.0;
 if(casts&&record.x!=0.0){contactHold(P);ray=abs(record.x)*select(contactScale,1.0,record.x<0.0);}${
   models
     ? `
 if(!casts&&pixelModel==${hair}u){contactHold(P);ray=${wgslF32(HAIR_RAY)}*contactScale;}
 if(pixelModel==${eye}u){ray=${wgslF32(EYE_RAY_CM / VSM_CM_PER_UNIT)};}`
     : ''
 }
 if(ray<=0.0){return 1.0;}
 contactHold(P);
 let hit=contactRay(L,ray,${models ? `!casts&&pixelModel==${hair}u` : 'false'});
 if(hit.distance<=0.0){return 1.0;}
 let flags=textureLoad(words,hit.pixel,${SURFACE_WORDS.flags},0).r;
 var occlusion=select(record.z,record.y,pixelModelOf(flags)!=${eye}u);${
   models
     ? `
 if(occlusion>0.0&&(pixelModel==${subsurface}u||pixelModel==${skin}u||(pixelModel==0u&&thinSurface()))){
  let opacity=select(textureLoad(subsurfaceColor,contactOwn).a,modelOpacity,pixelModel!=0u);
  occlusion*=1.0-saturate(exp(-subsurfaceDensity(opacity)*hit.distance*${VSM_CM_PER_UNIT}.0));
 }`
     : ''
 }
 return 1.0-occlusion;
}`
}

/**
 * `contactShadow(light, P, L, casts)`: the share of a light that gets past what stands against the
 * surface at `P`, along the unit direction `L` toward its centre — 1 where no ray is cast or none hits.
 * The ray is eight steps through the scene's depth; its length is the light's (`DirectLight.contactGi`,
 * packed as `writeContactShadow` says) where the light `casts` a shadow, and the models' where `models`
 * (an eye's, a hair's under a light that casts none). Binds the pass's `depth`, `words` and, with the
 * models, `subsurfaceColor`; the view's `viewProjection`, `contact`.
 */
export const contactShadowWgsl = (models: boolean) =>
  wgslBlock(
    `contactShadowWgsl(${models})`,
    [CONTACT_RAYS_WGSL, pixelModelOf, SHADING_MODEL_STATE_WGSL, subsurfaceDensity],
    shadowOf(models),
  )
