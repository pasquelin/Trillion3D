import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { slabPerspective } from '../../../../../math/src/wgsl/projection.ts'

/**
 * WHETHER A THIN FEATURE STANDS IN FRONT OF A HIT (`spThinFeature`): `steps` linear samples along the ray from the hit toward its end, the first at the
 * hit; the ray is above the closest depth at any of them. The ray is `start + delta · t` in pixels, `t` running to `end`, the hit at `t`, and `size` is the image's, the
 * bound of a sample. The samples spread over `steps` texels of the pyramid's base level (`hizLevels.level[1]`: the half-resolution level, whose
 * extent twice over is the image's in the units the ray is measured in there), as a share of what is left of the ray: the ray's displacement over that
 * extent, times the size of a texel, one over the base level's extent, times `steps`.
 */
export const SP_THIN_FEATURE = wgslBlock(
  'SP_THIN_FEATURE',
  [],
  `fn spThinFeature(start:vec3f,delta:vec3f,end:f32,t:f32,size:vec2f,steps:f32)->bool{
 let ray=start+delta*t;
 let remain=delta*(end-t);
 let texels=vec2f(hizLevels.level[1].yz);
 let span=length(delta.xy*end/(2.0*texels)*(1.0/texels)*steps);
 let endTime=min(span/max(length(remain.xy/(2.0*texels)),1e-12),1.0);
 for(var i=0.0;i<steps;i+=1.0){
  let p=ray+(i/steps)*endTime*remain;
  if(all(p.xy>vec2f(0.0))&&all(p.xy<size)){
   let tileZ=select(screenTileDepth(p.xy,0,hizLevelCount()-1),hizOpaqueDepth(vec2i(floor(p.xy))),hizTracePlanes());
   if(p.z>tileZ){return true;}
  }
 }
 return false;
}`,
)

/**
 * HOW FAR A SAMPLE OF A FIXED-STEP RAY MAY LIE IN FRONT of the depth and still hit it (`spFixedTolerance`), in device depth: the greater of the ray's own depth step and the depth the
 * start gains over a view distance `span` (`spFixedDeeper`: the device depth at its end, from the depth `startZ` of its start) times `slope` under a perspective, that gain
 * alone under an orthographic projection, where the depth gradient (`slab.z / slab.x` a metre) gives it. In a perspective the view distance of the start is the one the depth
 * `A + B / distance` names.
 */
export const SP_FIXED_TOLERANCE = wgslBlock(
  'SP_FIXED_TOLERANCE',
  [slabPerspective],
  `fn spFixedDeeper(startZ:f32,span:f32)->f32{
 let slab=reflectionView.slab;
 if(slabPerspective(slab)){
  let away=slab.z/max(startZ-slab.y,1e-12);
  return slab.y+slab.z/(away+span);
 }
 return startZ-slab.z/slab.x*span;
}
fn spFixedTolerance(startZ:f32,stepZ:f32,span:f32,slope:f32)->f32{
 let gain=(startZ-spFixedDeeper(startZ,span))*slope;
 return select(max(0.0,gain),max(abs(stepZ),gain),slabPerspective(reflectionView.slab));
}`,
)
