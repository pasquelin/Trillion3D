import { TAA_VIEW_WGSL, packedStorageWgsl } from './bindingsWgsl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { TILE_CLAMP_WGSL } from './tileWgsl.ts'
import { FULL_PRECISION, HALF_PRECISION, type Precision } from './colorSpaceWgsl.ts'
import { ANTI_ALIAS_MASK, LDR_LUMA, storageDeclaration, type StorageForm } from './storageForms.ts'

/** The least LDR luma contrast the anti-aliaser treats as an edge: below it a staircase is not
 *  visible and the browse would only move noise. */
export const SPATIAL_ANTI_ALIASER_MIN_LUMINANCE = 0.05
/** The offset in 4 bits per axis over a range of ±0.5 texel, seven steps each side: the zero
 *  code 8, a step of 0.5 / 7. */
const OFFSET_MASK = 15
const OFFSET_STEPS = 7
const OFFSET_ZERO = OFFSET_STEPS + 1
const OFFSET_SCALE = OFFSET_STEPS / 0.5
/** The anti-aliaser's word of no offset — the zero code on both axes — and no noise filtering:
 *  what it writes where the rejection asks for none, and what the history update takes in place of
 *  its target where the level runs no anti-aliaser (`view.quality.y`, `resolveWgsl.ts`). */
export const ANTI_ALIAS_NEUTRAL = OFFSET_ZERO | (OFFSET_ZERO << 4)

/** The Rec. 601 luma the spatial anti-aliaser measures in, both its browse and whether aliasing
 *  is visible at all. */
export const LUMA_601_WGSL = wgslFn(
  'luma601',
  [],
  'fn luma601(c:vec3f)->f32{return dot(c,vec3f(0.299,0.587,0.114));}',
)

/** The edge search in precision `p` (`Precision`): its scalar, its two-component vector and the
 *  suffix of its names. */
const browseText = ({ F: T, V2: V, S }: Precision) => `
struct TaaBrowse${S}{noise:${T},browse:${V},side:${V},edge:${T}}
fn findBrowsing${S}(c:${T},n:${T},s:${T},e:${T},w:${T},ne:${T},nw:${T},se:${T},sw:${T})->TaaBrowse${S}{
 let varHN=abs(0.5*(ne+nw)-n);let varH=abs(0.5*(e+w)-c);let varHS=abs(0.5*(se+sw)-s);
 let varVE=abs(0.5*(ne+se)-e);let varV=abs(0.5*(n+s)-c);let varVW=abs(0.5*(nw+sw)-w);
 let diffN=abs(n-c);let diffS=abs(s-c);let diffE=abs(e-c);let diffW=abs(w-c);
 let vertical=varHN+varH+varHS>varVE+varV+varVW;
 let browse=select(${V}(1.0,0.0),${V}(0.0,1.0),vertical);
 let noise=max(saturate(2.0*varH-max(diffE,diffW)),saturate(2.0*varV-max(diffN,diffS)));
 var side=${V}(0.0);var edge=${T}(0.0);
 if(vertical){side.x=select(${T}(1.0),${T}(-1.0),diffW>diffE);edge=select(e,w,diffW>diffE);}
 else{side.y=select(${T}(1.0),${T}(-1.0),diffN>diffS);edge=select(s,n,diffN>diffS);}
 return TaaBrowse${S}(noise,browse,side,edge);
}`

/**
 * The edge search's first step (`findBrowsing`), on the 3×3 of a value — the LDR luma the
 * anti-aliaser browses, the depth the reprojection field's boundary does: the total variations
 * along rows and columns give the direction to browse (along the rows, or down the columns, by the
 * larger variation of the other), the noise filtering (the second difference above the larger step
 * to a neighbour, along either axis), the side of the browse the edge lies on (toward the neighbour
 * that differs more) and the edge's value there. In 32 bits; the anti-aliaser's 16-bit program
 * has the same in half floats (`findBrowsingH`).
 */
