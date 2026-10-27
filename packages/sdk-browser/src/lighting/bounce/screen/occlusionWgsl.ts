import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { computeStorageTextureEntry } from '../../../gpu/core/computeBindings.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { SP_BENT_WGSL } from './historyWgsl.ts'
import { spSurface } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** The occlusion's bindings: the image's normals and flags beside its depth, the occlusion written (as `F.occlusion` says; with the
 *  bent normal, `occlusionEntries` binds it as `F.bentOcclusion`). */
export const OCCLUSION_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  normals: [1, 'float'],
  flags: [2, 'uint'],
  occlusion: [3, { store: F.occlusion }],
  blue: [4, 'float'],
})

const B = OCCLUSION_BINDINGS.at

/** The layout of the occlusion's group: its amount alone, or, with the bent normal, the word that holds the direction of the open sky too. */
export const occlusionEntries = (bentNormal: boolean) =>
  OCCLUSION_BINDINGS.entries.map((entry) =>
    entry.binding === B.occlusion && bentNormal
      ? computeStorageTextureEntry(B.occlusion, F.bentOcclusion)
      : entry,
  )

/** What a level sets of the occlusion, beside the constants it shares. */
export interface OcclusionShape {
  /** Pixels a thread stands for along an axis: 1, or 2 where the occlusion is half the image's size. */
  downsample: number
  /** Whether the horizon search reads the depth pyramid's first level rather than the depth. */
  pyramid: boolean
  /** The power the foreground occluders' share is raised to. */
  power: number
  /** Whether the pass keeps the direction of the open sky, the bent normal, beside the amount of it. */
  bentNormal: boolean
}

/**
 * THE HORIZON OF A SIDE after a sample (`spHorizonCos`): the cosine of its angle from the view vector, held to `low` by the share
 * the sample is in front — a sample nearer the eye than the foreground fraction of the pixel's depth, whose horizon falls to the
 * lowest one the normal allows, raised to the foreground power (a wall in front of the search is not what occludes the
 * surface behind it) —, the higher of it and the horizon so far.
 */
const SP_HORIZON = (shape: OcclusionShape) =>
  wgslBlock(
    `SP_HORIZON(${shape.pyramid}, ${shape.power})`,
    [],
    `const SP_FOREGROUND_POWER:f32=${shape.power};
fn spOcclusionDepth(pix:vec2i)->f32{
 ${shape.pyramid ? 'return hizCellCullFarthest(pix/vec2i(2),1);' : 'return hizOpaqueDepth(pix);'}
}
fn spHorizonCos(at:vec2f,P:vec3f,V:vec3f,depth:f32,invForeground:f32,low:f32,current:f32)->f32{
 if(any(at<=vec2f(0.0))||any(at>=vec2f(sp.size.xy))){return current;}
 let z=spOcclusionDepth(vec2i(floor(at)));
 if(z<=0.0){return current;}
 let Q=worldAt(at,z);
 let delta=Q-P;
 let cosine=dot(delta/max(length(delta),1e-6),V);
 let held=mix(cosine,low,saturate(pow(abs(surfaceLinearDepth(Q)-depth)*invForeground,SP_FOREGROUND_POWER)));
 return max(current,held);
}`,
  )

/**
 * THE BENT NORMAL of a slice, the direction of the open sky it finds: with the horizons `h0` and `h1` the slice found and the angle
 * `angle` (sine `sinNormal`) of the pixel's projected normal, the sky's mean direction in the slice's plane — `t0` along the slice,
 * `t1` toward the eye, the analytic integrals of the visible arc (Jimenez et al. 2016, "Practical Real-Time Strategies for Accurate
 * Indirect Occlusion", algorithm 2) — is carried by the slice's directions (`right` and `up` of the pixel's plane by the slice's angle
 * `cs`, `sn`, `back` toward the eye) to the pixel's view vector `V` by the shortest turn from the axis `back` (`spRotateOnto`: none
 * where the two nearly agree), and weighed by the length of the projected normal `span`.
 */
