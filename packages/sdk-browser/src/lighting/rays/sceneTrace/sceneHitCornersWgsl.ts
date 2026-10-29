import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { octDecode } from '../../../../../math/src/wgsl/octahedral.ts'
import { inverseTranspose3, unitOrZero } from '../../../../../math/src/wgsl/inverseTranspose.ts'
import {
  RAY_TRACING_CORNER_AT,
  RAY_TRACING_FLAG_ATTRIBUTES,
  RAY_TRACING_FLAG_NORMALS,
} from '../../../../../sdk-core/src/contracts/rayTracingAbi.ts'
import { computeBufferEntry } from '../../../gpu/core/computeBindings.ts'
import type { SceneTrace } from './sceneTraceResources.ts'
import { sceneTraceWgsl } from './sceneTraceWgsl.ts'

/** The layout entry of the corners' attributes (`stCorners`) at binding `binding`. */
export const sceneHitCornersEntry = (binding: number) =>
  computeBufferEntry(binding, 'read-only-storage')

/** The bind group entry of the corners' attributes over the resources of `trace`. */
export const sceneHitCornersBindEntry = (
  trace: Pick<SceneTrace, 'corners'>,
  binding: number,
): GPUBindGroupEntry => ({ binding, resource: { buffer: trace.corners } })

/** The surface a hit has between its triangle's corners, before it is taken to the world: see `stCornerSurface`. */
const CORNER_SURFACE = `struct StCornerSurface{uv:vec2f,uvEdge1:vec2f,uvEdge2:vec2f,normal:vec3f,colour:vec4f,}
/** The attributes at the weights bary of the second and third corners of the triangle whose corners' words are a, b, c (four each: the
 *  texture coordinate, the octahedral normal, the colour): the coordinate and the colour interpolated, the normal interpolated and made unit
 *  (zero unless normalled, the record's corners carrying one). */
fn stCornerSurface(a:array<vec4u,3>,bary:vec2f,normalled:bool)->StCornerSurface{
 let w=vec3f(1.0-bary.x-bary.y,bary.x,bary.y);
 var out:StCornerSurface;
 var uvs:array<vec2f,3>;
 for(var k=0u;k<3u;k++){
  let c=a[k];
  uvs[k]=vec2f(bitcast<f32>(c[${RAY_TRACING_CORNER_AT.uvX}]),bitcast<f32>(c[${RAY_TRACING_CORNER_AT.uvY}]));
  out.uv+=w[k]*uvs[k];
  if(normalled){out.normal+=w[k]*octDecode(unpack2x16snorm(c[${RAY_TRACING_CORNER_AT.normal}]));}
  out.colour+=w[k]*unpack4x8unorm(c[${RAY_TRACING_CORNER_AT.colour}]);
 }
 let ta=uvs[1]-uvs[0];
 let tb=uvs[2]-uvs[0];
 out.uvEdge1=ta;
 out.uvEdge2=tb;
 out.normal=unitOrZero(out.normal);
 return out;
}`

/** What a material needs of a hit, in the world: see `stHitSurface`. */
const HIT_SURFACE = `struct StHitSurface{uv:vec2f,uvEdge1:vec2f,uvEdge2:vec2f,edge1:vec3f,edge2:vec3f,normal:vec3f,colour:vec4f,attributed:bool,}
fn stCornerAt(hit:StHit,k:u32)->vec4u{return stCorners[hit.triangle*3u+k];}
/** The surface of the hit hit (ST_BARYCENTRIC must have been asked).
 *  attributed says the triangle's record carries corner attributes; without them the surface is the geometry's: no coordinate, the face normal, a white colour.
 *  The normal is turned into the world as the face normal is and on the side the face normal faces. The texture is read at its finest, as a path that has a
 *  derivative of none reads it: the many samples of a pixel filter it. */
fn stHitSurface(hit:StHit)->StHitSurface{
 var out:StHitSurface;
 out.normal=hit.normal;
 out.colour=vec4f(1.0);
 let flags=stTable[hit.record*ST_RECORD_WORDS+ST_RECORD_FLAGS];
 out.attributed=(flags&${RAY_TRACING_FLAG_ATTRIBUTES}u)!=0u;
 let at=hit.triangle*ST_TRIANGLE_VECS;
 let v0=stTriangles[at];
 let v1=stTriangles[at+1u];
 let v2=stTriangles[at+2u];
 let a=bitcast<vec3f>(v0.xyz);
 let edges=worldsLinear(hit.placement)*mat2x3f(bitcast<vec3f>(vec3u(v0.w,v1.x,v1.y))-a,bitcast<vec3f>(vec3u(v1.z,v1.w,v2.x))-a);
 out.edge1=edges[0];
 out.edge2=edges[1];
 if(!out.attributed){return out;}
 let corners=array<vec4u,3>(stCornerAt(hit,0u),stCornerAt(hit,1u),stCornerAt(hit,2u));
 let local=stCornerSurface(corners,hit.bary,(flags&${RAY_TRACING_FLAG_NORMALS}u)!=0u);
 out.uv=local.uv;
 out.colour=local.colour;
 out.uvEdge1=local.uvEdge1;
 out.uvEdge2=local.uvEdge2;
 if(any(local.normal!=vec3f(0.0))){
  let turned=unitOrZero(inverseTranspose3(worldsLinear(hit.placement),local.normal));
  out.normal=select(-turned,turned,dot(turned,hit.normal)>=0.0);
 }
 return out;
}`

/**
 * THE SURFACE A RAY'S HIT HAS between its triangle's corners (`stHitSurface`): the texture coordinate, the shading normal and the
 * vertex colour, from the attributes the ray tracing file carries for each corner (`RAY_TRACING_CORNER_BYTES`, uploaded as `SceneTrace.corners`),
 * at the barycentrics the trace gives a ray that sets `ST_BARYCENTRIC`. It lists the scene trace (`sceneTraceWgsl`) and declares `stCorners` at
 * binding `corners.binding` of group `scene.group`, beside the trace's four.
 */
export const sceneHitCornersWgsl = (
  scene: { group: number; first: number },
  corners: { binding: number },
) =>
  wgslBlock(
    `SCENE_HIT_CORNERS_WGSL(${scene.group},${scene.first},${corners.binding})`,
    [sceneTraceWgsl(scene.group, scene.first), octDecode, unitOrZero, inverseTranspose3],
    `@group(${scene.group}) @binding(${corners.binding}) var<storage,read> stCorners:array<vec4u>;
${CORNER_SURFACE}
${HIT_SURFACE}`,
  )