export const SPATIAL_BROWSE_WGSL = wgslBlock('SPATIAL_BROWSE_WGSL', [], browseText(FULL_PRECISION))
const SPATIAL_BROWSE_HALF_WGSL = wgslBlock(
  'SPATIAL_BROWSE_HALF_WGSL',
  [],
  browseText(HALF_PRECISION),
)

/** The LDR luma of texel `q`, `lumaOf(q)`, of the variable `luma`: the 8-bit unsigned normalised
 *  texture's texel, or in the buffer form the byte at place `at` (the texel's row times the analysis
 *  grid's width, plus its column), as such a texture reads it. */
const lumaReadWgsl = (form: StorageForm) =>
  wgslBlock(
    `lumaReadWgsl(${form})`,
    [],
    form === 'texture'
      ? `
fn lumaOf(q:vec2i)->f32{return textureLoad(luma,q,0).x;}`
      : `
fn lumaAt(at:u32)->f32{return f32((luma[at>>2u]>>((at&3u)*8u))&0xffu)/255.0;}
fn lumaOf(q:vec2i)->f32{return lumaAt(u32(q.y)*u32(view.analysisGrid.x)+u32(q.x));}`,
  )

/** The mask's accesses, the one place the two forms differ in the programs: the anti-aliaser's read
 *  `antiAliasMaskAt(p)` of the variable `antiAliasMask`, the shading rejection's write
 *  `antiAliasMaskSet(p, on)` of `antiAliasMaskOut`. In the buffer form the word of texel `p` is
 *  the texel's row times the analysis grid's width, plus its column. */
export const antiAliasMaskWgsl = (form: StorageForm, access: 'read' | 'write') =>
  wgslBlock(
    `antiAliasMaskWgsl(${form}, ${access})`,
    [],
    `
${
  access === 'read'
    ? form === 'texture'
      ? 'fn antiAliasMaskAt(p:vec2i)->bool{return textureLoad(antiAliasMask,p).x>0u;}'
      : 'fn antiAliasMaskAt(p:vec2i)->bool{return antiAliasMask[u32(p.y)*u32(view.analysisGrid.x)+u32(p.x)]!=0u;}'
    : form === 'texture'
      ? 'fn antiAliasMaskSet(p:vec2i,on:bool){textureStore(antiAliasMaskOut,p,vec4u(select(0u,1u,on),0u,0u,0u));}'
      : 'fn antiAliasMaskSet(p:vec2i,on:bool){antiAliasMaskOut[u32(p.y)*u32(view.analysisGrid.x)+u32(p.x)]=select(0u,1u,on);}'
}`,
  )

/** The anti-aliaser's bindings. Its target, `out`, holds each texel's offset (4 bits per axis) beside
 *  its noise filtering (out of 255), two 8-bit unsigned channels: `rg8uint` where the device stores
 *  to it, `rgba8uint` else (`HistoryFormats.antiAlias`, `historyShape.ts`). */
export const SPATIAL_AA_BINDINGS = {
  luma: 0,
  view: 1,
  mask: 3,
  out: 4,
} as const

/** The texels a workgroup of the anti-aliaser covers, across and down. */
export const SPATIAL_AA_TILE = 8

