import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { blueNoiseWgsl } from '../../gpu/noise/blueNoiseWgsl.ts'
import { BLEND_TRACE_BINDINGS } from '../../gpu/bind/bindLayout.ts'
import { TRANSLUCENCY_SLABS } from './layout.ts'
import { STACKED_SAMPLE_WGSL, TV_SH_WGSL, TV_TEXEL_WGSL } from './frameWgsl.ts'
import { TRANSLUCENCY_LIGHTING_CODES_WGSL, translucencyLightingOf } from './modeWgsl.ts'
import { pixelModelOf } from '../../materials/surface/pixelModel.ts'

/** The volume's light at a point of a cascade, sampled trilinearly. */
const volumeFetchText = (
  sampler: string,
) => `/** The cascade's ambient light at the point \`uvw\` of its box (0 to 1 along each axis): one filtered sample. */
fn tvAmbient(cascade:u32,uvw:vec3f)->vec4f{
 return stackedSample(translucencyVolume,${sampler},uvw,uni.volumeRead.x,f32(tvSlab(cascade,0u)),${TRANSLUCENCY_SLABS}.0);
}
/** The cascade's directional light at the point \`uvw\` of its box: one filtered sample. */
fn tvDirectional(cascade:u32,uvw:vec3f)->vec3f{
 return stackedSample(translucencyVolume,${sampler},uvw,uni.volumeRead.x,f32(tvSlab(cascade,1u)),${TRANSLUCENCY_SLABS}.0).xyz;
}`

/** The noise moving the point a pixel reads the volume at. */
const VOLUME_OFFSET_TEXT = `/** The noise moving the point a pixel reads the volume at, cells (zero where the settings ask none): the blue noise of the
 *  pixel and the image, centred. */
fn tvPointOffset(pixel:vec2f)->vec3f{
 let radius=uni.volumeRead.y;
 if(radius<=0.0){return vec3f(0.0);}
 let frame=u32(uni.volumeRead.z);
 let at=vec2u(pixel);
 return (vec3f(blueNoiseVec2(at,frame),blueNoiseScalar(at,frame))-vec3f(0.5))*radius;
}`

/** The cascades read at a point, the part of a surface's light the plain read and the one that takes its object's shadow (`VOLUME_SELF_TEXT`) share: nothing where the volume is not made, else `ambient`, `directional` and `offset`. */
const VOLUME_SAMPLES_TEXT = ` if(uni.volumeRead.x==0.0){return vec3f(0.0);}
 let offset=tvPointOffset(pixel);
 let inner=(P+offset*uni.volumeScale[0].w-uni.volumeCorner[0].xyz)*uni.volumeScale[0].xyz;
 let outer=(P+offset*uni.volumeScale[1].w-uni.volumeCorner[1].xyz)*uni.volumeScale[1].xyz;
 // How much of the inner cascade counts: one inside it, zero at its edge, over a sixth of its size.
 let ramp=saturate((vec3f(0.5)-abs(inner-vec3f(0.5)))*6.0);
 let share=ramp.x*ramp.y*ramp.z;
 // Both cascades are always read and blended, the outer one fading in as the point nears the inner one's edge.
 let ambient=mix(tvAmbient(1u,outer),tvAmbient(0u,inner),share);
 var directional=vec3f(0.0);
 if(mode!=TL_NON_DIRECTIONAL){directional=mix(tvDirectional(1u,outer),tvDirectional(0u,inner),share);}
`

/** The light a surface gives back of the two cascades. */
const VOLUME_LIGHT_TEXT = `/** What a surface at \`P\`, of diffuse colour \`rgb\` and metalness \`metal\`, normal \`N\`, drawn at \`pixel\`, gives back of the light the
 *  volume holds: nothing where the volume is not made this image. \`mode\` is the surface's lighting mode. */
fn translucencyVolumeLight(rgb:vec3f,metal:f32,N:vec3f,P:vec3f,mode:u32,pixel:vec2f)->vec3f{
${VOLUME_SAMPLES_TEXT} // The light is written multiplied by the image's pre-exposure; the surface's colour is multiplied by it again when written.
 let diffuse=rgb*(1.0-metal)/uni.preExposure;
 return diffuse*tvIrradiance(ambient.rgb,directional,N,mode==TL_NON_DIRECTIONAL);
}`

