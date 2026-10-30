/**
 * THE HAIR IN THE RAYS OF THE SHADOW CASTER VIEWS (`./castersWgsl.ts`, `sampledLightsHairVoxelTraces`): the same ray from the eye through each pixel of the draw, marched through the voxels of every macro group of the
 * strands (`traceVoxels`) to the farthest the voxels are marched (`HAIR_TRAVERSAL_MAX_DISTANCE`), whatever the scene's triangles are along it. The start of each march is moved by a bias of voxels along the ray and by a random vector of
 * the voxel's size, the march stopping at a hair count past the occlusion threshold; the nearest stop of the macro groups is the hair's hit. The randoms are the strands' jitter: renewed each image for the mode that renews it, else
 * the pixel's own. A hit is written as the rays write theirs (distance, found, an object of the hair's own, the normal turned toward the eye), at the pixel, in a texture beside the rays' for the view's fragment stage
 * (`../visualizeWgsl.ts`) to take where it is nearer than the triangles. The strands' voxels are in the camera's translated world, the eye at the origin.
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { octEncode } from '../../../../../../math/src/wgsl/octahedral.ts'
import { rand3dPcg16, rand4dPcg32 } from '../../../../../../math/src/wgsl/sampling.ts'
import { fieldLayout } from '../../../../gpu/core/fieldLayout.ts'
import {
  computeBufferEntry,
  computeStorageTextureEntry,
  computeUniformEntry,
} from '../../../../gpu/core/computeBindings.ts'
import {
  HAIR_TRAVERSAL_MAX_DISTANCE,
  voxelTraversalWgsl,
} from '../../../../hair/voxelTraversalWgsl.ts'
import { VOXEL_PARAMS_WGSL } from '../../../../hair/voxelWgsl.ts'
import { EYE_RAY_WGSL } from '../../../surfaceCache/sceneDebug/hardware/traceWgsl.ts'
import { CASTER_HIT_FOUND, CASTER_HITS_FORMAT, CASTERS_GROUP } from './castersWgsl.ts'

/** The object a hit of the hair carries: one of its own, for the colour of its own in the view of the instances. */
export const CASTER_HAIR_OBJECT = 0xabcd

/** The bindings of group 0: the volume's parameters, nodes, page index and voxels (the strands' voxel kernels' own, 0 to 3), then the parameters of the draw, the lighting's view and the hits written. */
export const CASTERS_HAIR_BINDINGS = { params: 4, view: 5, hits: 6 } as const
const B = CASTERS_HAIR_BINDINGS

/**
 * The parameters of a draw, one uniform: `size` the pixels across and down the draw is traced at, then the display's; `voxel` the density, the stepping, the occlusion threshold (hair counts) and the
 * farthest of the march (metres); `random` the strands' jitter mode (0 none, 1 each image, 2 constant) and the image's number.
 */
export const CASTERS_HAIR_PARAMS = fieldLayout('CastersHairParams', [
  ['size', 'vec4u'],
  ['voxel', 'vec4f'],
  ['random', 'vec4u'],
] as const)

export const CASTERS_HAIR_ENTRY = 'castersHairTrace'

/** The layout of group 0. */
export const castersHairEntries = () => [
  computeUniformEntry(0),
  computeBufferEntry(1, 'read-only-storage'),
  computeBufferEntry(2, 'read-only-storage'),
  computeBufferEntry(3, 'read-only-storage'),
  computeUniformEntry(B.params),
  computeUniformEntry(B.view),
  computeStorageTextureEntry(B.hits, CASTER_HITS_FORMAT),
]

export const castersHairWgsl = () =>
  wgslProgram(
    `${CASTERS_HAIR_PARAMS.wgsl}
@group(0) @binding(1) var<storage,read> nodes:array<u32>;
@group(0) @binding(2) var<storage,read> pageIndex:array<u32>;
@group(0) @binding(3) var<storage,read> voxels:array<u32>;
@group(0) @binding(${B.params}) var<uniform> hair:CastersHairParams;
@group(0) @binding(${B.view}) var<uniform> view:View;
@group(0) @binding(${B.hits}) var hits:texture_storage_2d<${CASTER_HITS_FORMAT},write>;
@compute @workgroup_size(${CASTERS_GROUP},${CASTERS_GROUP},1)
fn ${CASTERS_HAIR_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=hair.size.xy)){return;}
 let draw=vec2f(hair.size.xy);
 let display=vec2f(hair.size.zw);
 let origin=eyeRayOrigin(id.xy,draw,display);
 let dir=eyeRayDirection(id.xy,draw,display);
 var voxelRandom:vec3f;
 var rayRandom:f32;
 if(hair.random.x==1u){
  let seed=rand4dPcg32(vec4i(vec3i(vec2i(id.xy),i32(hair.random.y)),0));
  voxelRandom=vec3f(seed.xyz)/4294967295.0;
  rayRandom=f32(seed.w)/4294967295.0;
 }else{
  let first=rand3dPcg16(vec3i(vec2i(id.xy),0)).xy;
  let second=rand3dPcg16(vec3i(vec2i(id.xy)+vec2i(17),0)).xy;
  let seed=vec4f(vec4u(first,second))/65536.0;
  voxelRandom=seed.xyz;
  rayRandom=seed.w;
 }
 var hitT=-1.0;
 for(var member=0u;member<params.macroGroupCount;member++){
  let node=nodeOf(member);
  if(any(node.pages==vec3u(0u))){continue;}
  let bias=(rayRandom*dir+voxelRandom)*node.size;
  let traced=traceVoxels(origin+bias,origin+dir*hair.voxel.w+bias,node,TraversalSettings(hair.voxel.x,hair.voxel.z,f32(${HAIR_TRAVERSAL_MAX_DISTANCE}),hair.voxel.y,voxelRandom,0.0,true,false));
  if(traced.hitT>=0.0){hitT=select(min(hitT,traced.hitT),traced.hitT,hitT<0.0);}
 }
 var texel=vec4u(0u);
 if(hitT>0.0){texel=vec4u(bitcast<u32>(hitT),${CASTER_HIT_FOUND}u,${CASTER_HAIR_OBJECT}u,pack2x16snorm(octEncode(-dir)));}
 textureStore(hits,vec2i(id.xy),texel);
}`,
    [
      VOXEL_PARAMS_WGSL,
      voxelTraversalWgsl(true),
      EYE_RAY_WGSL,
      rand3dPcg16,
      rand4dPcg32,
      octEncode,
    ],
  )