/** The anti-aliaser's bindings and the helpers its kernel reads, in the precision type `T`. */
const aaDeclarations = (
  T: string,
  format: GPUTextureFormat,
  maskForm: StorageForm,
  lumaForm: StorageForm,
) =>
  `${storageDeclaration(LDR_LUMA, lumaForm, 'read', SPATIAL_AA_BINDINGS.luma)}
@group(0) @binding(${SPATIAL_AA_BINDINGS.view}) var<uniform> view:TaaView;
${storageDeclaration(ANTI_ALIAS_MASK, maskForm, 'read', SPATIAL_AA_BINDINGS.mask)}
@group(0) @binding(${SPATIAL_AA_BINDINGS.out}) var antiAliased:texture_storage_2d<${format},write>;
fn aaLoad(p:vec2i,offset:vec2i)->${T}{return ${T}(lumaOf(clampTexel(p+offset)));}
/** The bilinear sample \`along\` texels from \`p\`, half a texel toward \`side\`: the mean of the texel
 *  there and its neighbour toward the side, each held to the drawn image. */
fn aaBilinear(p:vec2i,along:vec2i,side:vec2i)->${T}{
 return ${T}(0.5*(lumaOf(clampTexel(p+along))+lumaOf(clampTexel(p+along+side))));
}
/** How far the texel lies from the staircase's true edge, by the sides whose browse stopped past
 *  the band toward the edge's luma (\`incN\`, \`incP\`): both, half a texel; one, by its length
 *  against the whole run's; neither, none. */
fn aaDistanceToEdge(incN:bool,incP:bool,lengthN:${T},lengthP:${T})->${T}{
 if(incN&&incP){return 0.5;}
 let inverse=1.0/(1.0+lengthN+lengthP);
 if(incN){return 0.5-(lengthN+0.5)*inverse;}
 if(incP){return 0.5-(lengthP+0.5)*inverse;}
 return 0.0;
}
fn aaEncode(offset:vec2f)->u32{
 let e=clamp(vec2i(round(offset*${OFFSET_SCALE.toFixed(1)}))+${OFFSET_ZERO},vec2i(1),vec2i(${OFFSET_MASK}));
 return u32(e.x)|(u32(e.y)<<4u);
}`

/** The edge browse of the kernel: both ways along the edge, the offset it gives, in the precision
 *  type `T`. */
const aaBrowse = (T: string) =>
  `  let step=vec2i(browse);let toward=vec2i(side);
  let merged=0.5*(edge+c);let band=0.25*abs(edge-c);let minLuma=merged-band;let maxLuma=merged+band;
  var minP=false;var maxP=false;var minN=false;var maxN=false;
  let iterations=i32(view.quality.y);
  var lengthP=${T}(iterations);var lengthN=${T}(iterations);
  // Each side stops at its first sample out of the band, its length the samples before it.
  for(var i=1;i<=iterations;i++){
   let at=step*i;
   if(!(minP||maxP)){let lumaP=aaBilinear(p,at,toward);minP=lumaP<minLuma;maxP=lumaP>maxLuma;if(minP||maxP){lengthP=${T}(i-1);}}
   if(!(minN||maxN)){let lumaN=aaBilinear(p,-at,toward);minN=lumaN<minLuma;maxN=lumaN>maxLuma;if(minN||maxN){lengthN=${T}(i-1);}}
   if((minP||maxP)&&(minN||maxN)){break;}
  }
  let brighter=edge>c;
  let incP=select(minP,maxP,brighter);let incN=select(minN,maxN,brighter);
  offset=side*saturate(lumaDelta/${SPATIAL_ANTI_ALIASER_MIN_LUMINANCE})*aaDistanceToEdge(incN,incP,lengthN,lengthP);`

/** The kernel: the 3×3, the browsing direction, and the offset where the edge's contrast is worth
 *  it, in the precision types `T`, `V` and the suffix `S` of the browse helper. */
const aaKernel = (T: string, V: string, S: string) =>
  `@compute @workgroup_size(${SPATIAL_AA_TILE},${SPATIAL_AA_TILE})
fn spatialAntiAliasing(@builtin(global_invocation_id) id:vec3u){
 let p=vec2i(id.xy);
 if(any(p>=vec2i(view.render.xy))){return;}
 if(!antiAliasMaskAt(p)){textureStore(antiAliased,p,vec4u(aaEncode(vec2f(0.0)),0u,0u,0u));return;}
 // The 3×3, each texel clamped to the rendered size (aaLoad).
 let c=aaLoad(p,vec2i(0,0));let n=aaLoad(p,vec2i(0,-1));let s=aaLoad(p,vec2i(0,1));let w=aaLoad(p,vec2i(-1,0));let e=aaLoad(p,vec2i(1,0));
 let nw=aaLoad(p,vec2i(-1,-1));let ne=aaLoad(p,vec2i(1,-1));let sw=aaLoad(p,vec2i(-1,1));let se=aaLoad(p,vec2i(1,1));
 let found=findBrowsing${S}(c,n,s,e,w,ne,nw,se,sw);
 let browse=found.browse;let noise=found.noise;let side=found.side;let edge=found.edge;
 let lumaDelta=abs(edge-c)*0.5;
 var offset=${V}(0.0);
 // Below the contrast worth it the edge is left: no browse.
 if(lumaDelta>${SPATIAL_ANTI_ALIASER_MIN_LUMINANCE}){
${aaBrowse(T)}
 }
 textureStore(antiAliased,p,vec4u(aaEncode(vec2f(offset)),u32(round(noise*255.0)),0u,0u));
}`

