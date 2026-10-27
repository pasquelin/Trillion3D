import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { fastAcos } from '../../../../../math/src/wgsl/geometry.ts'
import { downsampleBase } from '../../../../../math/src/wgsl/sampling.ts'
import { SP_BENT_WGSL } from './historyWgsl.ts'
import { SP_OCCLUSION_CELLS } from './occlusionWgsl.ts'

/** The occlusion texels of this image: the texel the search wrote at a cell, loaded as the pass keeps it. */
const spOcclusionLoad = (
  binding: number,
  bentNormal: boolean,
) => `@group(0) @binding(${binding}) var occlusionIn:texture_2d<${bentNormal ? 'u32' : 'f32'}>;
fn spOcclusionLast()->vec2i{return (vec2i(sp.size.xy)-vec2i(1))/vec2i(i32(SP_OCCLUSION_DOWNSAMPLE));}
fn spOcclusionTexel(cell:vec2i)->vec4f{
 let at=clamp(cell,vec2i(0),spOcclusionLast());
 ${bentNormal ? 'return spBentUnpack(textureLoad(occlusionIn,at,0).r);' : 'return vec4f(0.0,0.0,1.0,textureLoad(occlusionIn,at,0).r);'}
}`

/** The texel a pixel picks among the four round it, stochastically, by how near each stands to the pixel's surface. */
const SP_OCCLUSION_PICK = `/** The occlusion texel a pixel reads: \`cell\`; \`moved\` how far it lies from the cell the pick is counted from (the pick's offset
 *  and the clamp to the image's edge move it); \`valid\` whether a texel could stand for the pixel at all. */
struct SpOcclusionPick{cell:vec2i,moved:vec2i,valid:bool,}
/** The least sum of the texels' weights a pixel can be rebuilt from. */
const SP_OCCLUSION_MIN_WEIGHT:f32=0.01;
fn spOcclusionCell(pixel:vec2i,s:SpSurface,noise:f32)->SpOcclusionPick{
 let last=spOcclusionLast();
 if(SP_OCCLUSION_DOWNSAMPLE==1u){return SpOcclusionPick(clamp(pixel,vec2i(0),last),vec2i(0),true);}
 // The cell the pick's offset is counted from, for the weights and for the texel read alike: at the first row or column it is the cell -1, which weighs nothing.
 let base=downsampleBase(pixel,i32(SP_OCCLUSION_DOWNSAMPLE));
 let depth=spDepthOf(s.P);
 var weights=vec4f(0.0);
 for(var i=0;i<4;i++){
  let cell=base+vec2i(i&1,i>>1);
  if(any(cell<vec2i(0))||any(cell>last)){continue;}
  let stand=vec2i(spOcclusionPixel(vec2u(cell)));
  let apart=abs(vec2f(stand-pixel));
  // The triangle is left as it is: a texel three pixels away on one axis weighs under zero.
  let triangle=(2.0-apart.x)*(2.0-apart.y);
  if(triangle==0.0){continue;}
  let other=spSurfaceAt(vec2u(stand));
  if(!other.lit){continue;}
  let away=abs(dot(other.P-s.P,s.N))/depth;
  let angle=1.0-saturate(fastAcos(saturate(dot(other.N,s.N))));
  weights[i]=triangle*exp2(-5000.0*away*away)*angle*angle;
 }
 let reach=vec4f(weights.x,weights.x+weights.y,weights.x+weights.y+weights.z,weights.x+weights.y+weights.z+weights.w);
 let valid=reach.w>=SP_OCCLUSION_MIN_WEIGHT;
 let pick=noise*reach.w;
 // A pixel nothing can stand for keeps the first texel, the offset none.
 var k=0;
 if(valid){
  k=3;
  if(pick<=reach.x&&weights.x>0.0){k=0;}
  else if(pick<=reach.y&&weights.y>0.0){k=1;}
  else if(pick<=reach.z&&weights.z>0.0){k=2;}
 }
 let cell=clamp(base+vec2i(k&1,k>>1),vec2i(0),last);
 return SpOcclusionPick(cell,cell-base,valid);
}`

/** The occlusion held to the setting at a pixel: the strength it applies with and the open sky it leaves. */
const spOcclusionSky = (
  bentNormal: boolean,
) => `/** How strongly the occlusion applies at a pixel: the setting's at a pixel with backface diffuse light (\`foliage\`), whole elsewhere. */
fn spStrengthOf(foliage:bool)->f32{return select(1.0,sp.foliage.x,foliage);}
/** The open sky of the pixel whose occlusion texel is \`cell\`, of normal \`N\` that weighs the directions of its rough specular: the occlusion held to the setting's intensity
 *  (\`sp.foliage.y\`) and the pixel's \`strength\`, its direction a unit vector (the surface's own normal where the level keeps the amount alone),
 *  none (the normal, all of it) where the occlusion is off or is not applied during the integration. */
fn spSkyAt(cell:vec2i,N:vec3f,strength:f32)->vec4f{
 if(!spFlag(SP_FLAG_OCCLUSION)||!spFlag(SP_FLAG_OCCLUSION_IN_INTEGRATION)){return vec4f(N,1.0);}
 let o=spOcclusionTexel(cell);
 let amount=mix(1.0,mix(1.0,o.w,sp.foliage.y),strength);
 ${bentNormal ? 'return vec4f(select(N,normalize(o.xyz),dot(o.xyz,o.xyz)>1e-8),amount);' : 'return vec4f(N,amount);'}
}`

/**
 * THE OCCLUSION OF THIS IMAGE at a pixel, as the search found it (`spOcclusionTexel`, the occlusion's own size being the image's
 * over its downsample), read at `binding` of group 0. The texel a pixel reads is picked stochastically among the four round it
 * (`spOcclusionCell`): each stands for the full-size pixel the search ran from (`spOcclusionPixel`), is weighed by its triangle distance
 * to the pixel, how near the pixel's plane that pixel's point lies and how near its normal is the pixel's, and the pixel's blue noise
 * picks one by those weights (the last where one weighs but the noise reaches past them); where they weigh a hundredth or less
 * together none can stand for the pixel (`SpOcclusionPick.valid` down) and the first is kept. The texel holds the direction of the
 * open sky in `xyz` and the amount of it in `w` — with the bent normal the word the pass wrote (`spBentUnpack`), else the amount alone
 * and a direction that is none (`(0, 0, 1)` for every pixel) —; `spSkyAt` is the open sky it leaves a pixel, its amount held to the
 * setting's strength at the pixels with backface diffuse light (`spStrengthOf`) where the integration applies it. The program names the occlusion's downsample
 * (`SP_OCCLUSION_DOWNSAMPLE`).
 */
export const spOcclusionRead = (binding: number, bentNormal: boolean) =>
  wgslBlock(
    `spOcclusionRead(${binding}, ${bentNormal})`,
    [SP_BENT_WGSL, SP_OCCLUSION_CELLS, fastAcos, downsampleBase],
    [spOcclusionLoad(binding, bentNormal), SP_OCCLUSION_PICK, spOcclusionSky(bentNormal)].join(
      '\n',
    ),
  )
