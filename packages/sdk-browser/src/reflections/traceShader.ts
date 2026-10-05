import { shaderLanguage } from '../math/shaderLanguage.ts';
/** The ray from `P` along `R`, clipped to the view (`reflectionExit`) and projected: `start` and
 *  `delta` in pixels, depth `a.z` to `b.z`, `size` the drawn one; clipped away, a miss. The
 *  walk every mirror and rough ray takes (`screenReflection`) and the cone's (`coneShader.ts`)
 *  begin with it and read its names. */
export const REFLECTION_SEGMENT = `
 var c:vec4f=reflectionProject(vec4f(P,1.0));
 var d:vec4f=reflectionProject(vec4f(R,0.0));
 var reach:f32=reflectionExit(c,d);
 if(reach<=0.0||c.w<=0.0){return vec4f(0.0);}
 var e:vec4f=c+d*reach;
 if(e.w<=0.0){return vec4f(0.0);}
 var size:vec2f=reflectionSize();
 var a:vec3f=c.xyz/c.w;var b:vec3f=e.xyz/e.w;
 var start:vec2f=(a.xy*0.5+vec2f(0.5))*size;
 var delta:vec2f=(b.xy-a.xy)*0.5*size;
`;

/** The surface of a pixel, written once for both graphics APIs, for the opaque walk below and the
 *  depth bounds (the blended march's `translucentReflectionMarch` keeps its own plane,
 *  `screenWgsl.ts`, on the first two tests here): a pixel answers where the ray crosses it, not
 *  where the ray's depth spans the one held at the pixel's centre. A grazing ray's depth changes
 *  over a pixel far less than the surface's, so that flat compare missed most of its crossings —
 *  a band of hits and misses on a mirror seen at a slant.
 *  - `reflectionContinues`: whether depths `lo`, `z`, `hi`, a step apart, lie on one surface —
 *    their steps of one sign within a factor two (a projected plane's depth is affine on the
 *    screen, its steps equal; a curved one's close), or both none (a surface facing the screen);
 *    never across the background. `reflectionSideSlope`: at a rim, the background on one side, the
 *    step to the drawn one; else none.
 *  - `reflectionTangent`: a unit vector across `v`, from the z axis, or the y axis where `v` is
 *    nearly z: one frame round a direction for every lobe and plane the walks span.
 *  - `reflectionHalves`: the opaque walk's surface along `axis`: the depth's change per pixel over
 *    the pixel's lower and upper half, the step to the neighbour on that side where it lies on the
 *    pixel's own surface. Two pixels of one surface then meet at the middle of their shared border
 *    at the mean of their depths, the same from either side; along that border each keeps its own
 *    slope across it, so a ray passing between them away from the middle may still slip through by
 *    the difference of those slopes, which a curved surface or a crease beside it makes. A
 *    neighbour lies on it where the three continue (`reflectionContinues`), or, at an edge — a
 *    crease, a silhouette, the screen's border, off which nothing is drawn
 *    (`reflectionDepthOrClear`) —, where it and the one past it continue the pixel; a half whose
 *    neighbour does not runs on with the other half's slope to the border; neither: the rim's
 *    slope (`reflectionSideSlope`), else flat. At an edge an axis reads the depth two pixels out
 *    where its neighbour is drawn and `beyond` (lower, upper; below zero: none) does not hold it.
 *    The plane read whole across an edge — the central difference, flat or bent beside a crease,
 *    the background, the screen's border — let rays cross a room's corner, a wall's foot or a
 *    sphere's rim through it. `reflectionSurface`: both axes' halves, `(x lower, x upper, y lower,
 *    y upper)`, from the depths around the pixel (`reflectionAround`: left, right, down, up) and
 *    two pixels out (`beyond`, the same order); `reflectionOnSurface`, its depth at `at`.
 *  - `reflectionPixelBounds`: the depth `p`'s surface reaches over the pixel, its centre's and its
 *    borders' on each axis: the range a crossing inside it lies in, which the depth bounds start
 *    from; none (`[1, 0]`) where the depth is clear.
 *  Written in the subset `shaderLanguage` turns into GLSL — typed `var`, no `let` or `select` —
 *  and ahead of the walks: GLSL reads top to bottom. */
