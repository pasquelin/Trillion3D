/**
 * THE SHADOW THE HAIR CASTS ON THE SURFACES' SAMPLES (`sampledLightsHairVoxelTraces`, the reference's `HAIR_VOXEL_TRACES`): for each sample the distance field's ray left alone to trace, the ray is also marched
 * through the voxels of every macro group of the strands (`traceVoxels`, the reference's `TraverseHair`/`InternalTraverseHair`): the start moved by a bias of voxels along the ray and by a random
 * vector of the voxel's size, the march stopping at a hair count past the occlusion threshold; a hit hides the sample. The reference marches to the distance field's hit or 1000 metres whatever the light's
 * distance; the march here ends at the light, so that the hair behind a local light does not shade the surface. The strands' voxels are in the camera's translated world, the eye at the origin.
 * Reads the kit's own uniform as `ht` (its first words) and the strands' settings as `hts` (the density, the stepping and the occlusion threshold, in `x`, `z` and `w`).
 */
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { HAIR_TRAVERSAL_MAX_DISTANCE, voxelTraversalWgsl } from '../../hair/voxelTraversalWgsl.ts'
import { VOXEL_PARAMS_WGSL } from '../../hair/voxelWgsl.ts'
import { rand4dPcg32 } from '../../../../math/src/wgsl/sampling.ts'
import { WORLD_AT_WGSL } from '../deferred/worldAtWgsl.ts'
import { LIGHTS_BINDING_WGSL } from '../deferred/lightPassWgsl.ts'
import {
  reflectionBindingsWgsl,
  reflectionLightViewWgsl,
  REFLECTION_GROUP,
} from '../reflections/viewLayout.ts'
import { SAMPLED_BINDINGS } from './bindings.ts'
import { COMPACT_THREADS, TRACE_TEXEL_WGSL } from './compactWgsl.ts'
import { LIGHT_TRACE_WGSL } from './lightTraceWgsl.ts'
import { lightSampleIndex, lightSampleRayUv, lightSampleVisible } from './lightSamplerWgsl.ts'
import { jitterWgsl } from './samplingWgsl.ts'
import { SAMPLE_IO_WGSL } from './screenTraceWgsl.ts'

const B = SAMPLED_BINDINGS

export const HAIR_SURFACE_TRACE_ENTRY = 'surfaceHairTraceMain'
/** The binding of the strands' settings (`hts`: the density, the depth bias in voxels, the stepping and the occlusion threshold); the voxels take 0 to 3 and the kit's uniform `B.params`. */
export const HAIR_SURFACE_TRACE_SETTINGS = 170
/** The occlusion threshold, in hair counts: the strands' own for a shadow on the surfaces. */
export const HAIR_SURFACE_OCCLUSION = 1

/** The first words of the kit's uniform (`SampledParams`), the ones this kernel reads. */
const TRACE_PARAMS_WGSL = wgslBlock(
  'SAMPLED_HAIR_TRACE_PARAMS_WGSL',
  [],
  `struct HairTraceParams{viewTiles:vec2u,downTiles:vec2u,factor:vec2u,samples:vec2u,downView:vec2u,sampleView:vec2u,stride:u32,fastClear:u32,textured:u32,guide:u32,frame:u32}
@group(0) @binding(${B.params}) var<uniform> ht:HairTraceParams;
struct HairTraceSettings{shadow:vec4f}
@group(0) @binding(${HAIR_SURFACE_TRACE_SETTINGS}) var<uniform> hts:HairTraceSettings;`,
)

export const hairSurfaceTraceWgsl = () =>
  wgslProgram(
    `@group(0) @binding(1) var<storage,read> nodes:array<u32>;
@group(0) @binding(2) var<storage,read> pageIndex:array<u32>;
@group(0) @binding(3) var<storage,read> voxels:array<u32>;
@group(0) @binding(${B.compactData}) var<storage,read> compactData:array<u32>;
@group(0) @binding(${B.compactCount}) var<storage,read> compactCount:array<u32>;
@compute @workgroup_size(${COMPACT_THREADS},1,1)
fn ${HAIR_SURFACE_TRACE_ENTRY}(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=compactCount[1]){return;}
 let texel=unpackTraceTexel(compactData[ht.sampleView.x*ht.sampleView.y+id.x]);
 let c=vec2i(texel);
 let word=textureLoad(samples,c).r;
 // A sample the distance field already found shadowed is hidden.
 if(!lightSampleVisible(word)){return;}
 let ray=textureLoad(rays,c).r;
 let index=lightSampleIndex(word);
 let down=texel/ht.samples;
 let screen=min(down*ht.factor+downsampleJitter(down),vec2u(view.viewport.xy)-vec2u(1u));
 let P=worldAt(vec2f(screen)+vec2f(0.5),hizOpaqueDepth(vec2i(screen)));
 let segment=lightSampleTrace(index,P,lightSampleRayUv(ray));
 let origin=P-view.display.yzw;
 let dir=segment.xyz;
 let reach=min(max(segment.w-0.01,0.0),f32(${HAIR_TRAVERSAL_MAX_DISTANCE}));
 let seed=rand4dPcg32(vec4i(vec3i(c,i32(ht.frame)),13));
 let voxelRandom=vec3f(seed.xyz)/4294967295.0;
 let rayRandom=f32(seed.w)/4294967295.0;
 for(var member=0u;member<params.macroGroupCount;member++){
  let node=nodeOf(member);
  if(any(node.pages==vec3u(0u))){continue;}
  let bias=(rayRandom*dir+voxelRandom)*node.size;
  let traced=traceVoxels(origin+bias,origin+dir*reach+bias,node,TraversalSettings(hts.shadow.x,hts.shadow.w,f32(${HAIR_TRAVERSAL_MAX_DISTANCE}),hts.shadow.z,voxelRandom,0.0,true,false));
  if(traced.hitT>=0.0){
   hideSample(c);
   return;
  }
 }
}`,
    [
      VOXEL_PARAMS_WGSL,
      voxelTraversalWgsl(true),
      TRACE_PARAMS_WGSL,
      jitterWgsl(TRACE_PARAMS_WGSL, 'ht'),
      SAMPLE_IO_WGSL,
      TRACE_TEXEL_WGSL,
      LIGHT_TRACE_WGSL,
      LIGHTS_BINDING_WGSL,
      WORLD_AT_WGSL,
      reflectionBindingsWgsl(REFLECTION_GROUP),
      reflectionLightViewWgsl(REFLECTION_GROUP),
      rand4dPcg32,
      lightSampleIndex,
      lightSampleRayUv,
      lightSampleVisible,
    ],
  )
