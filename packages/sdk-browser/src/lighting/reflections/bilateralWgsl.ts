import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { PI } from '../../../../math/src/wgsl/constants.ts'
import { fastAcos, fastAtan } from '../../../../math/src/wgsl/geometry.ts'
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
import { REFLECTION_PROBES_LEFT_WGSL, reflectionEnvironmentLobesWgsl } from './weight.ts'

/** What the pixel `own` at `coord` of the surface `layer` reflects (`BilateralSeen`, its value `seen`):
 *  over a resolve tile, the ray it traces from its history where it holds one, with the environment through its lobes
 *  and the share of each lobe the ray answers (`bilateralSeen`); over a clear tile, the environment alone for the front surface, nothing for the opaque one (`bilateralField`). */
const SEEN = {
  resolve: (layer: number) => `let seen=bilateralSeen(coord,own,${layer}u);`,
  clear: (layer: number) => `let seen=bilateralField(own,${layer}u);`,
} as const

/** What a surface writes of what it reflects, before the resolve weighs it: the opaque one into the reflection target the resolve reads —
 *  layer 0 the rays' answer, the radiance of the lobe the ray serves (a bare pixel's base lobe by its share, a coated pixel's coat whole), with the base lobe's share in its alpha, or, flagged
 *  where it left its base lobe to the rough light (`REFLECTION_PROBES_LEFT`: no ray traced for it, or none for the base lobe), the ray's answer for the coat alone;
 *  layer 1 the share of the coat's lobe the rays leave to the rough light, in its alpha, written only where the surface has a coat
 *  (the resolve reads it under `hasCoat`, nothing else reads it). The rough light itself, the environment through the base lobe, is not stored: the
 *  resolve samples the sky's cube where it blends it (`resolvedReflectionRough`), for the pixels that leave a share to it alone;
 *  the front one where the forward fragments read it, each lobe's ray and environment blended by its share (`bilateralBlended`). */
const WRITE = [
  `let entirely=bilateralProbesLeft||!(seen.share.x>0.0);
  textureStore(reflectionOut,coord,0,vec4f(seen.ray*(seen.share.x+seen.share.y),select(seen.share.x,REFLECTION_PROBES_LEFT,entirely)));
  if(hasCoat()){textureStore(reflectionOut,coord,1,vec4f(0.0,0.0,0.0,1.0-seen.share.y));}`,
  `let blended=bilateralBlended(seen);
  textureStore(frontOut,coord,vec4u(frontPack(blended.base),frontPack(blended.coat),bitcast<u32>(reflectionFrontDepth(coord)),0u));`,
] as const

/** What a pixel that reflects nothing leaves behind it: the opaque surface nothing, the front one the front's depth alone (`FRONT_TRACED_FORMAT`'s third word, which a forward
 *  fragment matches its own depth against) over no radiance, so that every pixel of the front layer holds its depth of this image, never an earlier one's. */
