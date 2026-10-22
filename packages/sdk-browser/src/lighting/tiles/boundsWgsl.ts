import { DEPTH_NEAR } from '../../camera/depthConvention.ts'
import { wgslBlock, wgslFn } from '../../../../math/src/wgsl/decl.ts'
import { uvToNdc, unprojectPoint } from '../../../../math/src/wgsl/projection.ts'
import { faceNormal, sphereBehindPlane } from '../../../../math/src/wgsl/geometry.ts'
import { FINITE_SENTINEL, INFINITE_THRESHOLD } from '../../../../math/src/wgsl/constants.ts'
import { wgslF32 } from '../../../../math/src/wgsl/number.ts'

/** The range a light's run is solved for, in both grids: widened by a thousandth, and by a
 *  thousandth of a \`cell\`'s side where its cells are world lengths (the bounce's lattice; zero for
 *  the view's, whose depth ends are widened apart, \`RUN_FRONT\`/\`RUN_BACK\`), past every rounding of
 *  the point a reader takes its cell at: a run never misses a cell its light reaches, and a light it
 *  holds in excess adds an exact zero there. */
export const RUN_REACH = { radius: 1.001, cell: 0.001 } as const
const runReach = wgslFn(
  'runReach',
  [],
  `fn runReach(radius:f32,cell:f32)->f32{return radius*${wgslF32(RUN_REACH.radius)}+cell*${wgslF32(RUN_REACH.cell)};}`,
)

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
  [uvToNdc, unprojectPoint, faceNormal, sphereBehindPlane, INFINITE_THRESHOLD, runReach],
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
 column.planes[4]=inwardPlane(faceNormal(deep[0],deep[1],deep[2]),near[0],inside);
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
 let r=runReach(radius,0.0);
 for(var i=0u;i<5u;i++){if(sphereBehindPlane(column.planes[i],centre,r)){return false;}}
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
 if(radius>INFINITE_THRESHOLD){return vec2u(0u,GRID_SLICES-1u);}
 let r=runReach(radius,0.0);let R=r*r;
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

/**
 * A column of the bounce's world light grid (`lightTilesShader('world')`) and the run of its cells a
 * light's range meets. The grid is the lattice laid on the scene (`lightLattice`), which covers it
 * (`../bounce/lightCellWgsl.ts`); the pass reads its view as `origin.xyz`, the grid's lowest
 * corner, `origin.w`, a cell's side, and `viewport.z`, the columns of a row. A column is a square of
 * cells across x and y, its cells the slices along z, all relative to that corner, as a light's
 * centre is (`entryOf`).
 *
 * A light of range `r` meets the column where its distance `d` across x and y to the column's
 * square is at most `r`, and there the slices between `c.z − h` and `c.z + h`, `h = √(r² − d²)`: the
 * very cells its sphere meets, the range widened past every rounding of the point a reader takes its
 * cell at (`runReach`, `bounceLightSlice`).
 *
 * The lattice's edge cells reach past it, to infinity: a point outside the lattice reads the edge
 * cell it is clamped to (`bounceLightSlice`), so an edge column's square runs on past the lattice's
 * side and a run past its first or last slice holds that slice. Every light that reaches a point
 * is in its cell's list, inside the lattice or out of it, and no point walks every light.
 */
export const WORLD_GRID_BOUNDS_WGSL = wgslBlock(
  'WORLD_GRID_BOUNDS_WGSL',
  [INFINITE_THRESHOLD, FINITE_SENTINEL, runReach],
  `struct Column{low:vec2f,high:vec2f,}
/** The column of cell \`cell\`: its square, relative to the grid's corner — an edge column's run
 *  on to infinity past the lattice's side (\`COLUMN_SLICES\` columns a side). */
fn gridColumn(cell:vec2u)->Column{
 let side=view.origin.w;
 let low=select(vec2f(cell)*side,vec2f(-FINITE_SENTINEL),cell==vec2u(0u));
 let high=select(vec2f(cell+vec2u(1u))*side,vec2f(FINITE_SENTINEL),cell>=vec2u(COLUMN_SLICES-1u));
 return Column(low,high);
}
/** The squared distance across x and y from \`centre\` to the column's square. */
fn columnGap(column:Column,centre:vec3f)->f32{
 let d=max(max(column.low-centre.xy,centre.xy-column.high),vec2f(0.0));
 return dot(d,d);
}
/** A sphere that meets the column's square. */
fn sphereInColumn(column:Column,centre:vec3f,radius:f32)->bool{
 let r=runReach(radius,view.origin.w);
 return columnGap(column,centre)<=r*r;
}
/** The first and last cell of the column a sphere may meet, \`vec2u(1u,0u)\` for none: a run past the
 *  column's first or last slice holds that slice, which the points past it read. */
fn lightRun(column:Column,centre:vec3f,radius:f32)->vec2u{
 if(!(radius>0.0)){return vec2u(1u,0u);}
 if(radius>INFINITE_THRESHOLD){return vec2u(0u,COLUMN_SLICES-1u);}
 let r=runReach(radius,view.origin.w);
 let gap=columnGap(column,centre);
 if(gap>r*r){return vec2u(1u,0u);}
 let h=sqrt(r*r-gap);
 let lo=floor((centre.z-h)/view.origin.w);let hi=floor((centre.z+h)/view.origin.w);
 let last=f32(COLUMN_SLICES-1u);
 return vec2u(u32(clamp(lo,0.0,last)),u32(clamp(hi,0.0,last)));
}`,
)
