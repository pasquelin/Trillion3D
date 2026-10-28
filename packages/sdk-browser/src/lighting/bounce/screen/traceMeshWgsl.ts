import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { WORD_LIGHT_FORMAT, type LightAtlasFormat } from '../../../gpu/core/lightAtlasFormat.ts'
import { computeBufferEntry, computeUniformEntry } from '../../../gpu/core/computeBindings.ts'
import { sceneLayoutEntries } from '../../distanceField/sceneBindings.ts'
import { MESH_TRACE_BINDING, meshTraceWgsl } from '../../rays/meshTrace/traceWgsl.ts'
import { MESH_GRID_PARAMS_BYTES } from '../../rays/meshTrace/layout.ts'
import { SP_MESH_HIT, traceSceneShader } from './traceSceneWgsl.ts'

/** The group the meshes' stage binds what it reads of the meshes' fields in: the fields' seven bindings, then the grid's uniform, cells and lists (`MESH_TRACE_BINDING`). The scene stage's group is 0, the reflection group 1. */
export const TRACE_MESH_GROUP = 2

/** The layout of the meshes' stage's group 2. */
export const traceMeshEntries = () => [
  ...sceneLayoutEntries(0),
  computeUniformEntry(MESH_TRACE_BINDING.params, { minBindingSize: MESH_GRID_PARAMS_BYTES }),
  computeBufferEntry(MESH_TRACE_BINDING.cells, 'read-only-storage'),
  computeBufferEntry(MESH_TRACE_BINDING.indices, 'read-only-storage'),
]

/** The card interpolation radius a hit of the meshes' fields reads the surface cache over, in centimetres (`CardInterpolateInfluenceRadius`, 10 in the reference). */
const CARD_INTERPOLATION_RADIUS = 10

/**
 * THE MESHES' FIELDS STAGE (`traceMeshes`), a thread a ray of the list the screen left, before the scene stage (the reference's first compaction and its trace of the meshes' signed distance fields,
 * `ScreenProbeTraceMeshSDFsCS`): a ray whose probe stands nearer the camera than the farthest a mesh is traced at (`msdf.distances.x`) and that the screen left before the farthest a ray marches the
 * meshes (`msdf.distances.y`) is marched from where the screen left it (the bias back) through the meshes the cell of its probe in the view grid lists (`msdfTraceCell`, the cell of the probe's pixel and
 * depth), to the reach of the probe's cell or that farthest. A hit takes the light of its mesh's cards at the point (`scMeshHit`, over the radius of the card interpolation) faded to none past a sixth of the
 * camera distance it is traced at and answered by noise (a hit where the fade is under it); that light, with the sky light that leaks onto it and the height fog, is the ray's, its hit word
 * the distance with `SP_MESH_HIT`. A ray that hit nothing keeps the distance it was marched to as its start for the scene stage, which marches the global distance field from there.
 */
const traceMeshesBlock = () =>
  wgslBlock(
    'SP_TRACE_MESHES',
    [meshTraceWgsl(TRACE_MESH_GROUP, 0), SP_MESH_HIT],
    `const MESH_CARD_RADIUS:f32=${CARD_INTERPOLATION_RADIUS}.0;
@compute @workgroup_size(WORKGROUP_THREADS)
fn traceMeshes(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) groups:vec3u){
 let ray=spListed(id,groups);
 if(!ray.ok){return;}
 let texel=vec2i(ray.at);
 let probe=ray.probe;
 let missed=spHitDistance(textureLoad(hitIo,texel).r);
 let farthest=msdf.distances.y*0.01;
 if(probe.depth*100.0>=msdf.distances.x||missed>=farthest){return;}
 let t=ray.at%SP_TRACE;
 let index=spIndexOf(ray.atlas);
 let d=spRayDirection(ray.atlas,t,index);
 var normal=probe.N;
 if(probe.foliage&&dot(normal,d)<0.0){normal=-normal;}
 let bias=sp.scene.x;
 let start=probe.P+(normal+d)*bias;
 let begin=max(sp.motion.w,missed-2.0*bias);
 let reach=min(spLocalReach(probe.P),farthest);
 if(begin>=reach){return;}
 let pixel=probePixels[index];
 let traced=MsdfRay(start*100.0,d,begin*100.0,reach*100.0,true,0.0,true,vec2f(spRayNoiseTexel(index,t)));
 let hit=msdfTraceCell(traced,msdfCellIndex(vec2u(pixel&0xffffu,pixel>>16u),probe.depth*100.0));
 // The scene stage starts where this march left the ray, as it starts where the screen left it: a distance from the ray's start; the light and the fog measure from the probe's point (the bias is the difference).
 let leftOff=length(start-probe.P);
 if(!(hit.distance<traced.maxTrace)){
  textureStore(hitIo,texel,vec4u(spHitWord(reach,false),0u,0u,0u));
  return;
 }
 let derived=msdfTraceDerived(traced,hit);
 var face=derived.normal;
 if(dot(face,d)>0.0){face=-face;}
 let end=hit.distance*0.01+leftOff;
 let fade=saturate(6.0*sqrt(cameraDistanceSq(bounce.eye.xyz-probe.P))*100.0/msdf.distances.x-5.0);
 // The hit answers where the fade is under the pixel's noise; a ray it fades out of goes on from where it hit.
 if(!(fade<interleavedGradientNoise(vec2f(ray.at)+vec2f(0.5),0.0))){
  textureStore(hitIo,texel,vec4u(spHitWord(hit.distance*0.01,false),0u,0u,0u));
  return;
 }
 let surface=scMeshHit(start*100.0+d*hit.distance,face,derived.instance,scConeTangent(spRayCone(ray.atlas,t))*hit.distance,MESH_CARD_RADIUS,false,spRayNoiseTexel(index,t));
 let light=spRayLit(select(vec3f(0.0),surface.radiance*(1.0-fade),surface.valid),probe,d,end,true);
 textureStore(radianceOut,texel,vec4u(spTraceLight(light,texel),0u,0u,0u));
 textureStore(hitIo,texel,vec4u(spHitWord(end,false)|SP_MESH_HIT,0u,0u,0u));
}`,
  )

/** The program of the meshes' stage for rays `side × side` a probe, `samples` of a tile, the height fog laid over the light of its rays where `fog`: the scene stage's program with its entry. */
export const traceMeshShader = (
  side: number,
  samples: readonly [number, number],
  fog: boolean,
  light: LightAtlasFormat = WORD_LIGHT_FORMAT,
) => traceSceneShader(side, samples, fog, [traceMeshesBlock()], light)
