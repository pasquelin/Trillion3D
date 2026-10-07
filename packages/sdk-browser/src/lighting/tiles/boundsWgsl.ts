import { DEPTH_NEAR } from '../../camera/depthConvention.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { uvToNdc, unprojectPoint } from '../../../../math/src/wgsl/projection.ts'

/**
 * A column of the light grid and the run of its cells a light's range meets:
 * `bench/oracles/browser/gpuLightGridOracle.ts` ports it line by line.
 *
 * The column is the cell's square of the image from the near plane to infinity: its corners
 * de-projected at the near plane and deep in the view, whence its four side planes and its near
 * plane — a sphere wholly behind one is out of every cell of the column — and, along the view's two
 * axes across it, each edge as `at + slope · t`, `t` the depth along the view axis.
 *
 * Its cells are its slices of depth. At depth `t` the column's section is a rectangle whose edges
 * are linear in `t`, so the squared distance `f(t)` from a light's centre to it is convex, and the
 * light meets the section where `f(t) ≤ r²`: an interval, whose slices are those of its cells the
 * light meets. Newton's steps on a convex function never pass its root: each end, stepped from the
 * sphere's own depth extent, stays outside the interval, and the run holds every cell the light
 * meets. Its two ends are the one test of a light against the cells of its column: the cells between
 * them need none.
 */