const PLANE = `
fn reflectionDepthOrClear(p:vec2i)->f32{
 var size:vec2i=vec2i(reflectionSize());
 if(p.x<0||p.y<0||p.x>=size.x||p.y>=size.y){return reflectionClearDepth();}
 return reflectionDepthAt(p);
}
fn reflectionContinues(z:f32,lo:f32,hi:f32)->bool{
 var a:f32=z-lo;var b:f32=hi-z;
 return lo!=reflectionClearDepth()&&hi!=reflectionClearDepth()&&a*b>=0.0&&max(abs(a),abs(b))<=2.0*min(abs(a),abs(b));
}
fn reflectionSideSlope(z:f32,lo:f32,hi:f32)->f32{
 if(lo==reflectionClearDepth()&&hi!=reflectionClearDepth()){return hi-z;}
 if(hi==reflectionClearDepth()&&lo!=reflectionClearDepth()){return z-lo;}
 return 0.0;
}
fn reflectionTangent(v:vec3f)->vec3f{
 var axis:vec3f=vec3f(0.0,0.0,1.0);
 if(abs(v.z)>0.999){axis=vec3f(0.0,1.0,0.0);}
 return normalize(cross(axis,v));
}
fn reflectionHalves(p:vec2i,z:f32,axis:vec2i,lo:f32,hi:f32,beyond:vec2f)->vec2f{
 if(reflectionContinues(z,lo,hi)){return vec2f(z-lo,hi-z);}
 var far:vec2f=beyond;
 if(far.x<0.0&&lo!=reflectionClearDepth()){far.x=reflectionDepthOrClear(p-2*axis);}
 if(far.y<0.0&&hi!=reflectionClearDepth()){far.y=reflectionDepthOrClear(p+2*axis);}
 var lower:bool=lo!=reflectionClearDepth()&&reflectionContinues(lo,far.x,z);
 var upper:bool=hi!=reflectionClearDepth()&&reflectionContinues(hi,z,far.y);
 if(lower&&upper){return vec2f(z-lo,hi-z);}
 if(lower){return vec2f(z-lo);}
 if(upper){return vec2f(hi-z);}
 return vec2f(reflectionSideSlope(z,lo,hi));
}
fn reflectionAround(p:vec2i)->vec4f{
 return vec4f(reflectionDepthOrClear(p-vec2i(1,0)),reflectionDepthOrClear(p+vec2i(1,0)),reflectionDepthOrClear(p-vec2i(0,1)),reflectionDepthOrClear(p+vec2i(0,1)));
}
fn reflectionSurface(p:vec2i,z:f32,around:vec4f,beyond:vec4f)->vec4f{
 return vec4f(reflectionHalves(p,z,vec2i(1,0),around.x,around.y,beyond.xy),reflectionHalves(p,z,vec2i(0,1),around.z,around.w,beyond.zw));
}
fn reflectionOnSurface(p:vec2i,z:f32,surface:vec4f,at:vec2f)->f32{
 var d:vec2f=at-vec2f(p)-vec2f(0.5);
 var depth:f32=z;
 if(d.x<0.0){depth+=surface.x*d.x;}else{depth+=surface.y*d.x;}
 if(d.y<0.0){depth+=surface.z*d.y;}else{depth+=surface.w*d.y;}
 return depth;
}
fn reflectionPixelBounds(p:vec2i)->vec2f{
 var z:f32=reflectionDepthAt(p);
 if(z==reflectionClearDepth()){return vec2f(1.0,0.0);}
 var ends:vec4f=reflectionSurface(p,z,reflectionAround(p),vec4f(-1.0))*vec4f(-0.5,0.5,-0.5,0.5);
 var low:f32=min(0.0,min(ends.x,ends.y))+min(0.0,min(ends.z,ends.w));
 var high:f32=max(0.0,max(ends.x,ends.y))+max(0.0,max(ends.z,ends.w));
 return vec2f(z+low,z+high);
}`;

/** A pyramid cell's side at `level`, the cell holding `pixel` there and the climb's (`into`): its
 *  coordinates shifted right by the level, the floor of their quotient by 2^level for any sign —
 *  what the walk divided by `exp2` and floored before, exactly: two divisions and two floors fewer
 *  a step. */
const CELL = 'vec2f(f32(pixel.x>>u32(level)),f32(pixel.y>>u32(level)))';
const side = 'f32(1<<u32(level))';
const into = `var into:vec2f=${CELL};`;

