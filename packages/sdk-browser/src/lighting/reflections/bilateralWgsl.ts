import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { f0Of } from '../../../../math/src/wgsl/lighting.ts'
import { surfaceReflects } from '../../materials/surface/surfaceModel.ts'
import { HDR_FORMAT } from '../../scene/targetFormats.ts'
import { REFLECTION_SIDE } from './constants.ts'
import { FRONT_TRACED_FORMAT } from './frontLayer.ts'
import { FRONT_PACK_WGSL } from './frontPackWgsl.ts'
import { REFLECTION_TILES_WGSL, REFLECTION_TRACE_BINDINGS as B } from './trace/traceBindings.ts'
import { REFLECTION_SURFACES_WGSL } from './surfacesWgsl.ts'
import { REFLECTION_RESOLVE_WGSL, REFLECTION_REUSE_WGSL } from './resolveWgsl.ts'
import { REFLECTION_TEMPORAL_WGSL } from './temporalWgsl.ts'
import { REFLECTION_TEXEL_WGSL } from './texelWgsl.ts'
import {
  REFLECTION_PROBES_LEFT_WGSL,
  reflectionFieldLobesWgsl,
  reflectionWeighWgsl,
} from './weight.ts'

/** What the pixel `own` at `coord` of the surface `layer` reflects (`Reflected`, its value `seen`):
 *  over a resolve tile, the lobe it traces from its history where it holds one (`bilateralSeen`); over
 *  a clear tile, the field alone (`bilateralField`). */
const SEEN = {
  resolve: (layer: number) => `let seen=bilateralSeen(coord,own,${layer}u);`,
  clear: (layer: number) => `let seen=bilateralField(own,${layer}u);`,
} as const

/** What a surface writes of what it reflects: the opaque one weighed on its own reflectance into the
 *  reflection target the resolve reads — flagged where it left its base lobe's probes to the resolve
 *  (`REFLECTION_PROBES_LEFT`) —, the front one where the forward fragments read it. */
const WRITE = [
  `let base=textureLoad(traceBase,coord,0);
  let share=reflectionShare(seen,f0Of(base.rgb,base.a),own.rough,own.N,own.V);
  textureStore(reflectionOut,coord,vec4f(share,select(1.0,REFLECTION_PROBES_LEFT,bilateralProbesLeft)));`,
  'textureStore(frontOut,coord,vec4u(frontPack(seen.base),frontPack(seen.coat),0u,0u));',
] as const

/** What a kernel does before it reads its pixel: the clear empties the resolved pixel and the history,
 *  so the accumulation's window and the next image's history read nothing of an earlier image there. */
const BEFORE = {
  resolve: '',
  clear: 'textureStore(resolvedOut,coord,vec4u(0u));textureStore(historyOut,coord,vec4u(0u));',
} as const

/** The last pass's entry `name`: the surface `layer` (0 the opaque, 1 the front), over the tiles of
 *  `kind`. */
const bilateralEntry = (
  name: string,
  layer: 0 | 1,
  kind: keyof typeof SEEN,
) => `@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn ${name}(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let id=reflectionTileOrigin(t)+local.xy;
 if(any(id>=reflectionViewport())){return;}
 let coord=vec2i(id);
 ${BEFORE[kind]}
 let flags=surfaceFlagsAt(coord);
 if(!surfaceReflects(flags)){return;}
 let own=reflectingPixelAt(${layer}u,coord,flags);
 ${SEEN[kind](layer)}
 ${WRITE[layer]}
}`

const BILATERAL_ENTRIES = [
  bilateralEntry('bilateralOpaque', 0, 'resolve'),
  bilateralEntry('clearOpaque', 0, 'clear'),
  bilateralEntry('bilateralFront', 1, 'resolve'),
  bilateralEntry('clearFront', 1, 'clear'),
].join('\n')

