import { type WgslDecl, wgslBlock, wgslFn, wgslVariants } from '../../../../math/src/wgsl/decl.ts'
import { ndcToPixel } from '../../../../math/src/wgsl/projection.ts'
import { interleavedGradientNoise } from '../../../../math/src/wgsl/sampling.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { PIXEL_MODEL, pixelModelOf } from '../../materials/surface/pixelModel.ts'
import { noContactShadow } from '../../materials/surface/surfaceModel.ts'
import { LIGHT_SHADOWED_WGSL } from '../direct/lightReachWgsl.ts'
import { SHADING_MODEL_STATE_WGSL } from '../direct/shadingModelState.ts'
import { BEND_MAX_LAYERS } from './bendDispatches.ts'
import { VSM_CM_PER_UNIT } from '../shadows/vsm/constants.ts'
import { subsurfaceDensity } from '../subsurfaceDensity.ts'

/** The steps of a contact shadow's ray, and the margin they hit within, in steps' depth. */
const CONTACT_STEPS = 8
const COMPARE_TOLERANCE_SCALE = 2
/** The ray of an eye pixel, whatever the light: half a centimetre. */
const EYE_RAY_CM = 0.5
/** The ray, in the screen's half heights at the pixel's depth, of a hair pixel under a light with no dynamic shadow and of
 *  a surface whose material asks (`ContactRays`). */
const SCREEN_RAY = 0.2

/** Whether the surface of flags `flags`, where a ray hit, casts a contact shadow: its object does not let the rays
 *  through and it is not of the eye model. */
export const hitCastsContactShadow = wgslFn(
  'hitCastsContactShadow',
  [noContactShadow, pixelModelOf],
  `fn hitCastsContactShadow(flags:u32)->bool{return !noContactShadow(flags)&&pixelModelOf(flags)!=${PIXEL_MODEL.eye}u;}`,
)

/** The rays a pass casts (`contactShadowWgsl`): `lights`, the lights' own (`DirectLight.contactGi`); `models`, those and the
 *  shading models' too (a hair's, an eye's); `asked`, the one short ray of a surface whose material asks for contact shadows,
 *  and no other. */
export type ContactRays = 'lights' | 'models' | 'asked'

/** The part of the name of a program whose contact shadows are the asked ray's alone. */
export const raysLabel = (rays: ContactRays) => (rays === 'asked' ? ', asked contact shadows' : '')

/** The share of a hit's occlusion that a pixel of a subsurface model or a thin sheet keeps along the hit distance
 *  `distance`: a pass whose pixels may wear a model reads the thin target for it; the translucent passes' (`asked`) have
 *  no model, only a thin sheet, whose opacity is the material's (`contactOpacity`, of the material the ask names), read at a hit. */
const contactAttenuation = wgslVariants((asked: boolean) =>
  wgslFn(
    'contactAttenuation',
    [SHADING_MODEL_STATE_WGSL, subsurfaceDensity],
    `fn contactAttenuation(occlusion:f32,distance:f32)->f32{
 if(occlusion>0.0&&${
   asked
     ? 'thinSurface()'
     : `(pixelModel==${PIXEL_MODEL.subsurface}u||pixelModel==${PIXEL_MODEL.skin}u||(pixelModel==0u&&thinSurface()))`
 }){
  let opacity=${asked ? 'contactOpacity(contactMaterial)' : 'select(textureLoad(subsurfaceColor,contactOwn).a,modelOpacity,pixelModel!=0u)'};
  return occlusion*(1.0-saturate(exp(-subsurfaceDensity(opacity)*distance*${VSM_CM_PER_UNIT}.0)));
 }
 return occlusion;
}`,
  ),
)

/** What the rays of a pixel share, and the march of one: the pixel's clip point, own texel and depth, the dither, and the
 *  ray through eight steps of the scene's depth, which the pass gives (`contactSceneDepth`, `contactSceneFlags`). Asked, the
 *  margin of the one ray every light casts is worked out with the pixel's. */
