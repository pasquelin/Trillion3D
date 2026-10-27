import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { AIR_GEOMETRY_WGSL } from '../atmosphere/geometryWgsl.ts'

/**
 * THE FIRST-PERSON STAND-INS IN THE SCREEN'S MISS (`reflectionClipFirstPerson`): the objects that stand, in the world, for a first-person one
 * (`WORLD_SPACE_ROOT`) are invisible to the camera, so the screen march can miss them, and the scene trace that takes the ray on would
 * show holes where it starts past them. A ray the screen missed (`t` metres from the surface at `P` along `R`, the distance it hands on) that
 * meets the sphere that holds the stand-ins (`ReflectionView.firstPerson`, `firstPersonBounds.ts`) is handed off no further than where it enters
 * the sphere, and no nearer than `ReflectionView.firstPersonMinimum`, so the screen still covers a distance that keeps the two copies of a mesh
 * from meeting each other. A sphere with no radius, a ray that misses it, and a sphere wholly behind the ray (both crossings behind its
 * start, where the ray only moves away from it) leave `t` as it is: told by the far crossing lying ahead, not by the crossings being
 * other than the miss's, which a sphere behind passes too and would clip every ray leaving it to the least distance.
 */
export const REFLECTION_FIRST_PERSON_WGSL = wgslBlock(
  'REFLECTION_FIRST_PERSON_WGSL',
  [AIR_GEOMETRY_WGSL],
  `fn reflectionClipFirstPerson(P:vec3f,R:vec3f,t:f32)->f32{
 let sphere=reflectionView.firstPerson;
 if(sphere.w>0.0){
  let hits=raySphere(P-sphere.xyz,R,sphere.w);
  if(hits.y>0.0){return min(t,max(hits.x,reflectionView.firstPersonMinimum));}
 }
 return t;
}`,
)
