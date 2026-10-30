import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { FOG_TRACED_WORD_BITS } from './layout.ts'
import { FOG_HIDDEN_WGSL } from './planWgsl.ts'
import { RAY_TRACED_SUN_REACH } from '../shadows/rayTraced/rayTracedWgsl.ts'
import { sceneMaskKey, type SceneMaskPrograms } from '../rays/sceneTrace/sceneMaskPrograms.ts'
import { sceneMaskWgsl } from '../rays/sceneTrace/sceneMaskWgsl.ts'
import { sceneOccludedWgsl, sceneTraceWgsl } from '../rays/sceneTrace/sceneTraceWgsl.ts'

/** The group of the scene trace in the kernel (group 0 is the fog's own) and its first binding in it. */
export const FOG_TRACED_SCENE = { group: 1, first: 0 } as const

export const FOG_TRACED_ENTRY = 'fogTracedShadow'

/**
 * THE RAY TRACED SHADOWS OF THE VOLUME'S LIGHTS (`fogTracedShadow`, a thread a cell): from the first sample of the cell (`fogSampleOffset`, the offset the scatter's first sample takes, lifted off the
 * depth buffer), one ray goes through the scene's triangles toward each light the frame names (the bits of `fogTracedHeldWords`, a bit a rank of the light buffer, as many words as `frame.traced.x`): a sun's along its direction with no end, a local light's
 * toward its centre and ending at its emitter's sphere (`shape.x`), so that the bulb or the lamp's own mesh does not shadow what it lights, only where the cell lies within the light's range and, for a spot, its cone. The ray starts at the sample with no
 * bias and ends at the first primitive it meets, cast from both faces of the geometry, the translucent primitives and the placements that cast no shadow passed; a trace that stopped before its walk was whole shadows the point.
 * The answer is one word a cell for each 32 ranks (the words one above the other, the textures' depth apart), a bit a rank, set where the light is blocked (so that a cell that was not traced, hidden or out of reach, sees every light),
 * which the scatter reads (`fogTracedSeen`, `lightsWgsl.ts`). A cell the scatter holds hidden (`fogCellHidden`) is left as it is: nothing reads it.
 * `programs` are the graph masks the rays cut the surfaces by (`sceneMaskWgsl.ts`).
 */
export const fogTracedWgsl = (programs: SceneMaskPrograms) =>
  wgslBlock(
    `FOG_TRACED_WGSL(${sceneMaskKey(programs)})`,
    [
      FOG_HIDDEN_WGSL,
      sceneTraceWgsl(FOG_TRACED_SCENE.group, FOG_TRACED_SCENE.first),
      sceneMaskWgsl(FOG_TRACED_SCENE.group, FOG_TRACED_SCENE.first, programs),
      sceneOccludedWgsl(FOG_TRACED_SCENE.group, FOG_TRACED_SCENE.first),
    ],
    `
/** Whether the whole cell, a sphere of radius around point, lies outside the reach of the local light: past its range, or outside its spot's cone. */
fn fogTracedOutOfReach(light:DirectLight,point:vec3f,radius:f32)->bool{
 let offset=point-light.positionRange.xyz;
 if(length(offset)>light.positionRange.w+radius){return true;}
 let cosine=light.directionCone.w;
 if(!isSpot(light)||cosine<=0.0){return false;}
 let along=dot(light.directionCone.xyz,offset);
 let across=length(offset-light.directionCone.xyz*along);
 return (across-along*sqrt(max(1.0-cosine*cosine,0.0))/cosine)*cosine>radius;
}
@compute @workgroup_size(4,4,4)
fn ${FOG_TRACED_ENTRY}(@builtin(global_invocation_id) cell:vec3u){
 if(any(cell>=vec3u(frame.grid.xyz))||fogCellHidden(cell)){return;}
 let words=frame.traced.x;
 let offset=fogSampleOffset(cell,0u);
 let point=fogCellPoint(cell,offset).xyz;
 let radius=length(fogCellPoint(cell+vec3u(1u),offset).xyz-point);
 for(var word=0u;word<words;word++){
  let wanted=fogTracedHeldWords[word];
  var blocked=0u;
  for(var bit=0u;(bit<${FOG_TRACED_WORD_BITS}u)&&((wanted>>bit)!=0u);bit++){
   let rank=word*${FOG_TRACED_WORD_BITS}u+bit;
   if(((wanted>>bit)&1u)==0u||rank>=directLights.count){continue;}
   let light=directLights.items[rank];
   var d=-light.directionCone.xyz;
   var reach=${RAY_TRACED_SUN_REACH};
   if(!isSun(light)){
    if(fogTracedOutOfReach(light,point,radius)){continue;}
    let toLight=light.positionRange.xyz-point;
    let away=max(length(toLight),1e-6);
    d=toLight/away;
    reach=max(away-select(light.shape.x,0.0,isRect(light)),1e-6);
   }
   if(stOccluded(StRay(point-frame.eye.xyz,d,0.0,reach,ST_SHADOW|ST_SKIP_TRANSLUCENT|ST_ANY_HIT|ST_MEET_WORLD_SPACE))){blocked|=1u<<bit;}
  }
  textureStore(fogTracedOut,vec3i(i32(cell.x),i32(cell.y),i32(cell.z+word*u32(frame.texture.z))),vec4u(blocked,0u,0u,0u));
 }
}`,
  )