/**
 * THE LIGHT A SURFACE TAKES FROM THE VOLUME (`translucencyVolumeLight`), in the fragment stage of a see-through
 * surface whose material is lit from it (`TRANSLUCENCY_LIGHTING_CODE`: `volume`, `volumetric` or
 * `volumetricNonDirectional`). The program names the volume's texture (`binding`, group 0: a sampled 3D
 * texture of half floats, `layout.ts`) and the trilinear sampler it is read through (`sampler`, the name the program declares it by) and the view's fields that say where the cascades lie (`BlendView`: `volumeCorner`,
 * `volumeScale`, `volumeRead` — the cells a side, 0 where the volume is not made this image, the radius of the
 * noise on the point read and the image's number).
 *
 * The point read is the surface's, moved by a noise of the pixel and the image, in cells, where the settings ask
 * (`translucencyVolumePositionOffsetRadius`: it breaks up the cells' squares, which the temporal pass averages). Each cascade is read
 * trilinearly, a filtered sample of its ambient light and, unless the surface takes the constant band alone, one of its directional light
 * (`stackedSample`); both cascades are always read and blended: the point's place in the inner cascade says how much of it counts: one
 * inside it, going to zero at its edge over a sixth of its size, the rest the outer cascade's. That is two samples a pixel, four where the
 * light has a direction. The light the volume holds is the surface's normal times the harmonic: the ambient constant band
 * times its band's share, the three linear bands, their colour the constant band's, times those of the normal,
 * never negative (`TV_SH_WGSL`); `volumetricNonDirectional` takes the constant band alone, whatever the normal.
 * The surface's diffuse colour — its colour, none for a metal — times that light is what the surface gives back,
 * divided by the pre-exposure the volume was written multiplied by (the colour the fragment writes is multiplied
 * by it again, `preExposedClipped`).
 */
export const translucencyVolumeReadWgsl = (binding: number, sampler: string) =>
  wgslBlock(
    `translucencyVolumeReadWgsl(${binding}, ${sampler})`,
    [
      TV_SH_WGSL,
      TV_TEXEL_WGSL,
      STACKED_SAMPLE_WGSL,
      TRANSLUCENCY_LIGHTING_CODES_WGSL,
      translucencyLightingOf,
      blueNoiseWgsl(0, BLEND_TRACE_BINDINGS.noise, BLEND_TRACE_BINDINGS.loadOnly),
    ],
    `@group(0) @binding(${binding}) var translucencyVolume:texture_3d<f32>;
${volumeFetchText(sampler)}
${VOLUME_OFFSET_TEXT}
${VOLUME_LIGHT_TEXT}`,
  )

/** The light a surface gives back of the two cascades, less the sun's part where its own object shadows it (`translucencyVolumeLightSelf`): the record is the item's
 *  (one more than its first texel in the packed table, 0 for none, `selfShadowRecordOf`), `V` the direction to the eye, `subsurface` the surface's subsurface colour and `thin` whether
 *  the pixel's shading model is the thin subsurface one (the backscattering is that model's alone). */
const VOLUME_SELF_TEXT = `/** What a surface at \`P\`, of diffuse colour \`rgb\`, metalness \`metal\`, normal \`N\` and subsurface colour \`subsurface\`, seen along \`V\`, of the thin subsurface model where \`thin\`, gives back of the light the volume holds
 *  once the sun's part is taken through the shadow its own object casts: the volume's light less the sun's light the density between the sun and the point removes (the
 *  alpha of the ambient light is the share of the sun that reached the cell), the point moved by the same noise, plus, for a subsurface surface, the sun's light
 *  scattered toward a viewer who looks at it, squared shadowing, a lobe of the material's exponent and the energy of a tighter lobe. */
fn translucencyVolumeLightSelf(rgb:vec3f,metal:f32,N:vec3f,P:vec3f,mode:u32,pixel:vec2f,V:vec3f,subsurface:vec3f,thin:bool,record:u32)->vec3f{
${VOLUME_SAMPLES_TEXT} let diffuse=rgb*(1.0-metal)/uni.preExposure;
 let volume=tvIrradiance(ambient.rgb,directional,N,mode==TL_NON_DIRECTIONAL);
 if(record==0u){return diffuse*volume;}
 let r=selfRecordAt(record-1u);
 // A shadow faded out completely leaves the light as the volume holds it.
 if(r.light.w<=0.0){return diffuse*volume;}
 let sun=selfShadowSun(r,P);
 let shadowing=selfShadowFactor(r,P+offset*uni.volumeScale[0].w);
 var back=vec3f(0.0);
 if(thin){
  let power=r.scales.w;
  back=subsurface*pow(saturate(dot(r.light.xyz,V)),power)*sun*((power+2.0)/8.0)*shadowing*shadowing*ambient.a;
 }
 let removed=sun*ambient.a*(vec3f(1.0)-shadowing);
 return back+diffuse*max(volume-removed*uni.preExposure,vec3f(0.0));
}`

/**
 * THE VOLUME READ OF A PROGRAM THAT READS ITS OBJECT'S SHADOW: the plain read (`translucencyVolumeReadWgsl`, whose `translucencyVolumeLight` stays for the layers the
 * programs light without a shadow) and `translucencyVolumeLightSelf` beside it, with `self` the declaration of the records and the filter
 * (`blend/objectShadow/objectShadowSelfWgsl.ts`). A program made without it holds none of this text.
 */
export const translucencyVolumeSelfReadWgsl = (binding: number, sampler: string, self: WgslDecl) =>
  wgslBlock(
    `translucencyVolumeSelfReadWgsl(${binding}, ${sampler})`,
    [translucencyVolumeReadWgsl(binding, sampler), pixelModelOf, self],
    VOLUME_SELF_TEXT,
  )