/**
 * THE LAST PASS, a thread a pixel, over each of two lists the classification writes (`tiles.ts`): the
 * resolve tiles (`bilateralOpaque`, `bilateralFront`) and the clear ones (`clearOpaque`, `clearFront`),
 * whose kernel first empties the resolved pixel and the history, before any resolve reads them — the
 * field alone there, apart from the history's heavy kernel. A pixel whose lobe traces nothing reads
 * the probes' field through its lobes (`bilateralField`), at every pixel: a rough lobe's reflection is
 * so blurred that the probes' smooth field answers it, the same every image — no history, no filter.
 * The opaque surface's base lobe takes the surroundings alone here and leaves its probes to the opaque
 * resolve, which gathers them in the one read of its bounce (`resolvedIndirect`,
 * `REFLECTION_PROBES_LEFT`), its diffuse and rough specular from the probes in one pass; the front's,
 * which the forward fragments read as it is, the field whole.
 *
 * A pixel with a history (`bilateralIn`, this image's accumulation, a texel a pixel) reads its own, and
 * where it is short or still noisy, the spatial filter: its disocclusion, one minus its count over
 * `REFLECTION_DISOCCLUSION_FRAMES`; its spread, the standard deviation of its luminance the history's
 * second moment gives (`historyMoment`). It filters where the spread passes half its luminance (at
 * least 0.1) — a converged pixel whose rays still meet the sky one image and a building the next — or
 * past 0.01 of disocclusion, over a radius of `REFLECTION_FILTER_RADIUS` × saturate(8 · roughness)
 * pixels past one (a mirror's reflection is never blurred), `REFLECTION_FILTER_TAPS` neighbours to
 * twice as many as the disocclusion grows, inside the view. Each neighbour is weighed by the
 * same-surface test on its own surface and by its luminance against the pixel's,
 * exp2(−|L − Lₙ| / spread), which goes to one as the disocclusion grows. A converged, quiet pixel
 * keeps its own. The same rule for every pixel, in the denoiser's space (`reflectionDenoised`).
 *
 * What the history holds is the lobe the pixel traces (`reflectingPixelAt`'s top): under a clear coat,
 * the coat's, its base the probes' field (`bilateralFieldBase`): the coat is the sharper lobe, the
 * base under it rough enough for the probes; elsewhere the base's.
 *
 * It writes the surface's answer: the opaque one weighs it on the pixel's own reflectance, normal,
 * roughness and lobes (`reflectionShare`) — a surface's texture detail is the pixel's — into the
 * reflection target the resolve reads; the front one writes it where the forward fragments read it,
 * one load (`forwardTrace`). A pixel that does not reflect writes nothing, and nothing reads it.
 */