const contactRaysWgsl = wgslVariants((asked: boolean) =>
  wgslBlock(
    `CONTACT_RAYS_WGSL(${asked})`,
    [ndcToPixel, interleavedGradientNoise],
    `
struct ContactHit{distance:f32,pixel:vec2i,}
var<private> contactHeld:bool=false;
var<private> contactPoint:vec3f;
var<private> contactStart:vec4f;
var<private> contactOrigin:vec3f;
var<private> contactOwn:vec2i;
var<private> contactDepth:f32;
var<private> contactDither:f32;
var<private> contactScale:f32;${asked ? '\nvar<private> contactAskedTolerance:f32;' : ''}
fn contactPixel(ndc:vec2f)->vec2i{
 return clamp(vec2i(ndcToPixel(ndc,view.viewport.xy)),vec2i(0),vec2i(view.viewport.xy)-vec2i(1));
}
/** The margin a ray of length \`ray\` hits within: its depth span at the pixel, in steps' depth. */
fn contactTolerance(ray:f32)->f32{
 let deeper=contactStart+view.viewProjection*vec4f(view.contact.xyz*ray,0.0);
 return abs(deeper.z/deeper.w-contactOrigin.z)*${wgslF32(COMPARE_TOLERANCE_SCALE / CONTACT_STEPS)};
}
/** What the rays of a pixel share, taken at the first ray: the clip point of \`P\`, its own pixel and depth, the
 *  dither and the world length of a screen unit there (an orthographic camera's is 1)${asked ? ', and the margin of the asked ray, the same for every light' : ''}. */
fn contactHold(P:vec3f){
 if(contactHeld&&all(contactPoint==P)){return;}
 contactHeld=true;
 contactPoint=P;
 contactStart=view.viewProjection*vec4f(P,1.0);
 contactOrigin=contactStart.xyz/contactStart.w;
 contactOwn=contactPixel(contactOrigin.xy);
 contactDepth=contactSceneDepth(contactOwn);
 contactDither=interleavedGradientNoise(vec2f(contactOwn),f32(u32(view.jitter.w)&7u));
 contactScale=select(view.contact.w*dot(P-view.camera.xyz,view.contact.xyz),1.0,view.camera.w==0.0);${asked ? `\n contactAskedTolerance=contactTolerance(${wgslF32(SCREEN_RAY)}*contactScale);` : ''}
}
fn contactRay(L:vec3f,ray:f32,hairNoShadow:bool)->ContactHit{
 let end=contactStart+view.viewProjection*vec4f(L*ray,0.0);
 let along=end.xyz/end.w-contactOrigin;
 let tolerance=${asked ? 'contactAskedTolerance' : 'contactTolerance(ray)'};
 var time=(contactDither-0.5)/${CONTACT_STEPS}.0+1.0/${CONTACT_STEPS}.0;
 for(var i=0;i<${CONTACT_STEPS};i++){
  let at=contactOrigin+along*time;
  let pixel=contactPixel(at.xy);
  let seen=contactSceneDepth(pixel);
  if(seen!=contactDepth||hairNoShadow){
   if(abs(at.z-seen+tolerance)<tolerance){
    return ContactHit(select(-1.0,ray*time,all(abs(at.xy)<vec2f(1.0))),pixel);
   }
  }
  time+=1.0/${CONTACT_STEPS}.0;
 }
 return ContactHit(-1.0,contactOwn);
}`,
  ),
)

/** The rest of a ray's work once it is cast, the same for every pass: its first hit's occlusion, by what the hit surface is. */
const HIT_OCCLUSION = `
 if(hit.distance<=0.0){return 1.0;}
 var occlusion=select(record.z,record.y,hitCastsContactShadow(contactSceneFlags(hit.pixel)));`

/** The light's own ray, where it casts one: its record and whether its dynamic shadow asks one (`own`), and its length in the pass's
 *  units (a negative record is a length in the scene's own). */
const OWN_RAY = `
 let record=light.contactGi;
 let own=bits==SHADOWED_DYNAMIC&&record.x!=0.0;`
const OWN_LENGTH = 'abs(record.x)*select(contactScale,1.0,record.x<0.0)'

export interface ContactBendBindings {
  /** The array's binding. */
  readonly array: number
  /** The binding of the uniform of the ranks of its layers. */
  readonly ranks: number
}
/**
 * THE SCREEN-SPACE SHADOW A LIGHT'S MARCH LEFT (`contactShadowMethod` 1, `bendPass.ts`), read at the pixel in place of the stochastic ray: a
 * texture array of group 0 and the uniform of the ranks of its layers (a layer for each light marched, `ContactBendBindings`), 1 where lit. A light's layer is
 * found by its rank before its term (\`contactBendSet\`); \`contactBendLayer\` is −1 where the light has none — the image marched none (the texture is one texel,
 * a stand-in), or not this light — and the light then casts its stochastic ray.
 */
const BEND_BLOCKS = new Map<string, WgslDecl>()
const contactBendWgsl = ({ array, ranks }: ContactBendBindings) => {
  const key = `${array} ${ranks}`
  let block = BEND_BLOCKS.get(key)
  if (!block)
    BEND_BLOCKS.set(
      key,
      (block = wgslBlock(
        `contactBendWgsl(${array}, ${ranks})`,
        [],
        `@group(0) @binding(${array}) var contactBend:texture_2d_array<f32>;
@group(0) @binding(${ranks}) var<uniform> contactBendRanks:array<vec4u,${BEND_MAX_LAYERS / 4}>;
var<private> contactBendLayer:i32=-1;
fn contactBendSet(rank:u32){
 contactBendLayer=-1;
 if(textureDimensions(contactBend).x<=1u){return;}
 for(var layer=0u;layer<${BEND_MAX_LAYERS}u;layer++){
  let held=contactBendRanks[layer>>2u][layer&3u];
  if(held==rank){contactBendLayer=i32(layer);return;}
  if(held==0xffffffffu){return;}
 }
}
fn contactBendRead(pixel:vec2i)->f32{return textureLoad(contactBend,pixel,contactBendLayer,0).r;}`,
      )),
    )
  return block
}