const SP_BENT_SLICE = wgslBlock(
  'SP_BENT_SLICE',
  [],
  `/** The unit \`v\` turned as the shortest turn takes the unit \`source\` onto the unit \`goal\`; unturned where they nearly agree or oppose. */
fn spRotateOnto(source:vec3f,goal:vec3f,v:vec3f)->vec3f{
 let e=dot(source,goal);
 if(abs(e)>1.0-0.0003){return v;}
 let c=cross(source,goal);
 return e*v+cross(c,v)+(1.0/(1.0+e))*dot(c,v)*c;
}
fn spBentSlice(h0:f32,h1:f32,angle:f32,sinNormal:f32,cs:f32,sn:f32,span:f32,V:vec3f,right:vec3f,up:vec3f,back:vec3f)->vec3f{
 let t0=(6.0*sin(h0-angle)-sin(3.0*h0-angle)+6.0*sin(h1-angle)-sin(3.0*h1-angle)+16.0*sinNormal-3.0*(sin(h0+angle)+sin(h1+angle)))/12.0;
 let t1=(-cos(3.0*h0-angle)-cos(3.0*h1-angle)+8.0*cos(angle)-3.0*(cos(h0+angle)+cos(h1+angle)))/12.0;
 return spRotateOnto(back,V,right*(cs*t0)+up*(sn*t0)+back*t1)*span;
}`,
)

/** The slice's output binding and the amount of one slice of the short-range occlusion. */
const spSliceWgsl = (
  shape: OcclusionShape,
) => `@group(0) @binding(${B.occlusion}) var occlusionOut:texture_storage_2d<${shape.bentNormal ? F.bentOcclusion : F.occlusion},write>;
/** The amount of one slice at angle \`phi\`: the weighted visibility (\`arcs.x\`) and what the normal's projection could have given (\`arcs.y\`), the direction of its open sky (\`bent\`). */
struct SpSlice{arcs:vec2f,bent:vec3f,}
fn spSliceArcs(phi:f32,centre:vec2f,s:SpSurface,V:vec3f,right:vec3f,up:vec3f,back:vec3f,depth:f32,noise:vec2f)->SpSlice{
 let cs=cos(phi);let sn=sin(phi);
 let direction=right*cs+up*sn;
 let orthogonal=direction-dot(direction,V)*V;
 let axis=normalize(cross(orthogonal,V));
 let projected=s.N-axis*dot(s.N,axis);
 let span=max(length(projected),1e-6);
 let cosNormal=saturate(dot(projected,V)/span);
 let angle=sign(dot(orthogonal,projected))*acos(cosNormal);
 let sinNormal=sin(angle);
 let low0=cos(angle+0.5*PI);
 let low1=cos(angle-0.5*PI);
 var horizon0=low0;
 var horizon1=low1;
 let invForeground=1.0/(depth*sp.occlusion.z);
 for(var n=0u;n<u32(sp.occlusion.y);n++){
  let fraction=(f32(n)+noise.y)/sp.occlusion.y;
  let offset=vec2f(cs,-sn)*(fraction*fraction*f32(sp.size.z)*2.0+1.0);
  horizon0=spHorizonCos(centre+offset,s.P,V,depth,invForeground,low0,horizon0);
  horizon1=spHorizonCos(centre-offset,s.P,V,depth,invForeground,low1,horizon1);
 }
 let h0=-acos(clamp(horizon1,-1.0,1.0));
 let h1=acos(clamp(horizon0,-1.0,1.0));
 let arc0=(cosNormal+2.0*h0*sinNormal-cos(2.0*h0-angle))/4.0;
 let arc1=(cosNormal+2.0*h1*sinNormal-cos(2.0*h1-angle))/4.0;
 let arcs=span*vec2f(arc0+arc1,angle*sinNormal+cosNormal);
 ${shape.bentNormal ? 'return SpSlice(arcs,spBentSlice(h0,h1,angle,sinNormal,cs,sn,span,V,right,up,back));' : 'return SpSlice(arcs,vec3f(0.0));'}
}`

/**
 * THE PIXEL A TEXEL OF THE OCCLUSION STANDS FOR (`spOcclusionPixel`): where the occlusion is downsampled, the texel is not the
 * image's pixel at a fixed corner of its cell but one of the cell's four, which the image's stochastic phase (`sp.size.w`) and the
 * cell's place in its two by two block turn (a four-rooks pattern, each of the four pixels of a block taken in turn over four
 * images, `spOcclusionJitter`): the pixel the pass searches the horizon from, and the one the temporal pass weighs the texel by. At
 * the image's size the jitter is none.
 */