export const GRID_BOUNDS_WGSL = wgslBlock(
  'GRID_BOUNDS_WGSL',
  [uvToNdc, unprojectPoint],
  `/** The steps each end of a light's run takes toward its sphere. */
const NEWTON_STEPS:u32=4u;
/** The factors a run's front and back depth are widened by: never the neighbour's slice by a
 *  rounding of the depth a pixel reads. */
const RUN_FRONT:f32=${1 + 1 / 1024};
const RUN_BACK:f32=${1 - 1 / 1024};
/** Depth the column's deep corners are read at: any depth short of the background gives the same
 *  planes; a deep one spreads the corners apart, so the planes keep their precision far from the
 *  world origin. */
const COLUMN_DEPTH:f32=${DEPTH_NEAR / 1024};
struct Edge{at:f32,slope:f32,}
struct Column{planes:array<vec4f,5>,across:vec3f,down:vec3f,into:vec3f,edges:array<Edge,4>,near:f32,}
/** World position of a column's corner — bit 0 picks the right edge, bit 1 the bottom — at depth z. */
fn cellCorner(cell:vec2u,corner:u32,z:f32)->vec3f{
 let size=view.viewport.xy;
 let x=select(f32(cell.x*TILE_SIZE)/size.x,min(f32((cell.x+1u)*TILE_SIZE)/size.x,1.0),(corner&1u)!=0u);
 let y=select(f32(cell.y*TILE_SIZE)/size.y,min(f32((cell.y+1u)*TILE_SIZE)/size.y,1.0),(corner&2u)!=0u);
 return unprojectPoint(view.inverseViewProjection,vec3f(uvToNdc(vec2f(x,y)),z));
}
/** Plane through \`point\` along \`normal\`, turned so that \`inside\` is on its positive side. */
fn inwardPlane(normal:vec3f,point:vec3f,inside:vec3f)->vec4f{
 let n=normalize(normal);
 let facing=select(-n,n,dot(n,inside-point)>=0.0);
 return vec4f(facing,-dot(facing,point));
}
/** An edge along \`axis\`, the lower (\`low\`) or higher of corners \`a\` and \`b\`, linear in depth. */
fn columnEdge(near:array<vec3f,4>,deep:array<vec3f,4>,axis:vec3f,low:bool,a:u32,b:u32,tn:f32,td:f32)->Edge{
 let n=select(max(dot(axis,near[a]),dot(axis,near[b])),min(dot(axis,near[a]),dot(axis,near[b])),low);
 let d=select(max(dot(axis,deep[a]),dot(axis,deep[b])),min(dot(axis,deep[a]),dot(axis,deep[b])),low);
 let slope=(d-n)/(td-tn);
 return Edge(n-slope*tn,slope);
}
/** The column of cell \`cell\`: its planes — the four sides in turn around it, then the near
 *  plane —, its axes and edges. */
fn gridColumn(cell:vec2u)->Column{
 var near:array<vec3f,4>;var deep:array<vec3f,4>;
 for(var corner=0u;corner<4u;corner++){near[corner]=cellCorner(cell,corner,${DEPTH_NEAR}.0);deep[corner]=cellCorner(cell,corner,COLUMN_DEPTH);}
 var column:Column;
 let inside=(deep[0]+deep[1]+deep[2]+deep[3])*0.25;
 for(var i=0u;i<4u;i++){
  // The \`i\`th corner in turn around the column is the Gray code of \`i\`.
  let a=i^(i>>1u);let b=((i+1u)%4u)^(((i+1u)%4u)>>1u);
  column.planes[i]=inwardPlane(cross(deep[b]-deep[a],deep[a]-near[a]),near[a],inside);
 }
 column.planes[4]=inwardPlane(cross(deep[1]-deep[0],deep[2]-deep[0]),near[0],inside);
 column.into=column.planes[4].xyz;
 column.across=normalize(deep[1]-deep[0]);
 column.down=normalize(deep[2]-deep[0]);
 let tn=dot(column.into,near[0]);let td=dot(column.into,deep[0]);
 column.edges[0]=columnEdge(near,deep,column.across,true,0u,2u,tn,td);
 column.edges[1]=columnEdge(near,deep,column.across,false,1u,3u,tn,td);
 column.edges[2]=columnEdge(near,deep,column.down,true,0u,1u,tn,td);
 column.edges[3]=columnEdge(near,deep,column.down,false,2u,3u,tn,td);
 column.near=tn;
 return column;
}
/** A sphere not wholly behind any of the column's planes. */
fn sphereInColumn(column:Column,centre:vec3f,radius:f32)->bool{
 for(var i=0u;i<5u;i++){if(dot(column.planes[i].xyz,centre)+column.planes[i].w< -radius){return false;}}
 return true;
}
/** f(t), the squared distance from the centre \`c\` (across, down, along) to the column's section at
 *  depth \`t\`, and f'(t). */
fn sectionGap(column:Column,c:vec3f,t:f32)->vec2f{
 var gap=vec2f((t-c.z)*(t-c.z),2.0*(t-c.z));
 for(var axis=0u;axis<2u;axis++){
  let low=column.edges[2u*axis];let high=column.edges[2u*axis+1u];
  let under=low.at+low.slope*t-c[axis];
  let over=c[axis]-(high.at+high.slope*t);
  if(under>0.0){gap+=vec2f(under*under,2.0*under*low.slope);}
  else if(over>0.0){gap+=vec2f(over*over,-2.0*over*high.slope);}
 }
 return gap;
}
/** The depth where the view axis through \`centre\` is at \`t\`, as the render matrix gives it. */
fn depthAt(column:Column,centre:vec3f,t:f32,margin:f32)->u32{
 let p=vec4f(centre+column.into*(t-dot(column.into,centre)),1.0);
 let w=dot(view.depthRows[1],p);
 if(w<=0.0){return 0u;}
 return gridSlice(dot(view.depthRows[0],p)/w*margin);
}
/** The first and last slice of the column a sphere may meet, \`vec2u(1u,0u)\` for none. */
fn lightRun(column:Column,centre:vec3f,radius:f32)->vec2u{
 if(!(radius>0.0)){return vec2u(1u,0u);}
 if(radius>3.0e38){return vec2u(0u,GRID_SLICES-1u);}
 let r=radius*1.001;let R=r*r;
 let c=vec3f(dot(column.across,centre),dot(column.down,centre),dot(column.into,centre));
 var lo=max(c.z-r,column.near);var hi=c.z+r;
 if(!(lo<=hi)){return vec2u(1u,0u);}
 for(var step=0u;step<NEWTON_STEPS;step++){
  let at=sectionGap(column,c,lo);
  if(at.x<=R){break;}
  // Past the minimum, still above r²: the sphere misses the section at every depth.
  if(at.y>=0.0){return vec2u(1u,0u);}
  lo+=(R-at.x)/at.y;
 }
 for(var step=0u;step<NEWTON_STEPS;step++){
  let at=sectionGap(column,c,hi);
  if(at.x<=R){break;}
  if(at.y<=0.0){return vec2u(1u,0u);}
  hi+=(R-at.x)/at.y;
 }
 if(!(lo<=hi)){return vec2u(1u,0u);}
 return vec2u(depthAt(column,centre,lo,RUN_FRONT),depthAt(column,centre,hi,RUN_BACK));
}`,
)
