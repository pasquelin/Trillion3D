/**
 * Compute-raster contract: one writing of the numbers that both the WGSL and the encoder read.
 * The raster takes the share of the opaque and masked cut that the split gives it, up to the
 * whole cut; blend keeps its hardware pass.
 *
 * Four size classes, two lists. A class says how many pixels a sixty-four-thread group covers
 * at once, never what a triangle is worth: the class is read on the triangle's WHOLE box,
 * clipped to the viewport, so a triangle half off-screen falls in the class of what remains.
 * No class can overflow while the other has room: both of the same list fill it from both
 * ends, and the bound is held on the sum.
 */

/** Groups one dispatch dimension guarantees: the list spreads over x and z as needed. */
export const DISPATCH_SPAN = 65535;

/** Side of the fine-class tile, and triangles a sixty-four-thread group treats there. */
export const FINE_SIDE = 4;

export const FINE_PER_GROUP = 64 / (FINE_SIDE * FINE_SIDE);
/** Side of a full group's tile: the coarse class fits in one, the large class loops. */
export const TILE = 8;
/** Tiles a large-class group walks at most, hence its maximum span in pixels. */
const LARGE_TILES = 8;
export const LARGE_SPAN = TILE * LARGE_TILES - 1;
/** Maximum span of a fine-class box: a tile of `FINE_SIDE` pixels on a side. */
export const FINE_SPAN = FINE_SIDE - 1;

/**
 * The reference's small/large split: a triangle whose screen box, clamped to the frame, does not
 * exceed `computeSpan` pixels goes to the compute raster, the others to hardware. Zero: hardware
 * draws everything. `COMPUTE_ALL` is a mode, not an infinite span: compute then also takes
 * triangles a vertex puts behind the near plane, which a threshold always leaves to hardware,
 * which clips them itself.
 */
export const COMPUTE_ALL = 1e9;

/**
 * The split predicate, the same text in both rasters: they read the same vertices, the same
 * hoisted product `viewProj*world`, the same box — and share the cut with neither hole nor
 * duplicate. Requires `uni.viewport` and `uni.computeSpan`.
 */
export const COMPUTE_TAKES_WGSL = `
fn screen(p:vec4f)->vec2f{return vec2f((p.x/p.w*0.5+0.5)*uni.viewport.x,(1.0-(p.y/p.w*0.5+0.5))*uni.viewport.y);}
struct ScreenBox{lo:vec2f,hi:vec2f,q0:vec2f,q1:vec2f,span:f32,}
/** Screen-extent box clamped to the frame, and its span in integer pixels. */
fn boxOf(lo:vec2f,hi:vec2f)->ScreenBox{
 let last=uni.viewport-vec2f(1.0);
 let q0=clamp(floor(lo),vec2f(0.0),last);let q1=clamp(floor(hi),vec2f(0.0),last);
 return ScreenBox(lo,hi,q0,q1,max(q1.x-q0.x,q1.y-q0.y));
}
fn screenBox(a:vec2f,b:vec2f,c:vec2f)->ScreenBox{return boxOf(min(a,min(b,c)),max(a,max(b,c)));}
fn computeTakes(ca:vec4f,cb:vec4f,cc:vec4f)->bool{
 if(uni.computeSpan>=${COMPUTE_ALL}){return true;}
 if(uni.computeSpan<=0.0||ca.w-ca.z<0.0||cb.w-cb.z<0.0||cc.w-cc.z<0.0){return false;}
 return screenBox(screen(ca),screen(cb),screen(cc)).span<=uni.computeSpan;
}`;

/** Words the list reserves before its entries: four counts, the frame's largest height in
 *  tiles, then the four dispatches the `plan` kernel derives from them. */
export const CNT_FINE = 0,
  CNT_COARSE = 1,
  CNT_LARGE = 2,
  CNT_HUGE = 3,
  TILE_ROWS = 4;
/** First word of the indirect dispatches; they are contiguous so they copy as one. */
export const DISPATCH_BASE = 6;
export const DISPATCH_WORDS = 12;
export const LIST_HEADER = 20;

/** Header bytes the frame clears: the five counters, rounded to the copy word. */
export const HEADER_CLEAR_BYTES = 24;

/**
 * The three modes of a raster kernel, in the order the frame encodes them.
 * `DEPTH_OCCLUDER` writes the occluder-half depth — that is what the pyramid reduces;
 * `DEPTH_REST` adds the tested half the Hi-Z verdict kept; `ID` finally resolves identifiers
 * on the now-final depth.
 */
export const MODE_DEPTH_OCCLUDER = 0,
  MODE_DEPTH_REST = 1,
  MODE_ID = 2;

/** The four classes, in the order of their indirect dispatches. */
export const RASTER_CLASSES = ['fine', 'coarse', 'large', 'huge'] as const;
export type RasterClass = (typeof RASTER_CLASSES)[number];

/** Entry-point name of a class in a mode: one rule, both sides read it. */
export const rasterEntry = (klass: RasterClass, mode: number) => `${klass}${mode}`;