/** Screen-space pixel DDA, written from the projected-segment equations.
 * Clip the homogeneous ray to all six planes before division. Depth is linear along
 * the projected segment; each visited pixel answers where the segment passes from before its
 * surface (`reflectionSurface`) to behind it between the pixel's borders — at its entry, where it
 * crosses the pixel's centre lines, or at its exit —, from that pixel's own depths and the ray
 * alone. Leaving a surface, or entering a pixel behind it, is never a hit: the segment passes
 * behind what the depth holds, as when it passes behind a nearer object, and walks on; a ray from
 * its receiver, whose point lies a rounding off the depth held there, never answers that receiver
 * (the lift `boundedReflectionRay` needs). No thickness is taken: a walk that ends a ray behind a
 * pixel by a relative depth thickness as a miss, or a fixed-step march that answers behind it
 * within a compare tolerance, loses hits the surfaces' own crossing finds, and a wall or a
 * tolerance at the border answers hidden faces.
 * The pixels are walked over the nearest/farthest depth pyramid (`reflectionBoundsAt`, built by
 * `boundsPyramidWgsl.ts` and `pyramidGl.ts`), each of whose cells bounds the depth its pixels'
 * surfaces reach over them (`reflectionPixelBounds`): a cell whose range the segment's depth over
 * it cannot meet, widened by the depth's own precision, holds no answer and is passed whole, and
 * the walk climbs a level; one it may meet is entered a level down, and not climbed back into while
 * the segment is still inside it. Past a cell, the walk resumes on the pixel the segment enters, as
 * the DDA steps. Each pixel's answer is its own, so the pyramid's first hit is the pixel walk's.
 * Work is bounded by the viewport's width plus height and the pyramid's height
 * (`reflectionHiZSteps`), with no world-space step/thickness.
 * The adapters supply a canonical [0,w] depth, texture-oriented Y, the hit's radiance, whose
 * alpha 0 is a pixel the source cannot answer: a miss, and the pyramid's levels above the pixels
 * (`reflectionBoundsLevels`). */