const NOT_REFLECTING = [
  '',
  'textureStore(frontOut,coord,vec4u(0u,0u,bitcast<u32>(reflectionFrontDepth(coord)),0u));',
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
 if(!surfaceReflects(flags)){${NOT_REFLECTING[layer]}return;}
 let own=reflectingPixelAt(${layer}u,coord,flags);
 ${SEEN[kind](layer)}
 ${WRITE[layer]}
}`

/** The opaque clear: the constants alone, no surface read but the flags. A pixel of a clear tile traces nothing, so it carries no coat (a clear coat always traces) and its
 *  lobe is left whole to the rough light (`REFLECTION_PROBES_LEFT`, the answer `bilateralField` gives the opaque surface), and a coat, if the pixel were to hold one, whole too (layer 1's alpha, which the resolve
 *  reads only under `hasCoat`, so no earlier image's share is read): neither its depth, its normal nor its lobes are read. */
const CLEAR_OPAQUE = `@compute @workgroup_size(${REFLECTION_SIDE},${REFLECTION_SIDE})
fn clearOpaque(@builtin(workgroup_id) tile:vec3u,@builtin(num_workgroups) groups:vec3u,@builtin(local_invocation_id) local:vec3u){
 let t=reflectionTileOf(tile,groups);
 if(t==REFLECTION_NO_TILE){return;}
 let id=reflectionTileOrigin(t)+local.xy;
 if(any(id>=reflectionViewport())){return;}
 let coord=vec2i(id);
 ${BEFORE.clear}
 if(!surfaceReflects(surfaceFlagsAt(coord))){return;}
 textureStore(reflectionOut,coord,0,vec4f(0.0,0.0,0.0,REFLECTION_PROBES_LEFT));
 textureStore(reflectionOut,coord,1,vec4f(0.0,0.0,0.0,1.0));
}`

const BILATERAL_ENTRIES = [
  bilateralEntry('bilateralOpaque', 0, 'resolve'),
  CLEAR_OPAQUE,
  bilateralEntry('bilateralFront', 1, 'resolve'),
  bilateralEntry('clearFront', 1, 'clear'),
].join('\n')

/**
 * THE LAST PASS, a thread a pixel, over each of two lists the classification writes (`tiles.ts`): the
 * resolve tiles (`bilateralOpaque`, `bilateralFront`) and the clear ones (`clearOpaque`, `clearFront`),
 * whose kernel first empties the resolved pixel and the history, before any resolve reads them — the
 * constants alone there. A pixel whose lobe traces nothing reflects
 * the environment through its lobes (`bilateralField`), at every pixel: a rough lobe's reflection is
 * so blurred that a smooth one answers it, the same every image — no history, no filter.
 * The opaque surface leaves the environment (`reflectionEnvironment`, the sky light's cube) through its base lobe alone, the one rough light both of its lobes share, to the opaque resolve, which samples it where it blends
 * the rest of each lobe with the screen probes' (`resolvedIndirect`, `REFLECTION_PROBES_LEFT`);
 * the front's, which the forward fragments read as it is, the environment through its base lobe for the rest of both lobes.
 *
 * A pixel with a history (`bilateralIn`, this image's accumulation, a texel a pixel) reads its own, and
 * where it is short or still noisy, the spatial filter: its disocclusion, one minus its count over
 * the disocclusion frames — none where the history holds no more than one image (a mirror's holds two) or the
 * setting is zero —; its spread, the standard deviation of its luminance the history's
 * second moment gives (`historyMoment`). It filters where the spread passes half its luminance (at
 * least 0.1) — a converged pixel whose rays still meet the sky one image and a building the next — or
 * past 0.01 of disocclusion, over a radius of the filter's radius × saturate(8 · roughness)
 * pixels past one (a mirror's reflection is never blurred), the filter's taps of neighbours to
 * twice as many as the disocclusion grows, inside the view (a neighbour is the pixel plus the tap's offset and a half, cut to a whole number toward zero). Each neighbour is weighed by three factors: its
 * depth, 2 to the minus the depth weight scale times the square of its distance from the pixel's plane over
 * the pixel's depth; its normal, one minus the angle between the two normals over the half angle of the pixel's
 * lobe (the angle whose tangent is three times the square of its roughness, plus 0.01 radian, four times as wide
 * at a full disocclusion, held between 0.01 radian and a right angle), the angle read to within
 * 0.009 radian (`fastAcos`); and its luminance against the pixel's, exp2(−|L − Lₙ| / spread), which goes to one as
 * the disocclusion grows. The samples are tonemapped once more by the disocclusion, L / (1 + disocclusion · L)
 * (`bilateralTonemap`), to keep one firefly of a new pixel from its neighbours, and the mean is turned back.
 * A converged, quiet pixel keeps its own. The same rule for every pixel, in the denoiser's space
 * (`reflectionDenoised`).
 *
 * What the history holds is the ray of the lobe the pixel traces (`reflectingPixelAt`'s top): under a clear coat,
 * the coat's. A coated pixel's layers are answered apart (`bilateralShares`): its coat is the ray whole, whatever the coat's roughness, and the base lobe
 * under it the rough light alone, the environment, or for the opaque surface the screen probes, whatever the base lobe's roughness; a bare lobe answers the share its roughness gives it.
 *
 * It writes the surface's answer: the opaque one the ray's answer and the environment, before any weight, into the
 * reflection target the resolve reads, which blends the rest of the base lobe with the screen probes' and weighs the whole on the pixel's own
 * reflectance, normal, roughness and lobes (`reflectionShare`) — a surface's texture detail is the pixel's; the front one writes the blend where the forward fragments read it,
 * one load (`forwardTrace`). A pixel that does not reflect writes nothing, and nothing reads it.
 */
export const REFLECTION_BILATERAL_WGSL = wgslBlock(
  'REFLECTION_BILATERAL_WGSL',
  [
    REFLECTION_TILES_WGSL,
    REFLECTION_SURFACES_WGSL,
    REFLECTION_TEXEL_WGSL,
    REFLECTION_REUSE_WGSL,
    PI,
    fastAcos,
    fastAtan,
    // The resolved pixels and the history, as the resolve and the accumulation declare them.
    REFLECTION_RESOLVE_WGSL,
    REFLECTION_TEMPORAL_WGSL,
    reflectionEnvironmentLobesWgsl(true),
    FRONT_PACK_WGSL,
    surfaceReflects,
    REFLECTION_PROBES_LEFT_WGSL,
  ],
  `@group(0) @binding(${B.bilateralIn}) var bilateralIn:texture_2d<u32>;