export const REFLECTION_BILATERAL_WGSL = wgslBlock(
  'REFLECTION_BILATERAL_WGSL',
  [
    REFLECTION_TILES_WGSL,
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_REUSE_WGSL,
    // The resolved pixels and the history, as the resolve and the accumulation declare them.
    REFLECTION_RESOLVE_WGSL,
    REFLECTION_TEMPORAL_WGSL,
    reflectionWeighWgsl(true),
    reflectionFieldLobesWgsl(true),
    FRONT_PACK_WGSL,
    surfaceReflects,
    f0Of,
    REFLECTION_PROBES_LEFT_WGSL,
  ],
  `@group(0) @binding(${B.bilateralIn}) var bilateralIn:texture_2d<u32>;
@group(0) @binding(${B.base}) var traceBase:texture_2d<f32>;
@group(0) @binding(${B.target}) var reflectionOut:texture_storage_2d<${HDR_FORMAT},write>;
@group(0) @binding(${B.frontTarget}) var frontOut:texture_storage_2d<${FRONT_TRACED_FORMAT},write>;
/** The linear depth (\`surfaceLinearDepth\`) of a depth \`z\` of the view, straight from the projection:
 *  under a perspective \`z = A + B / w\` (\`ReflectionView.slab\`: \`A\` its \`y\`), \`B\` the pixel's own
 *  (\`bilateralDepthB\`, of its depth \`z\` and linear depth \`depth\`), the same over the view; under an
 *  orthographic one the depth itself. No matrix a tap. */
fn bilateralDepthB(z:f32,depth:f32)->f32{return (z-reflectionView.slab.y)*depth;}
fn bilateralLinearDepth(z:f32,b:f32)->f32{
 return select(z,b/(z-reflectionView.slab.y),slabPerspective(reflectionView.slab));
}
/** What the lobe the pixel \`own\` at \`coord\` of the surface \`layer\` traces reflects of its history
 *  \`held\`, and, while that is short or noisy, of its neighbours' (the spatial filter). */
fn bilateralTop(coord:vec2i,own:ReflectingPixel,held:vec4u,layer:u32)->vec3f{
 let disocclusion=1.0-saturate(historyCount(held)/REFLECTION_DISOCCLUSION_FRAMES);
 let radius=REFLECTION_FILTER_RADIUS*saturate(own.top*8.0);
 let mine=reflectionDenoised(texelRadiance(held.xy));
 let lum=luminance(mine);
 let deviation=sqrt(max(historyMoment(held)-lum*lum,0.0));
 let noisy=deviation/max(lum,0.1)>0.5;
 if(!((noisy||disocclusion>0.01)&&radius>1.0)){return texelRadiance(held.xy);}
 let taps=u32(mix(f32(REFLECTION_FILTER_TAPS),f32(2u*REFLECTION_FILTER_TAPS),disocclusion)+0.5);
 let depth=surfaceLinearDepth(own.P);
 let b=bilateralDepthB(own.z,depth);
 let span=reflectionSurfaceSpan(depth,own.N,own.V);
 let size=vec2i(reflectionViewport());
 // A 2 × 2 seed, the same taps for the four pixels of a block, so their reads stay coherent.
 let seed=reflectionReuseSeed(coord%vec2i(2));
 var sum=mine;
 var total=1.0;
 for(var k=0u;k<taps;k++){
  let tap=coord+vec2i(round(radius*reflectionReuseTap(k,taps,seed)));
  if(any(tap<vec2i(0))||any(tap>=size)||all(tap==coord)){continue;}
  let n=textureLoad(bilateralIn,tap,0);
  if(!historyValid(n)){continue;}
  let apart=distance(vec2f(tap),vec2f(coord));
  let other=bilateralLinearDepth(surfaceDepthAt(layer,tap),b);
  let same=reflectionSameSurface(span,depth,own.N,other,normalize(surfaceNormalAt(tap).xyz),apart);
  if(!(same>0.0)){continue;}
  let theirs=reflectionDenoised(texelRadiance(n.xy));
  // Luminance weight: a neighbour as far from the pixel as its own spread weighs half, whole at a
  // full disocclusion, where the history's spread says nothing yet.
  let near=mix(exp2(-abs(lum-luminance(theirs))/max(deviation,0.001)),1.0,disocclusion);
  let w=same*near;
  sum+=w*theirs;
  total+=w;
 }
 return reflectionLinear(sum/total);
}
/** Whether this pixel's opaque answer left its base lobe's probes to the opaque resolve. */
var<private> bilateralProbesLeft:bool=false;
/** What the base lobe of \`own\`, on the surface \`layer\`, reads of the field: the opaque one the
 *  surroundings alone, its probes left to the opaque resolve (\`REFLECTION_PROBES_LEFT\`); the front one
 *  the field whole, which the forward fragments read as it is. */
fn bilateralFieldBase(own:ReflectingPixel,layer:u32)->vec3f{
 if(layer==0u){bilateralProbesLeft=true;return reflectionEnvironment(reflect(-own.V,own.N));}
 return reflectionFieldBase(own.P,own.N,own.V,own.rough);
}
/** What \`own\`'s lobes reflect of the field alone: its base lobe's (\`bilateralFieldBase\`) and its coat's. */
fn bilateralField(own:ReflectingPixel,layer:u32)->Reflected{
 return Reflected(bilateralFieldBase(own,layer),reflectionFieldCoat(own.P,own.V));
}
/** What the pixel \`own\` at \`coord\` reflects: the lobe it traces from its history where it holds one,
 *  through the field where it does not; under a clear coat, the base lobe through the field. */
fn bilateralSeen(coord:vec2i,own:ReflectingPixel,layer:u32)->Reflected{
 let held=textureLoad(bilateralIn,coord,0);
 if(!historyValid(held)){return bilateralField(own,layer);}
 let top=bilateralTop(coord,own,held,layer);
 if(lobes.on&&lobes.coat>0.0){return Reflected(bilateralFieldBase(own,layer),top);}
 return Reflected(top,vec3f(0.0));
}
${BILATERAL_ENTRIES}`,
)
