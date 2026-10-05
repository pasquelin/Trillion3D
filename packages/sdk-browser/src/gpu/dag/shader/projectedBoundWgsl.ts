/** Canonical DAG displacement bound; callers prepare the same view position and world radius. */
export const PROJECTED_BOUND_WGSL = `
fn projectedBound(error:f32,v:vec3f,radius:f32,stretch:f32,focal:f32,near:f32,perspective:f32,reference:bool)->f32{
 if(error==0.0){return 0.0;}
 if(!(error>0.0)){return INF;}
 let p=perspective;let flat=1.0-p;
 if(reference){
  let depth=p*-v.z+flat;
  if(!(depth>p*near)){return INF;}
  let delta=error*stretch;
  return (delta*focal)/depth;
 }
 let reach=radius*stretch;let shift=error*stretch;
 let nearest=p*(-v.z-reach)+flat;let closest=nearest-p*shift;let side=p*(sqrt(v.x*v.x+v.y*v.y)+reach);
 if(!(closest>p*near)){return INF;}
 let slant=sqrt(nearest*nearest+side*side);
 if(!(slant>=nearest&&slant<INF)){return INF;}
 return ((shift*focal)/nearest)*(slant/closest);
}
`;