@group(0) @binding(${B.target}) var reflectionOut:texture_storage_2d_array<${HDR_FORMAT},write>;
@group(0) @binding(${B.frontTarget}) var frontOut:texture_storage_2d<${FRONT_TRACED_FORMAT},write>;
/** A radiance \`c\` of the denoiser's space tonemapped by \`heavy\`, the disocclusion: c / (1 + heavy · L(c)), a second, heavier
 *  tonemap of the filter's samples that keeps one firefly of a pixel new to the screen from lighting its neighbours;
 *  \`bilateralUntonemap\` turns it back. */
fn bilateralTonemap(c:vec3f,heavy:f32)->vec3f{return c/(1.0+heavy*luminance(c));}
fn bilateralUntonemap(c:vec3f,heavy:f32)->vec3f{return c/(1.0-heavy*luminance(c));}
/** What the lobe the pixel \`own\` at \`coord\` of the surface \`layer\` traces reflects of its history
 *  \`held\`, and, while that is short or noisy, of its neighbours' (the spatial filter). */
fn bilateralTop(coord:vec2i,own:ReflectingPixel,held:vec4u,layer:u32)->vec3f{
 // The boost runs while the history is shorter than the disocclusion frames, where it holds more than one image (a
 // mirror's holds two) and the setting is not zero.
 var disocclusion=0.0;
 if(u32(reflectionMaxFrames(reflectionView.denoise.x,own.top))>1u&&reflectionView.spread.w>0.0){
  disocclusion=1.0-saturate(historyCount(held)/reflectionView.spread.w);
 }
 let radius=reflectionView.spread.y*saturate(own.top*8.0);
 let mine=reflectionDenoised(texelRadiance(held.xy));
 let lum=luminance(mine);
 let deviation=sqrt(max(historyMoment(held)-lum*lum,0.0));
 let noisy=deviation/max(lum,0.1)>0.5;
 if(!(reflectionDone(REFLECTION_BILATERAL)&&(noisy||disocclusion>0.01)&&radius>1.0)){return texelRadiance(held.xy);}
 let taps=u32(mix(f32(reflectionView.taps.y),f32(2u*reflectionView.taps.y),disocclusion)+0.5);
 // The lobe's half angle, a normal weighs nothing past it: widened four times as the disocclusion grows.
 let halfAngle=clamp((fastAtan(3.0*own.top*own.top)+0.01)*mix(1.0,4.0,disocclusion),0.01,0.5*PI);
 let depth=surfaceLinearDepth(own.P);
 let size=vec2i(reflectionViewport());
 // A 2 × 2 seed, the same taps for the four pixels of a block, so their reads stay coherent.
 let seed=reflectionReuseSeed(coord%vec2i(2));
 var sum=bilateralTonemap(mine,disocclusion);
 var total=1.0;
 for(var k=0u;k<taps;k++){
  let tap=vec2i(vec2f(coord)+radius*reflectionReuseTap(k,taps,seed)+vec2f(0.5));
  if(any(tap<vec2i(0))||any(tap>=size)){continue;}
  let n=textureLoad(bilateralIn,tap,0);
  if(!historyValid(n)){continue;}
  // Depth weight: the neighbour's distance from the pixel's plane over the pixel's depth, in a gaussian.
  let off=abs(dot(surfacePointAt(layer,tap)-own.P,own.N))/depth;
  let level=exp2(-reflectionView.reach.w*off*off);
  // Normal weight: the angle between the two normals over the lobe's half angle.
  let angle=fastAcos(saturate(dot(own.N,normalize(surfaceNormalAt(tap).xyz))));
  let across=1.0-saturate(angle/halfAngle);
  let theirs=reflectionDenoised(texelRadiance(n.xy));
  // Luminance weight: a neighbour as far from the pixel as its own spread weighs half, whole at a
  // full disocclusion, where the history's spread says nothing yet.
  let near=mix(exp2(-abs(lum-luminance(theirs))/max(deviation,0.001)),1.0,disocclusion);
  let w=level*across*near;
  sum+=w*bilateralTonemap(theirs,disocclusion);
  total+=w;
 }
 return reflectionLinear(bilateralUntonemap(sum/total,disocclusion));
}
/** What a pixel reflects, for the last pass: the ray its lobe traces, denoised (\`ray\`); the environment through its base lobe (\`field\`), the
 *  rough light of both its lobes; and the share of each lobe the ray answers (\`share\`, the base's and the coat's: a bare lobe's \`reflectionTraceShare\` of its roughness, the reference's
 *  fade to the lobe's rough light; a coated pixel's coat whole and its base lobe none), the environment answering the rest. */
