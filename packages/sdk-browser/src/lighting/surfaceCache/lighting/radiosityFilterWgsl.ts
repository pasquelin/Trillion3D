import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { ditherLight, packLight, unpackLight } from '../../../gpu/core/smallFloatWgsl.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { lightingCommonWgsl, lightingLayersWgsl, surfaceTexelWgsl } from './commonWgsl.ts'
import {
  radiosityCommonWgsl,
  radiosityProbeVisibilityWgsl,
  radiosityRayWgsl,
} from './radiosityCommonWgsl.ts'

/**
 * THE RADIOSITY'S PROBES, filtered and projected: two kernels over the radiosity tiles, which read the rays' radiance
 * the trace wrote (`radiosityTraceWgsl.ts`) in the probes' trace atlas, kept from the images before for the probes this image
 * does not trace.
 *
 * - `radiosityFilter`, a thread a ray: the radiance is averaged with that ray of the probes about its own (four of
 *   them, or thirteen, `filterKernel`), weighted 2 for its own and 1 for each neighbour that lies in a page with
 *   probes and holds a surface on the texel's plane (`planeWeight`: a probe off it by more than the depth scale's limit is
 *   left out, `exp2(scale · (distance over the span between them)²) > 0.01`) and, with the probes' occlusion on (`FLAG_PROBE_OCCLUSION`),
 *   no more than each of the two sees of the other (`probeVisibility`), the sum dithered in the last place of the
 *   word it is kept in. The neighbours' probes are found as the card lays them: the probe's place on the card
 *   over the card's page table, by the pages the card's mip spans (`PAGE_MIP_FIRST`), each page's own jitter. The result is
 *   kept in a buffer a ray a word, in the order the threads are;
 * - `radiosityToSh`, a thread a probe: the rays' radiance — the filtered one, or the trace atlas's where the filter is off —
 *   projected on the harmonics of the first two bands, each ray weighted by one over the density of the uniform hemisphere
 *   (2π) and the sum by one over the rays; written, one layer a channel, to the probes' harmonics at the probe's place.
 *
 * Bindings: 0 the parameters, 1 the tables, 2 the context, 3 and 4 the depth and normal layers, 5 the blue noise, 6 the
 * probes' trace atlas, 7 the filtered rays (`radiosityFilter` writes, `radiosityToSh` reads), 8 the probes' harmonics, written, 9 the distances the rays
 * met their surfaces at (read where the probes' occlusion is on).
 */

export const RADIOSITY_FILTER_BINDINGS = {
  tables: 1,
  context: 2,
  depth: 3,
  normal: 4,
  noise: 5,
  trace: 6,
  filtered: 7,
  harmonics: 8,
  hits: 9,
} as const

const B = RADIOSITY_FILTER_BINDINGS

/** The neighbours of a probe that filter it. */
const FILTER_WGSL = wgslBlock(
  'RADIOSITY_FILTER_NEIGHBOURS_WGSL',
  [],
  `
fn neighbourOffset(k:u32)->vec2i{
 var four=array<vec2i,4>(vec2i(0,1),vec2i(1,0),vec2i(0,-1),vec2i(-1,0));
 var thirteen=array<vec2i,13>(vec2i(0,2),vec2i(-1,1),vec2i(0,1),vec2i(1,1),vec2i(-2,0),vec2i(-1,0),vec2i(0,0),vec2i(1,0),vec2i(2,0),vec2i(-1,-1),vec2i(0,-1),vec2i(1,-1),vec2i(0,-2));
 if(lp.filterKernel==1u){return four[k];}
 return thirteen[k];
}
fn neighbourCount()->u32{return select(13u,4u,lp.filterKernel==1u);}
fn traceAt(probeAtlas:vec2u,ray:vec2u)->vec3f{
 return unpackLight(textureLoad(probeTrace,vec2i(probeAtlas*lp.hemisphere+ray),0).x);
}
/** Adds the ray \`ray\` of the probe \`probeInCard\` of the page \`page\`'s card, if it lies on the card — a neighbour past its edge is no probe of it, never one of the
 *  page that follows in the table — in a lit page, and holds a surface on the plane of the texel. */
fn gatherNeighbour(texel:RadTexel,page:u32,probeInCard:vec2i,ray:vec2u,sum:ptr<function,vec3f>,weight:ptr<function,f32>){
 let size=cardSizeInProbes(page);
 if(any(probeInCard<vec2i(0))||any(vec2u(probeInCard)>=size)){return;}
 let at=cardProbeTexel(page,size,vec2u(probeInCard));
 if(!(at.inside&&at.valid)){return;}
 var w=1.0;
 if(lgFlag(FLAG_PLANE_WEIGHTING)){w=min(w,planeWeight(texel.position,texel.normal,at.position));}
 if(lgFlag(FLAG_PROBE_OCCLUSION)){w=min(w,min(probeVisibility(texel.position,at),probeVisibility(at.position,texel)));}
 if(w>0.0){*sum+=traceAt(probeAtlasCoord(at.atlas),ray)*w;*weight+=w;}
}
`,
)