const trace = `${PLANE}
fn reflectionExit(c:vec4f,d:vec4f)->f32{
 var end:f32=1e30;
 for(var plane:i32=0;plane<6;plane++){
  var p:f32=0.0;var v:f32=0.0;
  if(plane==0){p=c.w+c.x;v=d.w+d.x;}
  if(plane==1){p=c.w-c.x;v=d.w-d.x;}
  if(plane==2){p=c.w+c.y;v=d.w+d.y;}
  if(plane==3){p=c.w-c.y;v=d.w-d.y;}
  if(plane==4){p=c.z;v=d.z;}
  if(plane==5){p=c.w-c.z;v=d.w-d.z;}
  if(p<0.0){return 0.0;}
  if(v<0.0){end=min(end,-p/v);}
 }
 return end;
}
fn reflectionHiZSteps(size:vec2f,top:i32)->i32{return 2*(i32(size.x+size.y)+top)+2;}
fn reflectionHiZWalk(start:vec2f,delta:vec2f,za:f32,zb:f32,size:vec2f)->vec4f{
 var top:i32=reflectionBoundsLevels();
 var origin:vec2i=vec2i(floor(start));var pixel:vec2i=origin;
 // Before is nearer the eye: a greater depth where the clear depth is zero, a smaller one where it
 // is one; \`toward\` turns a depth into how far before the eye's far end it lies.
 var toward:f32=1.0-2.0*reflectionClearDepth();
 // The depth's precision, which widens a cell's range.
 var slack:f32=max(abs(za),abs(zb))*exp2(-20.0);
 var level:i32=0;var t:f32=0.0;
 // The last cell a descent entered, its level (none: -1) and depth range: at level 0, the cell of
 // level 1 that holds the pixel, whose range holds the pixel's.
 var heldLevel:i32=-1;var held:vec2f=vec2f(0.0);var heldRange:vec2f=vec2f(-1e30,1e30);
 // The last pixel read at level 0, its depth (the clear depth: none) and its neighbours' (left,
 // right, down, up): the pixel beside it reads three depths, not five, and at an edge across that
 // side no depth two pixels out.
 var last:vec2i=origin;var lastDepth:f32=reflectionClearDepth();var lastAround:vec4f=vec4f(0.0);
 // Each pixel the segment crosses is walked at level 0 once at most, and each descent pairs with a
 // climb: its steps are bounded by the screen, never cut by a count.
 var steps:i32=reflectionHiZSteps(size,top);
 for(var i:i32=0;i<steps;i++){
  if(pixel.x<0||pixel.y<0||f32(pixel.x)>=size.x||f32(pixel.y)>=size.y){break;}
  var side:f32=${side};
  var cell:vec2f=${CELL};
  var bound:vec2f=vec2f(1e30);
  if(delta.x>0.0){bound.x=((cell.x+1.0)*side-start.x)/delta.x;}
  if(delta.x<0.0){bound.x=(cell.x*side-start.x)/delta.x;}
  if(delta.y>0.0){bound.y=((cell.y+1.0)*side-start.y)/delta.y;}
  if(delta.y<0.0){bound.y=(cell.y*side-start.y)/delta.y;}
  var exited:f32=min(1.0,min(bound.x,bound.y));
  var before:f32=mix(za,zb,t)*toward;var after:f32=mix(za,zb,exited)*toward;
  // The cell's range (at level 0, the level-1 cell's that holds the pixel), and whether the
  // segment's depth over the cell may meet it.
  var range:vec2f=heldRange;
  if(level>0){range=reflectionBoundsAt(vec2i(cell),level);}
  var nearest:f32=max(range.x*toward,range.y*toward);var farthest:f32=min(range.x*toward,range.y*toward);
  var meets:bool=range.x<=range.y&&farthest<=max(before,after)+slack&&nearest>=min(before,after)-slack;
  if(level>0&&meets){heldLevel=level;held=cell;heldRange=range;level-=1;continue;}
  // The receiver's own pixel never answers, nor is read.
  if(level==0&&meets&&(pixel.x!=origin.x||pixel.y!=origin.y)){
   var beside:vec2i=vec2i(0);
   if(lastDepth!=reflectionClearDepth()&&abs(pixel.x-last.x)+abs(pixel.y-last.y)==1){beside=pixel-last;}
   var z:f32=0.0;
   if(beside.x==1){z=lastAround.y;}else if(beside.x==-1){z=lastAround.x;}else if(beside.y==1){z=lastAround.w;}else if(beside.y==-1){z=lastAround.z;}else{z=reflectionDepthAt(pixel);}
   if(z!=reflectionClearDepth()){
    var around:vec4f=vec4f(lastDepth);var beyond:vec4f=vec4f(-1.0);
    if(beside.x!=1){around.x=reflectionDepthOrClear(pixel-vec2i(1,0));}else{beyond.x=lastAround.x;}
    if(beside.x!=-1){around.y=reflectionDepthOrClear(pixel+vec2i(1,0));}else{beyond.y=lastAround.y;}
    if(beside.y!=1){around.z=reflectionDepthOrClear(pixel-vec2i(0,1));}else{beyond.z=lastAround.z;}
    if(beside.y!=-1){around.w=reflectionDepthOrClear(pixel+vec2i(0,1));}else{beyond.w=lastAround.w;}
    lastAround=around;
    // How far before the surface the segment is where it enters the pixel, crosses its centre
    // lines (each half its own slope) and leaves it: an answer where it passes from before to
    // behind between two of them.
    var surface:vec4f=reflectionSurface(pixel,z,around,beyond);
    var centre:vec2f=vec2f(t);
    if(delta.x!=0.0){centre.x=(f32(pixel.x)+0.5-start.x)/delta.x;}
    if(delta.y!=0.0){centre.y=(f32(pixel.y)+0.5-start.y)/delta.y;}
    var first:f32=clamp(min(centre.x,centre.y),t,exited);var second:f32=clamp(max(centre.x,centre.y),t,exited);
    var inFront:f32=before-reflectionOnSurface(pixel,z,surface,start+delta*t)*toward;
    var firstFront:f32=(mix(za,zb,first)-reflectionOnSurface(pixel,z,surface,start+delta*first))*toward;
    var secondFront:f32=(mix(za,zb,second)-reflectionOnSurface(pixel,z,surface,start+delta*second))*toward;
    var outFront:f32=after-reflectionOnSurface(pixel,z,surface,start+delta*exited)*toward;
    if((inFront>=0.0&&firstFront<=0.0)||(firstFront>=0.0&&secondFront<=0.0)||(secondFront>=0.0&&outFront<=0.0)){return reflectionHitAt(pixel);}
   }
   last=pixel;lastDepth=z;
  }
  if(exited>=1.0){break;}
  // On to the pixel the segment enters past the cell: across the border it leaves by, the other
  // axis where the segment then is, inside the cell. At level 0 the DDA's step.
  var low:vec2i=vec2i(cell*side);var high:vec2i=vec2i((cell+vec2f(1.0))*side)-vec2i(1);
  var at:vec2f=floor(start+delta*exited);
  var next:vec2i=vec2i(clamp(i32(at.x),low.x,high.x),clamp(i32(at.y),low.y,high.y));
  if(bound.x<=bound.y){
   if(delta.x>0.0){next.x=high.x+1;}else{next.x=low.x-1;}
  }
  if(bound.y<=bound.x){
   if(delta.y>0.0){next.y=high.y+1;}else{next.y=low.y-1;}
  }
  pixel=next;t=exited;
  level=min(level+1,top);
  // Climbed back to the held cell's level while still inside it: no use, it was entered.
  if(level==heldLevel){
   ${into}
   if(into.x==held.x&&into.y==held.y){level-=1;}
  }
 }
 return vec4f(0.0);
}
fn screenReflection(P:vec3f,R:vec3f)->vec4f{${REFLECTION_SEGMENT} return reflectionHiZWalk(start,delta,a.z,b.z,size);
}`;

/** One arithmetic source for both graphics APIs; declarations alone change language. */
export function screenTraceShader(language: 'wgsl' | 'glsl') {
  return shaderLanguage(trace, language);
}

/** The pixel's surface alone (`PLANE`: `reflectionPixelBounds` and what it reads), for a program
 *  that builds the depth bounds (`boundsPyramidWgsl.ts`, `pyramidGl.ts`) rather than walks them;
 *  it supplies the depth, size and clear depth. */
export function reflectionPlaneShader(language: 'wgsl' | 'glsl') {
  return shaderLanguage(PLANE, language);
}
