import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'
import { AMBIENT_CUBEMAP_SQRT8 } from '../../../../sdk-core/src/lighting/ambientCubemapMips.ts'
import { fieldLayout } from '../../gpu/core/fieldLayout.ts'

/** The blocks the walk's stack holds at most: three a level of a face of up to 1024 texels a side (eleven levels), and the root. */
const STACK_ENTRIES = 3 * 11 + 1

/** What a dispatch of the filter reads, one record a dispatch (read at a dynamic offset): `counts` the side of the mip written, the side of
 *  the source mip, the face written and its first row; `cone` the sine and cosine of the cone's half angle, the cosine the weights stop at
 *  and the inverse of their width; `span` the source mip's level and the rows the dispatch writes; `scale` the colour's scale. */
export const CUBE_FILTER = fieldLayout('CubeFilter', [
  ['counts', 'vec4u'],
  ['cone', 'vec4f'],
  ['span', 'vec4u'],
  ['scale', 'f32'],
] as const)

/** Where the filter's bindings lie in group 0. */
export const CUBE_FILTER_BINDINGS = { faces: 0, record: 1, source: 2, filtered: 3 } as const

/** The cube's faces and the filter's record, the source chain, the mip written, and the functions that walk a cone over it. */
export const CUBE_FILTER_WGSL = wgslBlock(
  'CUBE_FILTER_WGSL',
  [],
  `
struct CubeFaces{perm:array<vec4u,6>,signs:array<vec4f,6>,}
${CUBE_FILTER.wgsl}
@group(0) @binding(${CUBE_FILTER_BINDINGS.faces}) var<uniform> cubeFaces:CubeFaces;
@group(0) @binding(${CUBE_FILTER_BINDINGS.record}) var<uniform> cubeFilter:CubeFilter;
@group(0) @binding(${CUBE_FILTER_BINDINGS.source}) var cubeSource:texture_2d_array<f32>;
@group(0) @binding(${CUBE_FILTER_BINDINGS.filtered}) var cubeFiltered:texture_storage_2d_array<rgba16float,write>;
const CUBE_SQRT8:f32=${wgslF32(AMBIENT_CUBEMAP_SQRT8)};
/** The unit direction of the point (\`u\`, \`v\`) of a face, each from -1 to 1 across and down it. */
fn cubeDirection(face:u32,u:f32,v:f32)->vec3f{
 let side=vec3f(u,v,1.0)/length(vec3f(u,v,1.0));
 let perms=cubeFaces.perm[face];
 let signs=cubeFaces.signs[face];
 return vec3f(signs.x*side[perms.x],signs.y*side[perms.y],signs.z*side[perms.z]);
}
/** The side-space vector of a unit direction on a face: the inverse of \`cubeDirection\`'s turn. */
fn cubeSideAxis(face:u32,direction:vec3f)->vec3f{
 let perms=cubeFaces.perm[face];
 let signs=cubeFaces.signs[face];
 var axis=vec3f(0.0);
 axis[perms.x]=signs.x*direction.x;
 axis[perms.y]=signs.y*direction.y;
 axis[perms.z]=signs.z*direction.z;
 return axis;
}
/** Whether the sphere of \`centre\` and \`radius\` meets the cone of apex zero, unit axis \`axis\` and half angle of sine \`sinC\` and cosine \`cosC\`. */
fn cubeSphereMeetsCone(centre:vec3f,radius:f32,axis:vec3f,sinC:f32,cosC:f32)->bool{
 let distance=length(centre);
 let pushed=centre+radius/sinC*axis;
 let along=dot(axis,pushed);
 if(!(along>0.0&&along*along>=dot(pushed,pushed)*cosC*cosC)){return false;}
 let behind=-dot(axis,centre);
 if(behind>0.0&&behind*behind>=distance*distance*sinC*sinC){return distance*distance<=radius*radius;}
 return true;
}
/** The mean colour of the texels of the source mip within the cone of \`direction\`, black where none lies. */
fn cubeConeMean(direction:vec3f)->vec3f{
 let extent=cubeFilter.counts.y;
 let level=i32(cubeFilter.span.x);
 let sinC=cubeFilter.cone.x;
 let cosC=cubeFilter.cone.y;
 let kernelCos=cubeFilter.cone.z;
 let inverseWidth=cubeFilter.cone.w;
 let toWorld=2.0/f32(extent);
 let inverseExtent=1.0/f32(extent);
 let radiusScale=CUBE_SQRT8/f32(extent);
 var sum=vec3f(0.0);
 var weights=0.0;
 var stack:array<u32,${STACK_ENTRIES}>;
 for(var face=0u;face<6u;face++){
  let axis=cubeSideAxis(face,direction);
  stack[0]=extent<<20u;
  var top=1u;
  loop{
   if(top==0u){break;}
   top=top-1u;
   let node=stack[top];
   let x=node&1023u;
   let y=(node>>10u)&1023u;
   let block=node>>20u;
   if(block>1u){
    let middle=f32(block)*0.5;
    let centre=vec3f((f32(x)+middle)*toWorld-1.0,(f32(y)+middle)*toWorld-1.0,1.0);
    if(!cubeSphereMeetsCone(centre,radiusScale*f32(block),axis,sinC,cosC)){continue;}
    let next=block>>1u;
    for(var quarter=4u;quarter>0u;quarter--){
     let q=quarter-1u;
     stack[top]=(x+select(0u,next,(q&1u)!=0u))|((y+select(0u,next,(q&2u)!=0u))<<10u)|(next<<20u);
     top=top+1u;
    }
    continue;
   }
   let u=(f32(x)+0.5)*inverseExtent*2.0-1.0;
   let v=(f32(y)+0.5)*inverseExtent*2.0-1.0;
   let cosine=(axis.x*u+axis.y*v+axis.z)/length(vec3f(u,v,1.0));
   if(cosine>kernelCos){
    var weight=1.0-(1.0-cosine)*inverseWidth;
    weight=weight*weight*(3.0-2.0*weight);
    sum+=weight*textureLoad(cubeSource,vec2i(i32(x),i32(y)),face,level).rgb;
    weights+=weight;
   }
  }
 }
 if(weights==0.0){return vec3f(0.0);}
 return sum/weights;
}`,
)