struct BilateralSeen{ray:vec3f,field:vec3f,share:vec2f,}
/** Whether this pixel's opaque answer left its base lobe's rough light to the opaque resolve. */
var<private> bilateralProbesLeft:bool=false;
/** What the front surface's lobes reflect of the environment alone: the radiance around the scene through its base lobe, the rough light of both its lobes
 *  (the opaque surface's is sampled by the resolve, which lays it over the screen probes'). */
fn bilateralEnvironment(own:ReflectingPixel,layer:u32)->vec3f{
 if(layer==1u){return reflectionEnvironmentOf(own.N,own.V,own.rough).base;}
 return vec3f(0.0);
}
/** The shares of \`own\`'s lobes a ray answers: a bare pixel's base lobe, by its roughness; a pixel that carries a clear coat has the ray answer its coat whole and
 *  its base lobe, under the coat, not at all, the rough light being the base lobe's alone. */
fn bilateralShares(own:ReflectingPixel)->vec2f{
 if(lobes.on&&lobes.coat>0.0){return vec2f(0.0,1.0);}
 return vec2f(reflectionTraceShare(lobeAlpha(reflectionSmoothed(own.rough)),own.flags),0.0);
}
/** What the pixel \`own\` of the surface \`layer\` reflects of the environment alone, no ray answering it: its lobes' rough light is, for the opaque
 *  surface, the screen probes' the opaque resolve reads (\`REFLECTION_PROBES_LEFT\`); for the front one, which the forward fragments read as it is,
 *  the environment. */
fn bilateralField(own:ReflectingPixel,layer:u32)->BilateralSeen{
 if(layer==0u){bilateralProbesLeft=true;}
 return BilateralSeen(vec3f(0.0),bilateralEnvironment(own,layer),vec2f(0.0));
}
/** What the pixel \`own\` at \`coord\` reflects: the ray its lobe traces from its history where it holds one, with the environment and the
 *  shares; the environment alone where it does not. */
fn bilateralSeen(coord:vec2i,own:ReflectingPixel,layer:u32)->BilateralSeen{
 let held=textureLoad(bilateralIn,coord,0);
 if(!historyValid(held)){return bilateralField(own,layer);}
 let share=bilateralShares(own);
 // The environment is read only where something reads it: the share of a lobe the ray leaves to it, for the forward fragments (the opaque resolve samples its own);
 // a bare pixel a ray answers whole needs none.
 var field=vec3f(0.0);
 if(layer==1u&&(share.x<1.0||share.y<1.0)){field=bilateralEnvironment(own,layer);}
 return BilateralSeen(bilateralTop(coord,own,held,layer),field,share);
}
/** What each lobe reflects, the ray's share of it and the environment's through the base lobe for the rest: share · ray + (1 − share) · environment. */
fn bilateralBlended(seen:BilateralSeen)->Reflected{
 return Reflected(mix(seen.field,seen.ray,seen.share.x),mix(seen.field,seen.ray,seen.share.y));
}
${BILATERAL_ENTRIES}`,
)