/** What each mode of rays (`ContactRays`) is made of: `head`, the statements that decide the ray (its length `ray`, with `record`
 *  the light's `contactGi`) or return the light's whole term where it casts none; `hairNoShadow`, the test a march lets a hair strand
 *  of a light with no dynamic shadow (`bits`) hit what shares its depth by; whether the hit's occlusion is weighed by what the hit sheet
 *  lets through (`attenuated`); and the declarations that come with it. */
const MODES = (bend: boolean) => {
  const { hair, eye } = PIXEL_MODEL
  const hairNoShadow = `bits==SHADOWED_NONE&&pixelModel==${hair}u`
  return {
    lights: {
      head: `${OWN_RAY}
 if(!own){return 1.0;}
 contactHold(P);${bend ? '\n if(contactBendLayer>=0){return contactBendRead(contactOwn);}' : ''}
 let ray=${OWN_LENGTH};`,
      hairNoShadow: 'false',
      attenuated: false,
      deps: [],
    },
    models: {
      head: `${OWN_RAY}
 let hair=bits!=SHADOWED_DYNAMIC&&pixelModel==${hair}u;
 let eye=pixelModel==${eye}u;
 if(!(own||hair||eye)){return 1.0;}
 contactHold(P);${bend ? '\n if(own&&!hair&&!eye&&contactBendLayer>=0){return contactBendRead(contactOwn);}' : ''}
 var ray=0.0;
 if(own){ray=${OWN_LENGTH};}
 if(hair){ray=${wgslF32(SCREEN_RAY)}*contactScale;}
 if(eye){ray=${wgslF32(EYE_RAY_CM / VSM_CM_PER_UNIT)};}`,
      hairNoShadow,
      attenuated: true,
      deps: [contactAttenuation(false)],
    },
    asked: {
      head: `
 if(!contactAsked){return 1.0;}
 let record=light.contactGi;
 contactHold(P);
 let ray=${wgslF32(SCREEN_RAY)}*contactScale;`,
      hairNoShadow,
      attenuated: true,
      deps: [contactAttenuation(true)],
    },
  } satisfies Record<
    ContactRays,
    { head: string; hairNoShadow: string; attenuated: boolean; deps: WgslDecl[] }
  >
}

/** The light's share past what stands against the surface, along `L` (`contactShadow`). A ray is cast only where the
 *  conditions the reference gives hold; each ray is cast once, the pixel's shared work done once. */
const shadowOf = (
  rays: ContactRays,
  bend: boolean,
) => `fn contactShadow(light:DirectLight,P:vec3f,L:vec3f,bits:u32)->f32{${MODES(bend)[rays].head}
 if(ray<=0.0){return 1.0;}
 let hit=contactRay(L,ray,${MODES(bend)[rays].hairNoShadow});${HIT_OCCLUSION}${
   MODES(bend)[rays].attenuated ? '\n occlusion=contactAttenuation(occlusion,hit.distance);' : ''
 }
 return 1.0-occlusion;
}`

/**
 * `contactShadow(light, P, L, bits)`: the share of a light that gets past what stands against the surface at `P`, along the
 * unit direction `L` toward its centre — 1 where no ray is cast or none hits. `bits` is the light's shadow bits
 * (`shadowBitsOf`): its own ray (`DirectLight.contactGi`) needs the dynamic one. By `rays` (`ContactRays`): with `models`, a hair's
 * ray goes to a light without it and an eye's to every light; `asked` casts the one short ray of the surface a pass says
 * asks (its private `contactAsked`), and no other. The pass gives the reads of the scene (`contactSceneDepth(pixel)`,
 * `contactSceneFlags(pixel)`). With `bend`, the binding of the screen-space shadows' array (`contactBendWgsl`): a light with a layer there takes
 * its shadow from it in place of the ray (`lights` and `models` rays alone).
 */
export const contactShadowWgsl = (rays: ContactRays, bend?: ContactBendBindings) =>
  wgslBlock(
    `contactShadowWgsl(${rays}${bend === undefined ? '' : `, bend ${bend.array} ${bend.ranks}`})`,
    [
      contactRaysWgsl(rays === 'asked'),
      hitCastsContactShadow,
      LIGHT_SHADOWED_WGSL,
      ...MODES(bend !== undefined)[rays].deps,
      ...(bend === undefined ? [] : [contactBendWgsl(bend)]),
    ],
    shadowOf(rays, bend !== undefined),
  )