export const RADIOSITY_FILTER_ENTRIES = ['radiosityFilter', 'radiosityToSh'] as const

export const RADIOSITY_FILTER_WGSL = wgslProgram(
  `@group(0) @binding(${B.trace}) var probeTrace:texture_2d<u32>;
@group(0) @binding(${B.filtered}) var<storage,read_write> filtered:array<u32>;
@group(0) @binding(${B.harmonics}) var outHarmonics:texture_storage_2d_array<rgba16float,write>;
@compute @workgroup_size(${WORKGROUP_THREADS})
fn radiosityFilter(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let i=id.x+id.y*n.x*${WORKGROUP_THREADS}u;
 let thread=radRayThread(i);
 if(!thread.ok){return;}
 let at=thread.at;
 let probe=thread.probe;
 let texel=thread.texel;
 let own=probeAtlasCoord(texel.atlas);
 let centre=textureLoad(probeTrace,vec2i(own*lp.hemisphere+at.ray),0).x;
 var result=centre;
 if(texel.valid){
  var sum=unpackLight(centre)*2.0;
  var weight=2.0;
  let pageProbe=vec2u(vec2f(scPageF(probe.page,4u),scPageF(probe.page,5u))*vec2f(cardSizeInProbes(probe.page)));
  let probeInCard=vec2i(pageProbe+radTileCoord(radTileAt(at.tile))*radTileProbes()+at.probe);
  for(var k=0u;k<neighbourCount();k++){gatherNeighbour(texel,probe.page,probeInCard+neighbourOffset(k),at.ray,&sum,&weight);}
  let noise=blueNoiseScalar(own*lp.hemisphere+at.ray,texel.temporal+1u);
  result=packLight(ditherLight(sum/weight,noise));
 }
 filtered[i]=result;
}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn radiosityToSh(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let p=id.x+id.y*n.x*${WORKGROUP_THREADS}u;
 let side=radTileProbes();
 if(p>=radTileCount()*side*side){return;}
 let inTile=p%(side*side);
 let probe=probeAt(p/(side*side),vec2u(inTile%side,inTile/side));
 let texel=radTexel(probe.page,probe.coord);
 if(!texel.inside){return;}
 var red=vec4f(0.0);var green=vec4f(0.0);var blue=vec4f(0.0);
 if(texel.valid){
  let own=probeAtlasCoord(texel.atlas);
  let rays=lp.hemisphere*lp.hemisphere;
  for(var r=0u;r<rays;r++){
   let ray=vec2u(r%lp.hemisphere,r/lp.hemisphere);
   let radiance=select(traceAt(own,ray),unpackLight(filtered[p*rays+r]),lgFlag(FLAG_FILTER));
   let basis=tvBasis(radiosityRay(texel.normal,texel.temporal,texel.cardCoord>>vec2u(lp.spacingShift),ray))*(TWO_PI/f32(rays));
   red+=basis*radiance.x;green+=basis*radiance.y;blue+=basis*radiance.z;
  }
 }
 let at=vec2i(probeAtlasCoord(texel.atlas));
 textureStore(outHarmonics,at,0,red);
 textureStore(outHarmonics,at,1,green);
 textureStore(outHarmonics,at,2,blue);
}`,
  [
    lightingCommonWgsl({ tables: B.tables, context: { binding: B.context, access: 'read' } }),
    surfaceTexelWgsl(lightingLayersWgsl(B.depth, B.normal)),
    radiosityCommonWgsl(),
    radiosityRayWgsl(B.noise),
    radiosityProbeVisibilityWgsl(B.hits),
    FILTER_WGSL,
    packLight,
    unpackLight,
    ditherLight,
  ],
)
