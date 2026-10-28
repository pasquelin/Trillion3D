import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { workgroupSumLoop } from '../../../gpu/core/workgroupSumWgsl.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spHistory } from './historyWgsl.ts'
import { spProbes, spSurface } from './probesWgsl.ts'
import { PDF_LOBE_WORDS, PROBE_PIXEL_BINDINGS, bindingTable } from './screenProbeLayout.ts'

/** The screen data's bindings: the probes' records and pixels, the image's normals and flags, the last
 *  image's shading, and what it writes — nine coefficients of the directions the probe's pixels face, a
 *  word a probe saying whether most of them hold no history. */
export const SCREEN_DATA_BINDINGS = bindingTable({
  ...PROBE_PIXEL_BINDINGS,
  normals: [5, 'float'],
  flags: [6, 'uint'],
  brdf: [8, 'buffer'],
  disocclusion: [9, 'buffer'],
  vectors: [10, 'uint'],
  blue: [11, 'float'],
  shading: [12, 'uint'],
  keptDepth: [13, 'float'],
})

const B = SCREEN_DATA_BINDINGS.at
/** The values a thread of the data kernel sums: the nine coefficients, the pixels counted, the pixels
 *  without history. */
const SUMS = 11
/** The pixels of a probe's footprint, a thread each. */
const FOOTPRINT = 64

/**
 * The nine coefficients of the directions a pixel of normal \`N\` asks light from (\`spPdfLobe\`): its cosine lobe, or, for a pixel lit
 * from both sides (\`spherical\`: hair, or a surface with backface diffuse light), the constant term alone — every direction wanted, none
 * culled that the shading samples. A kernel that reads it names the probes' basis (\`spCosine\`) beside this block.
 */
const SP_PDF_LOBE_WGSL = wgslBlock(
  'SP_PDF_LOBE_WGSL',
  [],
  `fn spPdfLobe(N:vec3f,spherical:bool)->array<f32,9>{
 if(spherical){return array<f32,9>(1.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0,0.0);}
 return spCosine(N);
}`,
)

/**
 * THE SCREEN DATA OF A PROBE: what the pixels the probe stands for ask of its rays. A group a probe, a thread
 * each of the sixty-four pixels of its footprint — the tile and half of its neighbours', a pixel every
 * `tile / 4` pixels —, the one at the probe's own pixel always counted: a pixel that lies near the probe's
 * plane (`exp2(scale · (distance / depth)²)` over `0.01`) adds the nine coefficients of its lobe
 * (`spPdfLobe`: in the probes' basis, so its sum is read by `spBasis`) to the probe's mean, kept as nine half floats
 * (`PDF_LOBE_WORDS`), which says how much of the light from every direction the pixels will want — the probability the rays are drawn by
 * (`genRays`, `importanceWgsl.ts`). A probe whose pixels mostly held no history last image
 * (`sp.tuning.y` of them under `sp.tuning.x` frames) is flagged: its neighbours' light is welcome in the
 * spatial filter with a looser angle (`spatialWgsl.ts`).
 */
const SCREEN_DATA_WGSL = wgslBlock(
  'SCREEN_DATA_WGSL',
  [SP_PDF_LOBE_WGSL],
  `@group(0) @binding(${B.pixels}) var<storage,read> probePixels:array<u32>;
@group(0) @binding(${B.brdf}) var<storage,read_write> brdf:array<u32>;
@group(0) @binding(${B.disocclusion}) var<storage,read_write> disocclusion:array<u32>;
const SP_SUMS:u32=${SUMS}u;
var<workgroup> partial:array<array<f32,${SUMS}>,${FOOTPRINT}>;
/** Whether the last image's pixels round the surface \`s\` of \`pixel\` hold no history, that is, fewer than the frames the filter waits for. */
fn spDisoccluded(pixel:vec2u,s:SpSurface)->bool{
 let h=spReproject(pixel,s.P,s.N,s.foliage,blueNoiseScalar(pixel,sp.frames.z));
 if(dot(h.weights,vec4f(1.0))<=0.0){return true;}
 return min(spHistoryFrames(h)+1.0,f32(sp.counts.x))<sp.tuning.x;
}
/** What the thread \`lane\` of the probe adds: the footprint pixel it stands on, its lobe, one pixel, whether it has no history. */
fn spFootprint(lane:u32,probe:SpProbe,own:vec2f)->array<f32,${SUMS}>{
 var mine=array<f32,${SUMS}>();
 let centre=lane==36u;
 var offset=((vec2f(f32(lane%8u),f32(lane/8u))+vec2f(0.5))/8.0*2.0-vec2f(1.0))*f32(sp.size.z);
 if(centre){offset=vec2f(0.0);}
 let pixel=vec2u(clamp(floor(own+vec2f(0.5)+offset),vec2f(0.0),vec2f(sp.size.xy)-vec2f(1.0)));
 let s=spSurfaceAt(pixel);
 let away=abs(dot(probe.P,s.N)-dot(s.P,s.N))/probe.depth;
 if(s.lit&&(exp2(sp.weights.x*away*away)>0.01||centre)){
  let lobe=spPdfLobe(s.N,s.hair||s.foliage);
  for(var k=0u;k<9u;k++){mine[k]=lobe[k];}
  mine[9]=1.0;
  mine[10]=select(0.0,1.0,spFlag(SP_FLAG_DISOCCLUSION)&&spDisoccluded(pixel,s));
 }
 return mine;
}
@compute @workgroup_size(8,8)
fn screenData(@builtin(workgroup_id) group:vec3u,@builtin(local_invocation_index) lane:u32){
 let index=spIndexOf(group.xy);
 let probe=spProbeOrDead(group.xy);
 var mine=array<f32,${SUMS}>();
 if(probe.depth>0.0){
  let word=probePixels[index];
  mine=spFootprint(lane,probe,vec2f(f32(word&0xffffu),f32(word>>16u)));
 }
 for(var k=0u;k<SP_SUMS;k++){partial[lane][k]=mine[k];}
 ${workgroupSumLoop(FOOTPRINT, 'for(var k=0u;k<SP_SUMS;k++){partial[lane][k]+=partial[lane+stride][k];}')}
 if(lane!=0u||probe.depth<=0.0){return;}
 let count=max(partial[0][9],1.0);
 for(var w=0u;w<${PDF_LOBE_WORDS}u;w++){
  let low=partial[0][2u*w]/count;
  let high=select(0.0,partial[0][2u*w+1u]/count,w<${PDF_LOBE_WORDS - 1}u);
  brdf[index*${PDF_LOBE_WORDS}u+w]=pack2x16float(vec2f(low,high));
 }
 disocclusion[index]=select(0u,1u,spFlag(SP_FLAG_DISOCCLUSION)&&partial[0][10]>=count*sp.tuning.y);
}`,
)

/** The screen data's program over `samples` of a tile. */
export const screenDataShader = (samples: readonly [number, number]) =>
  wgslProgram(spParams(B.params), [
    spCommon(samples),
    spSurface(B.normals, B.flags),
    spProbes(B.info, B.normal, B.counts),
    spHistory(B.shading, B.keptDepth, B.vectors),
    blueNoiseWgsl(0, B.blue),
    SCREEN_DATA_WGSL,
  ])
