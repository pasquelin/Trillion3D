import { wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../math/src/wgsl/assemble.ts'
import { unitOrZero } from '../../../../math/src/wgsl/inverseTranspose.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../gpu/dispatch/grid.ts'
import { PAGE_INFO_STRUCT_WGSL, VIS_UNIFORMS_WGSL, normalAtlasWgsl } from '../shader/pageWgsl.ts'
import { PAGE_NORMAL_WGSL, PAGE_POINTS_WGSL } from '../shader/pageGeometryWgsl.ts'
import { visPageIndex, visTriangle } from '../visWords.ts'
import { TESS_BINDINGS, TESS_DECLARATIONS as D } from './bindings.ts'
import { ARG_END, ARG_START, SEED_SPLIT_LIMIT, TABLE_SIZE } from './contract.ts'
import { CHILDREN_WGSL, QUEUE_WGSL } from './queueWgsl.ts'
import {
  BOX3,
  decodeBarycentrics,
  displaceBounds,
  edgeFactors,
  lowTessDistance,
  splitFactors,
} from './patchWgsl.ts'

/** Whether the world's box `box` of a row (in its local space, `world` its placement) lies wholly
 *  outside one plane of the view's frustum, or behind the eye: the corners of the box through the
 *  view and projection, each plane taken alone. */
const boxOutside = wgslFn(
  'boxOutside',
  [BOX3],
  `fn boxOutside(box:Box3,world:mat4x4f)->bool{
 let m=uni.viewProj*world;
 var left=true;var right=true;var below=true;var above=true;var behind=true;
 for(var k=0u;k<8u;k++){
  let corner=select(box.lo,box.hi,vec3<bool>((k&1u)!=0u,(k&2u)!=0u,(k&4u)!=0u));
  let c=m*vec4f(corner,1.0);
  left=left&&c.x<-c.w;right=right&&c.x>c.w;below=below&&c.y<-c.w;above=above&&c.y>c.w;behind=behind&&c.w<=0.0;
 }
 return left||right||below||above||behind;
}`,
)

/**
 * THE SPLITTING of a level, a thread a patch of the queue slots `start` to `end` (`ARG_START`,
 * `ARG_END`, which `plan` wrote), dispatched indirectly. A patch of the triangle its identifier
 * names is placed on it by its barycentrics: its three corners and their normals, and the box they
 * span grown by the displacement along normals within the cone the three make, which a patch
 * wholly outside the frustum or behind the eye leaves out of the image (`boxOutside`). The edge
 * factors of its corners in the world say whether one pattern holds it: it goes to the visible list
 * as it is, or — a factor past `TABLE_SIZE` — is cut by the pattern of its factors over
 * `TABLE_SIZE`, held to `SEED_SPLIT_LIMIT` (`queueChildren`), the children left for the next level.
 */
const SPLIT = `${D.indices}
${D.positions}
${D.pages}
${D.uniform}
${D.tessUniform}
${D.tess}
${D.disp}
@compute @workgroup_size(WORKGROUP_THREADS) fn tessSplit(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let slot=tw(tu.args+${ARG_START}u)+flatIndex(id,n,WORKGROUP_THREADS);
 if(slot>=tw(tu.args+${ARG_END}u)){return;}
 let piece=loadPatch(tu.queue+slot*4u);
 let page=pages[visPageIndex(piece.x)];
 let h=pageHeaderFor(page,true);
 let corners=pageTriangle(page,h,visTriangle(piece.x));
 let rec=displacementOf(page);
 let position=pageTrianglePositions(page,h,corners);
 let normal=mat3x3f(pageNormal(page,h,corners.x),pageNormal(page,h,corners.y),pageNormal(page,h,corners.z));
 let parent=mat3x3f(decodeBarycentrics(piece.y),decodeBarycentrics(piece.z),decodeBarycentrics(piece.w));
 let c0=position*parent[0];let c1=position*parent[1];let c2=position*parent[2];
 let n0=unitOrZero(normal*parent[0]);let n1=unitOrZero(normal*parent[1]);let n2=unitOrZero(normal*parent[2]);
 let axis=unitOrZero(n0+n1+n2);
 let cone=min(dot(axis,n0),min(dot(axis,n1),dot(axis,n2)));
 let span=Box3(min(c0,min(c1,c2)),max(c0,max(c1,c2)));
 if(boxOutside(displaceBounds(axis,cone,rec.bounds.x,rec.bounds.y,span),page.world)){return;}
 let w0=(page.world*vec4f(c0,1.0)).xyz;let w1=(page.world*vec4f(c1,1.0)).xyz;let w2=(page.world*vec4f(c2,1.0)).xyz;
 let depth=vec3f(dot(uni.forward,w0-uni.eye),dot(uni.forward,w1-uni.eye),dot(uni.forward,w2-uni.eye));
 let axes=mat3x3f(page.world[0].xyz,page.world[1].xyz,page.world[2].xyz);
 let scale=sqrt(max(dot(axes[0],axes[0]),max(dot(axes[1],axes[1]),dot(axes[2],axes[2]))));
 let far=lowTessDistance(max(-rec.bounds.x,rec.bounds.y),scale,tu.lodScale,rec.bounds.z*tu.edgesPerPixel);
 let f=edgeFactors(mat3x3f(w0,w1,w2),depth,uni.near,uni.perspective>0.0,tu.lodScale,tu.invDiceRate,far);
 if(max(f.x,max(f.y,f.z))>${TABLE_SIZE}.0){queueChildren(piece.x,parent,min(splitFactors(f),vec3f(${SEED_SPLIT_LIMIT}.0)),true);}
 else{visiblePatch(piece);}
}`

/** The splitting's program: its entry point `tessSplit`. The normal atlas it
 *  reads a float geometry's normals from is bound at `TESS_BINDINGS.normals`. */
export const splitSource = () =>
  wgslProgram(SPLIT, [
    PAGE_INFO_STRUCT_WGSL,
    VIS_UNIFORMS_WGSL,
    normalAtlasWgsl(TESS_BINDINGS.normals),
    PAGE_POINTS_WGSL,
    PAGE_NORMAL_WGSL,
    QUEUE_WGSL,
    CHILDREN_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    unitOrZero,
    visPageIndex,
    visTriangle,
    decodeBarycentrics,
    displaceBounds,
    edgeFactors,
    lowTessDistance,
    splitFactors,
    BOX3,
    boxOutside,
  ])
