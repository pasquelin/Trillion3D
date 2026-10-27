import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { Frame3, frameAround, intoFrame, outOfFrame } from '../../../../../math/src/wgsl/basis.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { directionVisibility } from '../../../../../math/src/wgsl/lighting.ts'
import { INVERSE_PI, TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { equalAreaEncode, octWrapBorder } from '../../../../../math/src/wgsl/octahedral.ts'
import {
  bilinear1,
  bilinear3,
  hammersley16,
  rand3dPcg16,
  visibleGgxHalf,
} from '../../../../../math/src/wgsl/sampling.ts'
import { irradianceShader } from '../../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import {
  IRRADIANCE_PROBE_SIDE,
  SCREEN_PROBE_CONSTANTS,
} from '../../../../../sdk-core/src/bounce/screenProbeLevels.ts'
import { ditherLight, packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { PHYSICAL_SURFACE_FLAG } from '../../../materials/surface/physicalLobes.ts'
import { SURFACE_EMISSIVE_AO_WGSL } from '../../../materials/surface/surfaceEmission.ts'
import { LOBE_AXIS_WGSL } from '../../lobeAxisWgsl.ts'
import { BOUNCED_OCCLUSION } from './indirectWgsl.ts'
import { spCoefficientTexel } from './commonWgsl.ts'
import { spWeights } from './probesWgsl.ts'

/** Where the integration finds what it reads: the probes' pixels, each tile's adaptive probes (their count, their list), the
 *  probes' share of rays that move, their irradiance and their filtered radiance, the lobes of the pixels (the physical lobes target), the surfaces' base colour
 *  and metalness and their emission and occlusion; and the levels of detail their filtered radiance holds. */
interface IntegrateBindings {
  pixels: number
  header: number
  indices: number
  moving: number
  irradiance: number
  gather: number
  lobes: number
  base: number
  emissiveAo: number
  /** Whether the probes keep an extra ambient occlusion by normal (`screenProbeExtraAmbientOcclusion`): the alpha of their irradiance, whose harmonics then lie in
   *  the block of the octahedral map's size (`spCoefficientTexel`). */
  extraAo: boolean
  /** Whether the occlusion keeps its bent normal: the diffuse light is then read at the normal turned toward it, as far as the occlusion shuts the sky. */
  bentNormal: boolean
  /** The levels of detail the filtered radiance holds (`probeGather` is then one texture of that many levels, the finest with the border); one where the gather holds one level. */
  mips: number
}

/** The probes a pixel reads: their atlas places, their weights (normalised) and whether any weighs. */
const SP_PICKED = wgslBlock(
  'SP_PICKED',
  [spWeights],
  `struct SpPicked{atlas:array<vec2u,4>,weights:vec4f,valid:bool,}
fn spCornerProbe(tile:vec2u)->SpProbe{return spReadProbe(tile);}
struct SpBest{place:vec2u,weight:vec2f,found:bool,}
/** A corner whose weight falls under the minimum takes the best adaptive probe of its tile where one is better. */
fn spAdaptiveCorner(tile:vec2u,pixel:vec2u,s:SpSurface,depth:f32,weight:f32)->SpBest{
 var best=SpBest(tile,vec2f(weight,0.0),false);
 let at=tile.y*sp.grid.x+tile.x;
 for(var listed=0u;listed<min(header[at],SP_SAMPLES);listed++){
  let probeIndex=sp.counts.y+indices[at*SP_SAMPLES+listed];
  let place=spAtlasOf(probeIndex);
  let word=probePixels[probeIndex];
  let found=spAdaptiveWeight(pixel,s.P,s.N,depth,s.foliage,vec2u(word&0xffffu,word>>16u),spReadProbe(place).P);
  if(found.x>best.weight.x){best=SpBest(place,found,true);}
 }
 return best;
}
fn spPickProbes(pixel:vec2u,offset:vec2f,s:SpSurface,depth:f32)->SpPicked{
 let found=spInterpolation(pixel,offset,s.P,s.N,depth,s.foliage);
 var weights=found.w;
 var fallback=found.fallback;
 var atlas=array<vec2u,4>(found.tile,found.tile+vec2u(1u,0u),found.tile+vec2u(0u,1u),found.tile+vec2u(1u,1u));
 for(var corner=0u;corner<4u;corner++){
  atlas[corner]=min(atlas[corner],sp.grid.xy-vec2u(1u));
  if(weights[corner]>=SP_MIN_WEIGHT){continue;}
  let best=spAdaptiveCorner(atlas[corner],pixel,s,depth,weights[corner]);
  if(best.found){weights[corner]=best.weight.x;fallback[corner]=best.weight.y;atlas[corner]=best.place;}
 }
 var valid=dot(weights,vec4f(1.0))>=SP_MIN_WEIGHT;
 if(!valid){
  weights=fallback;
  valid=dot(weights,vec4f(1.0))>=SP_MIN_WEIGHT;
 }
 weights=select(vec4f(0.0),weights/max(dot(weights,vec4f(1.0)),SP_MIN_WEIGHT),valid);
 if(spFlag(SP_FLAG_STOCHASTIC)&&valid){
  var draw=min(blueNoiseScalar(pixel,sp.frames.y),0.99)*dot(weights,vec4f(1.0));
  var picked=0u;
  for(var corner=0u;corner<3u;corner++){
   if(draw>=weights[corner]){draw-=weights[corner];picked=corner+1u;}else{break;}
  }
  let only=atlas[picked];
  return SpPicked(array<vec2u,4>(only,only,only,only),vec4f(1.0,0.0,0.0,0.0),true);
 }
 return SpPicked(atlas,weights,valid);
}`,
)

/** The irradiance of the probes picked at a normal: their nine coefficients blended and evaluated once, or their octahedral maps read. */
const spPickedIrradianceWgsl = (extraAo: boolean) =>
  wgslBlock(
    `SP_PICKED_IRRADIANCE(${extraAo})`,
    [SP_PICKED, bilinear3, spCoefficientTexel(extraAo)],
    `const SP_OCT_SIDE:u32=${IRRADIANCE_PROBE_SIDE}u;
/** The octahedral irradiance of probe \`atlas\` at the unit direction \`n\`: its texels read bilinearly. */
fn spOctahedralIrradiance(atlas:vec2u,n:vec3f)->vec3f{
 let border=SP_OCT_SIDE+2u;
 let p=vec2f(atlas*border)+equalAreaEncode(n)*f32(SP_OCT_SIDE)+vec2f(0.5);
 let base=vec2i(floor(p));
 let a=textureLoad(probeIrradiance,base,0).rgb;
 let b=textureLoad(probeIrradiance,base+vec2i(1,0),0).rgb;
 let c=textureLoad(probeIrradiance,base+vec2i(0,1),0).rgb;
 let e=textureLoad(probeIrradiance,base+vec2i(1,1),0).rgb;
 return bilinear3(a,b,c,e,p-floor(p));
}
/** The nine coefficients of probe \`atlas\`, each scaled by \`weight\`, added into \`sum\`. */
fn spAddCoefficients(sum:ptr<function,array<vec3f,9>>,atlas:vec2u,weight:f32){
 for(var k=0u;k<9u;k++){
  (*sum)[k]+=textureLoad(probeIrradiance,spCoefficientTexel(atlas,k),0).rgb*weight;
 }
}
/** The factor of each band of the harmonics (\`x\` the constant, \`y\` the linear, \`z\` the quadratic) that cuts the cosine lobe to the cone of open sky an occlusion \`ao\` leaves (the zonal expansion of the cone). */
fn spVisibleBands(ao:f32)->vec3f{
 let cosA=sqrt(saturate(1.0-ao));
 let sinA=sqrt(saturate(1.0-cosA*cosA));
 return vec3f(sinA*sinA,1.0-cosA*cosA*cosA,sinA*sinA*(1.0+3.0*cosA*cosA));
}
/** The irradiance of the probes \`picked\` at the normal \`N\`, under the occlusion \`ao\` (one for none): the coefficients cut to the cone of open sky, or the octahedral irradiance times it. */
fn spPickedIrradiance(picked:SpPicked,N:vec3f,ao:f32)->vec3f{
 var places=picked.atlas;
 var irradiance=vec3f(0.0);
 if(spFlag(SP_FLAG_OCTAHEDRAL)){
  for(var corner=0u;corner<4u;corner++){
   if(picked.weights[corner]>0.0){irradiance+=spOctahedralIrradiance(places[corner],N)*picked.weights[corner];}
  }
  return irradiance*ao;
 }
 var sum=array<vec3f,9>();
 for(var corner=0u;corner<4u;corner++){
  if(picked.weights[corner]>0.0){spAddCoefficients(&sum,places[corner],picked.weights[corner]);}
 }
 let coefficients=sum;
 let bands=spVisibleBands(ao);
 return max(${irradianceShader((k) => `coefficients[${k}u]*bands.${k === 0 ? 'x' : k < 4 ? 'y' : 'z'}`, 'N')},vec3f(0.0));
}`,
  )

/** The `samples` of a pixel's rough specular: four, the reference's count. */
const ROUGH_SAMPLES = 4

/**
 * HOW MUCH OF A PIXEL'S ROUGH SPECULAR IS ITS DIFFUSE LIGHT (`spRoughLerp`): one where the traced rays give its reflection whole
 * (`reflectionView.lobe`: the roughness past which no ray is cast and the band under it; `reflectionView.reach.z` for a pixel with backface
 * diffuse light) and carries no physical lobes (`spLobed`: a clear coat,
 * whose base lobe no ray traces, or an anisotropy, which the flag does not tell from it; the flag is the one thing of the lobes a stage
 * that does not read them can see), and, past that, from the band under the roughness `sp.trace.z` (`sp.trace.w` for a pixel with backface
 * diffuse light) to the full width of 0.2 above it.
 */
export const SP_ROUGH_LERP = wgslBlock(
  'SP_ROUGH_LERP',
  [],
  `const SP_ROUGH_BAND:f32=0.2;
fn spLobed(flags:u32)->bool{return (flags&${PHYSICAL_SURFACE_FLAG}u)!=0u;}
fn spRoughLerp(roughness:f32,foliage:bool,lobed:bool)->f32{
 let traced=select(reflectionView.lobe.x,reflectionView.reach.z,foliage);
 if(!lobed&&saturate((traced-roughness)/max(reflectionView.lobe.y,1e-6))>=1.0){return 1.0;}
 let most=select(sp.trace.z,sp.trace.w,foliage);
 return saturate((roughness-most+SP_ROUGH_BAND)/SP_ROUGH_BAND);
}`,
)

/**
 * THE ROUGH SPECULAR of a pixel (`spRoughSpecular`): the light of its specular lobe, read from the probes' radiance instead of a
 * traced ray, for the pixels whose reflection the traced rays do not give whole. How much of it a pixel takes: it is blended to its
 * diffuse light over pi (the mean radiance of its hemisphere) by `spRoughLerp`. Else `ROUGH_SAMPLES` points of
 * the lobe are drawn (`visibleGgxHalf`, the visible normals of a GGX distribution of the roughness held to 0.2 at least, so that no
 * lobe is narrower than two texels of a sixteen-wide probe, round the pixel's normal — the base layer's, under a clear coat —, or, for a pixel with
 * an anisotropic lobe (the lobes target, `lobes`), the widths along and across its axis, in the frame of its axis), each by a Hammersley point scrambled by a hash of the pixel and the
 * image's rank modulo eight (the second dimension pulled a tenth toward the middle, away from the grazing normals), turned to the
 * direction a ray leaves the view by (`2 (V·H) H − V`), and read from the probes the pixel interpolates (`spProbeLight`: each probe's filtered radiance at
 * that direction, bilinear in its octahedron, the border wrapped as an octahedron's, weighed as the diffuse's are; where the gather holds levels of detail,
 * the nearest level the cone of a sample asks, `spRoughLevel`). Where the occlusion is
 * applied during the integration (`screenProbeShortRangeAOApplyDuringIntegration`, off by default), or the probes keep an extra ambient occlusion (`extraAo`),
 * the samples are multiplied by the share of its direction the pixel's open sky leaves (`directionVisibility`: the occlusion's bent normal and amount
 * against the hemisphere); else the lighting applies the occlusion to the rough specular once, after the blend (`screenSpecularOcclusion`). The samples are averaged tonemapped (`light / (1 + luminance)`), so that one bright texel does not flicker the pixel, and the mean
 * mapped back.
 */
const roughSpecularWgsl = (lobes: number, mips: number, extraAo: boolean) =>
  wgslBlock(
    `SP_ROUGH_SPECULAR(${lobes}, ${mips}, ${extraAo})`,
    [
      SP_PICKED,
      SP_ROUGH_LERP,
      bilinear3,
      equalAreaEncode,
      octWrapBorder,
      Frame3,
      frameAround,
      intoFrame,
      outOfFrame,
      hammersley16,
      rand3dPcg16,
      luminance,
      INVERSE_PI,
      visibleGgxHalf,
      directionVisibility,
      LOBE_AXIS_WGSL,
      TWO_PI,
    ],
    `@group(0) @binding(${lobes}) var lobesIn:texture_2d<u32>;
const SP_ROUGH_SAMPLES:u32=${ROUGH_SAMPLES}u;
const SP_ROUGH_MIN:f32=0.2;
const SP_ROUGH_BIAS:f32=0.9;
${
  mips === 1
    ? `/** The radiance of the probe at \`atlas\` along the point of its octahedron whose four texels round it start at \`base\` (the border's one past), \`f\` its fraction: bilinear. */
fn spProbeRadiance(atlas:vec2u,base:vec2i,f:vec2f)->vec3f{
 let res=sp.counts.w;
 var taps=array<vec3f,4>();
 for(var i=0u;i<4u;i++){
  let texel=vec2u(base+vec2i(i32(i&1u),i32(i>>1u))+vec2i(1));
  taps[i]=textureLoad(probeGather,vec2i(atlas*res+octWrapBorder(texel,res+2u,1u)),0).rgb;
 }
 return bilinear3(taps[0],taps[1],taps[2],taps[3],f);
}
/** The light the probes \`picked\` give along the direction \`d\`: each one's radiance there, weighed; the point of the octahedron and its texels are the same for every probe. */
fn spProbeLight(picked:SpPicked,d:vec3f)->vec3f{
 let q=equalAreaEncode(d)*f32(sp.counts.w)-vec2f(0.5);
 let base=vec2i(floor(q));
 let f=q-floor(q);
 var places=picked.atlas;
 var sum=vec3f(0.0);
 for(var corner=0u;corner<4u;corner++){
  if(picked.weights[corner]>0.0){sum+=spProbeRadiance(places[corner],base,f)*picked.weights[corner];}
 }
 return sum;
}`
    : `const SP_MIP_LEVELS:u32=${mips}u;
const SP_MIP_BORDER:u32=${2 ** (mips - 1)}u;
/** The level of detail the cone of one of the samples reads, the nearest (the reference's sampler takes a point filter between the levels): the cone is the
 *  solid angle of a quarter of the sphere's half, its width in texels of the gather the square root of its share of the sphere. */
fn spRoughLevel()->u32{
 let solidAngle=1.0/f32(SP_ROUGH_SAMPLES);
 let cosHalf=1.0-solidAngle/TWO_PI;
 let texels=sqrt(1.0-cosHalf)*f32(sp.counts.w);
 return u32(floor(clamp(log2(texels),0.0,f32(SP_MIP_LEVELS-1u))+0.5));
}
/** The radiance of the probe at \`atlas\` in the level \`level\` of its filtered radiance (the border wrapped already) at the point \`uv\` of its octahedron: bilinear. */
fn spProbeRadiance(level:u32,atlas:vec2u,uv:vec2f)->vec3f{
 let side=(sp.counts.w+2u*SP_MIP_BORDER)>>level;
 let at=vec2f(atlas*side)+(uv*f32(sp.counts.w)+vec2f(f32(SP_MIP_BORDER)))/f32(1u<<level)-vec2f(0.5);
 let base=vec2i(floor(at));
 let f=at-floor(at);
 var taps=array<vec3f,4>();
 for(var i=0u;i<4u;i++){
  taps[i]=textureLoad(probeGather,base+vec2i(i32(i&1u),i32(i>>1u)),i32(level)).rgb;
 }
 return bilinear3(taps[0],taps[1],taps[2],taps[3],f);
}
/** The light the probes \`picked\` give along the direction \`d\` in the level \`level\`: each one's radiance there, weighed. */
fn spProbeLight(picked:SpPicked,d:vec3f,level:u32)->vec3f{
 let uv=equalAreaEncode(d);
 var places=picked.atlas;
 var sum=vec3f(0.0);
 for(var corner=0u;corner<4u;corner++){
  if(picked.weights[corner]>0.0){sum+=spProbeRadiance(level,places[corner],uv)*picked.weights[corner];}
 }
 return sum;
}`
}
fn spTonemap(c:vec3f)->vec3f{return c/(1.0+luminance(c));}
fn spUntonemap(c:vec3f)->vec3f{return c/max(1.0-luminance(c),1e-4);}
/** The rough specular of the lit pixel \`pixel\` (surface \`s\`) that reads the probes \`picked\`, whose irradiance at its normal is \`irradiance\`;
 *  \`sky\` the open sky it has (the unit direction in \`xyz\`, the amount in \`w\`), which weighs each sample by the share of its direction the sky leaves. */
fn spRoughSpecular(pixel:vec2u,s:SpSurface,picked:SpPicked,irradiance:vec3f,sky:vec4f)->vec3f{
 let at=vec2i(pixel);
 let roughness=textureLoad(sceneNormals,at,0).w;
 let lobed=spLobed(textureLoad(sceneFlags,at,0).r);
 let blend=spRoughLerp(roughness,s.foliage,lobed);
 let diffuse=irradiance*INVERSE_PI;
 if(blend>=1.0){return diffuse;}
 let alpha=max(roughness,SP_ROUGH_MIN)*max(roughness,SP_ROUGH_MIN);
 var widths=vec2f(alpha);
 var frame=frameAround(s.N);
 if(lobed){
  // An anisotropic lobe is wider along its axis than across it; a cloth's texel holds no axis.
  let texel=textureLoad(lobesIn,at,0);
  if(!lobeIsCloth(texel)){
   let axis=packedLobeAxis(texel,s.N,alpha);
   if(any(axis.xyz!=vec3f(0.0))){
    widths=vec2f(axis.w,packedLobeAcross(texel,alpha));
    frame=Frame3(axis.xyz,cross(s.N,axis.xyz),s.N);
   }
  }
 }
 let V=viewToEye(s.P);
 let v=intoFrame(frame,V);
 let rank=i32(sp.size.w%8u);
 let seed=rand3dPcg16(vec3i(vec2i(pixel),rank)).xy;
${mips === 1 ? '' : ' let level=spRoughLevel();\n'} var sum=vec3f(0.0);
 for(var i=0u;i<SP_ROUGH_SAMPLES;i++){
  var e=hammersley16(i,SP_ROUGH_SAMPLES,seed);
  e.y=(e.y-0.5)*SP_ROUGH_BIAS+0.5;
  let H=outOfFrame(visibleGgxHalf(e,widths,v),frame);
  let L=2.0*dot(V,H)*H-V;
  var visibility=1.0;
  if(${extraAo ? 'true' : 'spFlag(SP_FLAG_OCCLUSION_IN_INTEGRATION)'}){visibility=directionVisibility(s.N,sky.xyz,sky.w,L);}
  sum+=spTonemap(spProbeLight(picked,L${mips === 1 ? '' : ',level'})*visibility);
 }
 return mix(spUntonemap(sum/f32(SP_ROUGH_SAMPLES)),diffuse,blend);
}`,
  )

/**
 * THE EXTRA AMBIENT OCCLUSION OF THE PROBES a pixel reads, at its normal (`spPickedExtraAo`): the octahedral map of each probe (the alpha of the irradiance, a texel of its side and
 * border, the eight-bit code of the occlusion) read bilinearly at the normal, weighed as the diffuse light is; one where the probes keep none. The integration takes it as the occlusion of the diffuse light
 * (`spDiffuse`) and of the directions of the rough specular.
 */
const spExtraAoWgsl = (extraAo: boolean) =>
  wgslBlock(
    `spExtraAo(${extraAo})`,
    [SP_PICKED, equalAreaEncode, bilinear1],
    extraAo
      ? `fn spExtraAoOf(atlas:vec2u,n:vec3f)->f32{
 let border=${IRRADIANCE_PROBE_SIDE + 2}u;
 let p=vec2f(atlas*border)+equalAreaEncode(n)*f32(${IRRADIANCE_PROBE_SIDE})+vec2f(0.5);
 let base=vec2i(floor(p));
 let a=textureLoad(probeIrradiance,base,0).a/255.0;
 let b=textureLoad(probeIrradiance,base+vec2i(1,0),0).a/255.0;
 let c=textureLoad(probeIrradiance,base+vec2i(0,1),0).a/255.0;
 let e=textureLoad(probeIrradiance,base+vec2i(1,1),0).a/255.0;
 return bilinear1(a,b,c,e,p-floor(p));
}
fn spPickedExtraAo(picked:SpPicked,N:vec3f)->f32{
 var places=picked.atlas;
 var ao=0.0;
 for(var corner=0u;corner<4u;corner++){
  if(picked.weights[corner]>0.0){ao+=spExtraAoOf(places[corner],N)*picked.weights[corner];}
 }
 return ao;
}`
      : 'fn spPickedExtraAo(picked:SpPicked,N:vec3f)->f32{return 1.0;}',
  )

/**
 * WHAT THE INTEGRATION'S TARGETS HOLD of the numbers it writes: a light as the 11-11-10 word keeps it (`spPacked` the word, `spStored` its value: moved by a
 * stochastic rounding of the number `e` of [0, 1), the pixel's blue noise of the image's rank modulo eight, then rounded to the word's
 * mantissas), and the share of the light that moves as an eight-bit normalised number (`spStoredMoving`, rounded to the nearest of 255 steps).
 */
const SP_STORED = wgslBlock(
  'SP_STORED',
  [packLight, unpackLight, ditherLight],
  `fn spPacked(c:vec3f,e:f32)->u32{return packLight(ditherLight(c,e));}
fn spStored(c:vec3f,e:f32)->vec3f{return unpackLight(spPacked(c,e));}
fn spStoredMoving(moving:f32)->f32{return round(saturate(moving)*255.0)/255.0;}`,
)

/**
 * THE INTEGRATION: each pixel reads its irradiance from the probes round it (`spIntegrate`, which the integration's kernel calls for
 * the pixel of every cell of a tile, `cell` the texel it is written to, whose noise rounds the targets' light). The probes it reads are the four uniform ones of the tile round it (`spInterpolation`, bilinear in the tile,
 * each by how near its plane the pixel lies), the point it reads them from moved by a jitter of a tile's side (the blue noise of the
 * pixel and the frame, `jitterWidth`, halved from five to ten units of depth; kept only where the jittered pixel lies on the
 * pixel's own plane): the probes' footprints blur into each other where the surface is continuous, never across an edge. A corner
 * whose weight falls under the minimum takes the best adaptive probe of its tile (`spAdaptiveWeight`) where one is better; the
 * weights are then normalised, those of a gentler plane where the first leave none, and a pixel with none reads nothing (its
 * alpha is zero: the temporal pass leans on its history). With the stochastic interpolation one probe of the four is drawn by
 * the pixel's blue noise, weighed whole. The alpha of a pixel that reads probes is the share of the light that moves (`probeMoving` of
 * the probes it reads, by their weights), a four-thousandth at least. The light, the rough specular and the back leave it as the
 * 11-11-10 targets they are written to hold them, and the alpha as an eight-bit one (`SP_STORED`). The probe's light is its nine coefficients, interpolated
 * and evaluated once at the pixel's normal (`irradianceShader`), or its octahedral irradiance map, read bilinearly at it; it is the pixel's diffuse light
 * once it is put under the probes' extra ambient occlusion, the short-range occlusion where it is applied during the integration, and the material's (`spDiffuse`). The same
 * probes give the pixel's rough specular (`spRoughSpecular`, under the open sky `sky` the pixel has, narrowed to the occlusion of the diffuse light `ao`; the diffuse light over pi where `simple`: the
 * tiles whose pixels need no rough specular skip its samples) and, where asked, the irradiance at its back, \`-N\`, of a thin sheet
 * that transmits light.
 */
export const spIntegrate = (at: IntegrateBindings) =>
  wgslBlock(
    `spIntegrate(${at.pixels}, ${at.header}, ${at.indices}, ${at.moving}, ${at.irradiance}, ${at.gather}, ${at.lobes}, ${at.base}, ${at.emissiveAo}, ${at.extraAo}, ${at.mips}, ${at.bentNormal})`,
    [
      spPickedIrradianceWgsl(at.extraAo),
      roughSpecularWgsl(at.lobes, at.mips, at.extraAo),
      SP_STORED,
      spExtraAoWgsl(at.extraAo),
      BOUNCED_OCCLUSION,
      SURFACE_EMISSIVE_AO_WGSL,
    ],
    `@group(0) @binding(${at.pixels}) var<storage,read> probePixels:array<u32>;
@group(0) @binding(${at.header}) var<storage,read> header:array<u32>;
@group(0) @binding(${at.indices}) var<storage,read> indices:array<u32>;
@group(0) @binding(${at.moving}) var<storage,read> probeMoving:array<f32>;
@group(0) @binding(${at.irradiance}) var probeIrradiance:texture_2d<f32>;
@group(0) @binding(${at.gather}) var probeGather:texture_2d<f32>;
@group(0) @binding(${at.base}) var sceneBase:texture_2d<f32>;
@group(0) @binding(${at.emissiveAo}) var emissiveAo:texture_2d<f32>;
const SP_JITTER_PLANE_SCALE:f32=${SCREEN_PROBE_CONSTANTS.jitterPlaneWeightScale};
/** The offset the pixel reads its probes from: the noise's jitter, kept where the jittered pixel is on the pixel's own plane. */
fn spJitterOffset(pixel:vec2u,s:SpSurface,depth:f32)->vec2f{
 if(sp.spatial.z<=0.0){return vec2f(0.0);}
 let width=sp.spatial.z*mix(1.0,0.5,saturate((depth-5.0)/5.0));
 let jitter=(blueNoiseVec2(pixel,sp.frames.y)*2.0-vec2f(1.0))*f32(sp.size.z)*width;
 let jittered=clamp(vec2f(pixel)+jitter,vec2f(0.0),vec2f(sp.size.xy)-vec2f(1.0));
 let other=spSurfaceAt(vec2u(floor(jittered)));
 let away=abs(dot(other.P,s.N)-dot(s.P,s.N))/depth;
 return select(vec2f(0.0),jitter,exp2(SP_JITTER_PLANE_SCALE*away*away)>SP_MIN_WEIGHT);
}
/** The diffuse light of the pixel \`pixel\` (surface \`s\`) that reads the probes \`picked\`: their irradiance at the direction \`lit\` (its normal) under the occlusion \`ao\` (the extra ambient occlusion
 *  and, where the short-range occlusion is applied during the integration, the least of it and that), put
 *  under the multiple bounces of that occlusion on the pixel's albedo (the base colour not metal, capped at \`sp.foliage.w\`), then, where the setting asks, under the
 *  multiple bounces of the material's own occlusion. */
fn spDiffuse(picked:SpPicked,pixel:vec2u,s:SpSurface,ao:f32,lit:vec3f)->vec3f{
 let at=vec2i(pixel);
 let base=textureLoad(sceneBase,at,0);
 let albedo=min(base.rgb*(1.0-base.a),vec3f(sp.foliage.w));
 var light=spPickedIrradiance(picked,lit,ao);
 if(ao>0.0){light*=bouncedOcclusion(albedo,ao)/ao;}
 if(spFlag(SP_FLAG_MATERIAL_AO)){light*=bouncedOcclusion(albedo,surfaceEmissiveAo(at,textureLoad(sceneFlags,at,0).r).a);}
 return light;
}
/** What the probes give a lit pixel: its diffuse light in \`light.rgb\` and the share of it that moves in \`light.a\` (zero where no probe weighs), its rough specular and its back. */
struct SpIntegrated{light:vec4f,rough:u32,back:u32,}
fn spIntegrate(pixel:vec2u,cell:vec2u,s:SpSurface,simple:bool,withBack:bool,sky:vec4f)->SpIntegrated{
 let depth=spDepthOf(s.P);
 let picked=spPickProbes(pixel,spJitterOffset(pixel,s,depth),s,depth);
 if(!picked.valid){return SpIntegrated(vec4f(0.0),0u,0u);}
 var places=picked.atlas;
 var moving=0.0;
 for(var corner=0u;corner<4u;corner++){moving+=probeMoving[spIndexOf(places[corner])]*picked.weights[corner];}
 let ao=min(sky.w,spPickedExtraAo(picked,s.N));
 // With the bent normal the diffuse light is read at the normal turned toward it by as much as the occlusion shuts the sky: the surface's own where it shuts none.
 let lit=${at.bentNormal ? 'normalize(mix(sky.xyz,s.N,ao))' : 's.N'};
 let diffuse=spDiffuse(picked,pixel,s,ao,lit);
 let e=blueNoiseScalar(cell,sp.size.w%8u);
 var out=SpIntegrated(vec4f(spStored(diffuse,e),spStoredMoving(max(moving,0.004))),0u,0u);
 if(simple){out.rough=spPacked(diffuse*INVERSE_PI,e);}
 else{out.rough=spPacked(spRoughSpecular(pixel,s,picked,diffuse,vec4f(sky.xyz,ao)),e);}
 if(withBack){out.back=spPacked(spPickedIrradiance(picked,-s.N,1.0),e);}
 return out;
}`,
  )