/**
 * The spatial anti-aliaser, per render pixel where the shading rejection asks for it (its mask,
 * `AnalysisTargetViews.antiAliasMask`: aliasing visible and the history rejected or disoccluded),
 * elsewhere no offset and no noise filtering; an edge search in the manner of morphological
 * anti-aliasing (Reshetov 2009): the 3×3 LDR lumas give the direction to browse, the side the edge
 * lies on, its luma and the noise filtering; where the edge's contrast is worth it
 * (`lumaDelta > 0.05`), the edge is browsed both ways along it,
 * the level's bilinear samples (`view.quality.y`, `TaaLevelKnobs`) each half a texel toward the edge — the
 * mean of the texel and its neighbour toward the edge, as a bilinear filter weighs them there —, each
 * stopping at the first that leaves the edge's mid luma band (`aaBilinear`); the two
 * lengths and how each stopped give the texel's distance to the staircase's true edge
 * (`aaDistanceToEdge`), scaled by the contrast past the threshold, encoded 4 bits an
 * axis (`aaEncode`) beside the noise filtering out of 255.
 * The history update moves its kernel centre by it (`taaResolveShader`). The LDR luma, which the
 * shading rejection writes (`rejectionWgsl.ts`), is an `r8unorm` texture (`lumaOf` loads it) where the
 * device grants it, else a buffer of packed bytes, a byte a texel (`lumaAt`); made at the render
 * targets' size, the image drawn in its top-left `view.render.xy`: every texel read is held to it,
 * as a filter's clamp to the edge holds it. 9 reads per render pixel, and where the contrast is worth
 * it up to twice the level's bilinear samples, each side's ending at its stop.
 */
export const spatialAntiAliasingShader = (
  format: GPUTextureFormat = 'rg8uint',
  half = false,
  maskForm: StorageForm = 'buffer',
  lumaForm: StorageForm = 'buffer',
) => {
  const p = half ? HALF_PRECISION : FULL_PRECISION
  const { F: T, V2: V, S } = p
  return wgslProgram(
    `${aaDeclarations(T, format, maskForm, lumaForm)}
${aaKernel(T, V, S)}`,
    [
      TAA_VIEW_WGSL,
      TILE_CLAMP_WGSL,
      lumaReadWgsl(lumaForm),
      antiAliasMaskWgsl(maskForm, 'read'),
      half ? SPATIAL_BROWSE_HALF_WGSL : SPATIAL_BROWSE_WGSL,
      ...p.enable,
      ...packedStorageWgsl(format, ...(maskForm === 'texture' ? [ANTI_ALIAS_MASK.format] : [])),
    ],
  )
}

/** The anti-aliaser's offset decoded from the 4-bit codes `aaEncode` wrote: `±0.5` texel an axis. */
export const ANTI_ALIAS_OFFSET_WGSL = wgslBlock(
  'ANTI_ALIAS_OFFSET_WGSL',
  [],
  `
fn decodeAntiAliasOffset(code:u32)->vec2f{
 return (vec2f(f32(code&${OFFSET_MASK}u),f32((code>>4u)&${OFFSET_MASK}u))-${OFFSET_ZERO}.0)/${OFFSET_SCALE.toFixed(1)};
}`,
)
