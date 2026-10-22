import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { PI } from '../../../../../math/src/wgsl/constants.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { spCommon, spParams } from './commonWgsl.ts'
import { spSurface } from './probesWgsl.ts'
import { SCREEN_PROBE_FORMATS as F, bindingTable } from './screenProbeLayout.ts'

/** The occlusion's bindings: the image's normals and flags beside its depth, the occlusion written. */
export const OCCLUSION_BINDINGS = bindingTable({
  params: [0, 'uniform'],
  normals: [1, 'float'],
  flags: [2, 'uint'],
  occlusion: [3, { store: F.occlusion }],
  blue: [4, 'float'],
})

const B = OCCLUSION_BINDINGS.at

/** What a level sets of the occlusion, beside the constants it shares. */
export interface OcclusionShape {
  /** Pixels a thread stands for along an axis: 1, or 2 where the occlusion is half the image's size. */
  downsample: number
  /** Whether the horizon search reads the depth pyramid's first level rather than the depth. */
  pyramid: boolean
  /** The power the foreground occluders' share is raised to. */
  power: number
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
 * THE SHORT-RANGE OCCLUSION: the contact shadow the probes, a probe a tile of pixels, cannot hold. A search of the depth round
 * each pixel for the horizon the nearby surfaces make, along slices of the pixel's view: `sp.occlusion.x` of them, each a plane
 * through the eye and the pixel at an angle the noise turns (the pixel's blue noise, `blueNoiseVec2`), and in each plane, from the pixel along both
 * ways, `sp.occlusion.y` samples of the depth, at a distance that grows as the square of their rank up to two tiles of pixels
 * (`2 · tile`, a pixel further than the self-occlusion of a texel). A slice's visibility is the analytic integral of the cosine
 * between its two horizons (`spSliceArcs`), its projected normal's weight; the pixel's, the slices' sum over what the
 * normal's projections could have given, never under a thirtieth. The planes are the world's: the camera's right and up read as
 * the world's displacement of one pixel at the pixel's own depth, the depth along the view the linear depth.
 */
const SP_OCCLUSION = wgslBlock(
  'SP_OCCLUSION',
  [PI],
  `@group(0) @binding(${B.occlusion}) var occlusionOut:texture_storage_2d<${F.occlusion},write>;
/** The arcs of one slice at angle \`phi\`: the weighted visibility (\`x\`) and what the normal's projection could have given (\`y\`). */
fn spSliceArcs(phi:f32,centre:vec2f,s:SpSurface,V:vec3f,right:vec3f,up:vec3f,depth:f32,noise:vec2f)->vec2f{
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
 return span*vec2f(arc0+arc1,angle*sinNormal+cosNormal);
}
@compute @workgroup_size(8,8)
fn occlusion(@builtin(global_invocation_id) id:vec3u){
 let pixel=id.xy*SP_OCCLUSION_DOWNSAMPLE;
 if(any(pixel>=sp.size.xy)){return;}
 let s=spSurfaceAt(pixel);
 var visibility=1.0;
 if(s.lit){
  let centre=vec2f(pixel)+vec2f(0.5);
  let depth=max(surfaceLinearDepth(s.P),1e-3);
  let V=viewToEye(s.P);
  let right=normalize(worldAt(centre+vec2f(1.0,0.0),s.z)-s.P);
  let up=normalize(worldAt(centre-vec2f(0.0,1.0),s.z)-s.P);
  let noise=blueNoiseVec2(pixel,sp.size.w);
  var arcs=vec2f(0.0);
  for(var slice=0u;slice<u32(sp.occlusion.x);slice++){
   arcs+=spSliceArcs((f32(slice)+noise.x)/sp.occlusion.x*PI,centre,s,V,right,up,depth,noise);
  }
  visibility=max(arcs.x/max(arcs.y,1e-6),0.03);
 }
 textureStore(occlusionOut,vec2i(id.xy),vec4f(visibility,0.0,0.0,0.0));
}`,
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
      SP_OCCLUSION,
    ],
  )