export const SP_OCCLUSION_CELLS = wgslBlock(
  'SP_OCCLUSION_CELLS',
  [],
  `fn spOcclusionJitter(cell:vec2u)->vec2u{
 if(SP_OCCLUSION_DOWNSAMPLE==1u){return vec2u(0u);}
 let rank=((cell.x&1u)+(cell.y&1u)*2u+sp.size.w)&3u;
 return vec2u((rank>>1u)&1u,1u-(rank&1u));
}
fn spOcclusionPixel(cell:vec2u)->vec2u{
 return min(cell*SP_OCCLUSION_DOWNSAMPLE+spOcclusionJitter(cell),sp.size.xy-vec2u(1u));
}`,
)

/** The kernel of the short-range occlusion: the slices of the pixel a texel stands for (`spOcclusionPixel`) summed to its visibility. */
const spOcclusionKernel = (shape: OcclusionShape) => `@compute @workgroup_size(8,8)
fn occlusion(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy*SP_OCCLUSION_DOWNSAMPLE>=sp.size.xy)){return;}
 let pixel=spOcclusionPixel(id.xy);
 let s=spSurfaceAt(pixel);
 var visibility=1.0;
 var opening=s.N;
 if(s.lit){
  let centre=vec2f(pixel)+vec2f(0.5);
  let depth=max(surfaceLinearDepth(s.P),1e-3);
  let V=viewToEye(s.P);
  let right=normalize(worldAt(centre+vec2f(1.0,0.0),s.z)-s.P);
  let up=normalize(worldAt(centre-vec2f(0.0,1.0),s.z)-s.P);
  let across=normalize(cross(right,up));
  let back=select(across,-across,dot(across,V)<0.0);
  let noise=blueNoiseVec2(pixel,sp.size.w);
  var arcs=vec2f(0.0);
  var bent=vec3f(0.0);
  for(var slice=0u;slice<u32(sp.occlusion.x);slice++){
   let found=spSliceArcs((f32(slice)+noise.x)/sp.occlusion.x*PI,centre,s,V,right,up,back,depth,noise);
   arcs+=found.arcs;
   bent+=found.bent;
  }
  visibility=max(arcs.x/max(arcs.y,1e-6),0.03);
  opening=select(s.N,normalize(bent),dot(bent,bent)>1e-12);
 }
 ${shape.bentNormal ? 'textureStore(occlusionOut,vec2i(id.xy),vec4u(spBentPack(opening*visibility),0u,0u,0u));' : 'textureStore(occlusionOut,vec2i(id.xy),vec4f(visibility,0.0,0.0,0.0));'}
}`

/**
 * THE SHORT-RANGE OCCLUSION: the contact shadow the probes, a probe a tile of pixels, cannot hold. A search of the depth round
 * each pixel for the horizon the nearby surfaces make, along slices of the pixel's view: `sp.occlusion.x` of them, each a plane
 * through the eye and the pixel at an angle the noise turns (the pixel's blue noise, `blueNoiseVec2`), and in each plane, from the pixel along both
 * ways, `sp.occlusion.y` samples of the depth, at a distance that grows as the square of their rank up to two tiles of pixels
 * (`2 · tile`, a pixel further than the self-occlusion of a texel). A slice's visibility is the analytic integral of the cosine
 * between its two horizons (`spSliceArcs`), its projected normal's weight; the pixel's, the slices' sum over what the
 * normal's projections could have given, never under a thirtieth. The planes are the world's: the camera's right and up read as
 * the world's displacement of one pixel at the pixel's own depth, the depth along the view the linear depth. With the bent normal
 * the pass also sums the slices' directions of open sky (`spBentSlice`), and writes the unit direction of the sum,
 * times the visibility, in one word (`spBentPack`): a pixel with no open sky keeps its normal as the direction.
 */
const SP_OCCLUSION = (shape: OcclusionShape) =>
  wgslBlock(
    `SP_OCCLUSION(${shape.bentNormal})`,
    shape.bentNormal
      ? [PI, SP_OCCLUSION_CELLS, SP_BENT_SLICE, SP_BENT_WGSL]
      : [PI, SP_OCCLUSION_CELLS],
    [spSliceWgsl(shape), spOcclusionKernel(shape)].join('\n'),
  )

/** The occlusion's program over the level's `shape` and `samples` of a tile. */
export const occlusionShader = (shape: OcclusionShape, samples: readonly [number, number]) =>
  wgslProgram(
    `${spParams(B.params)}
${wgslConsts({ SP_OCCLUSION_DOWNSAMPLE: shape.downsample })}`,
    [
      spCommon(samples),
      spSurface(B.normals, B.flags),
      blueNoiseWgsl(0, B.blue),
      SP_HORIZON(shape),
      SP_OCCLUSION(shape),
    ],
  )
