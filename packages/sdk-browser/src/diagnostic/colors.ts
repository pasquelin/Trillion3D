import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../math/src/wgsl/number.ts'
import { luminance } from '../../../math/src/wgsl/color.ts'
import { toHalf } from '../../../math/src/float/half.ts'
import { TRIANGLE_PALETTE_WGSL } from './trianglePalette.ts'
import { DIAGNOSTIC_VIEWS } from '../visibility/shader/shadeMode.ts'
import { CLASS_FEATURE } from '../visibility/shader/classWords.ts'
/**
 * What a diagnostic view paints, computed here and nowhere else: the cluster's diagnostic word and
 * the colours of every view. Pure arithmetic, so a view can read it without loading the boundary
 * that builds host objects.
 */

/** A cluster's diagnostic word (`PageInfo.diagnosticWord`, a transparent instance's cluster word),
 *  written once with its row, never per image — a primitive's coloration indices change only when
 *  its row does —: its DAG level in the low seven bits, its HLOD index
 *  (`HLOD_INDEX`) in four from `hlodShift`, its error (`PageRec.lodError`, object units) a half float
 *  in the high sixteen. Every view reads it in the shader (`diagnosticColor`), the screen error
 *  projected there through the view (`diagnosticScreenError`). */
const DIAGNOSTIC_WORD = { levelMask: 0x7f, hlodShift: 8, hlodMask: 0xf, errorShift: 16 }

/** The diagnostic word of a level, an HLOD index and an error (`DIAGNOSTIC_WORD`). */
export const packDiagnosticWord = (level: number, hlod: number, lodError: number) =>
  (Math.min(level, DIAGNOSTIC_WORD.levelMask) |
    (Math.min(hlod, DIAGNOSTIC_WORD.hlodMask) << DIAGNOSTIC_WORD.hlodShift) |
    (toHalf(Math.max(lodError, 0)) << DIAGNOSTIC_WORD.errorShift)) >>>
  0

type Rgb = readonly [number, number, number]
const vec3 = (c: Rgb) => `vec3f(${c.map(wgslF32).join(',')})`

/** One solid colour per DAG level (`levelDiagnostic`), level 0 the full detail — white, red, green,
 *  blue, yellow, fuchsia, cyan, purple: saturated hues far apart, adjacent levels never alike —, the last for every level past it. */
const LEVEL_COLORS: readonly Rgb[] = [
  [1, 1, 1],
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
  [1, 1, 0],
  [1, 0, 1],
  [0, 1, 1],
  [0.5, 0, 0.5],
]
/** The HLOD coloration index of a primitive: `none` a primitive no proxy stands in for, `level0`
 *  and each level past it the proxy of that level drawn (`level0 + its level`). Read as an index into
 *  `HLOD_COLORS`. */
export const HLOD_INDEX = { none: 0, level0: 1 } as const
/** The HLOD index of a page of HLOD index `index` whose placement draws as HLOD level `drawnAs` —
 *  0 its cell's HLOD 0 actor, an instanced actor's level for a row of it, -1 itself —: that
 *  level's in place of `none` — the one rule, the opaque rows' word written with it
 *  (`pageDiagnosticWord`), a transparent item's applied in its vertex stage
 *  (`diagnosticDrawnAs`). */
export const drawnAsHlod = (index: number, drawnAs: number) =>
  drawnAs >= 0 && index === HLOD_INDEX.none ? HLOD_INDEX.level0 + drawnAs : index
/** The HLOD coloration: white (no proxy), blue (HLOD level 0), yellow (HLOD level 1), purple,
 *  cyan, grey — the last for every index past it, so a deeper chain still reads as a proxy. */
const HLOD_COLORS: readonly Rgb[] = [
  [1, 1, 1],
  [0, 0, 1],
  [1, 1, 0],
  [1, 0, 1],
  [0, 1, 1],
  [0.5, 0.5, 0.5],
]
/** The wireframe's colour of a primitive, by its mobility: cyan when still, magenta when it
 *  moves, so what the scene moves reads apart from what stands. */
const WIRE_COLORS = { still: [0, 1, 1], movable: [1, 0, 1] } as const
/** A primitive's wire colour by its mobility (`WIRE_COLORS`): the wireframe's, the blended one's
 *  and the x-ray view's (`../visibility/shader/visWgsl.ts`). */
export const DIAGNOSTIC_WIRE_WGSL = wgslBlock(
  'DIAGNOSTIC_WIRE_WGSL',
  [],
  `fn diagnosticWireColor(movable:bool)->vec3f{return select(${vec3(WIRE_COLORS.still)},${vec3(WIRE_COLORS.movable)},movable);}`,
)

const V = DIAGNOSTIC_VIEWS

/** The colours a diagnostic view paints with, as the two resolves read them (the opaque one,
 *  `../visibility/shader/shadeWgsl.ts`, and the blended one, `../blend/shader.ts`): the flat
 *  green of a page, one colour per DAG level (`LEVEL_COLORS`), one per HLOD index
 *  (`HLOD_COLORS`), and the error ramp from green (exact) to red.
 *  `diagnosticShade` darkens a colour by its face's axis — full facing up, less facing x, least
 *  facing z —, so a wall reads apart from the ground in one flat colour. `diagnosticDebugColor`
 *  is the shading of the LOD and HLOD colorations instead: the colour times
 *  `0.05 + 0.95·Luminance(BaseColor + Emissive)`, unlit — the surface's own brightness keeps its
 *  detail readable under the flat colour, never fully black.
 *  `diagnosticColor` is the one colour of a view's pixel (`DiagnosticPixel`), every resolve's; the
 *  voxel view paints a voxel row (its material class's `CLASS_FEATURE.VOXEL`) in its level's
 *  colour and any other pixel grey by its brightness. */
export const DIAGNOSTIC_PALETTE_WGSL = wgslBlock(
  'DIAGNOSTIC_PALETTE_WGSL',
  [luminance, TRIANGLE_PALETTE_WGSL, DIAGNOSTIC_WIRE_WGSL],
  `const DIAGNOSTIC_LEVEL_COLORS=array<vec3f,${LEVEL_COLORS.length}>(${LEVEL_COLORS.map(vec3).join(',')});
const DIAGNOSTIC_HLOD_COLORS=array<vec3f,${HLOD_COLORS.length}>(${HLOD_COLORS.map(vec3).join(',')});
fn diagnosticFlat()->vec3f{return vec3f(0.204,0.827,0.6);}
fn diagnosticLevel(level:u32)->vec3f{return DIAGNOSTIC_LEVEL_COLORS[min(level,${LEVEL_COLORS.length - 1}u)];}
/** \`word\` with its HLOD index as \`drawnAsHlod\` gives it for a placement drawn as the HLOD index
 *  \`drawn\` — \`none\` drawn as itself. */
fn diagnosticDrawnAs(word:u32,drawn:u32)->u32{
 let at=${DIAGNOSTIC_WORD.hlodMask}u<<${DIAGNOSTIC_WORD.hlodShift}u;
 if(drawn==${HLOD_INDEX.none}u||(word&at)!=${HLOD_INDEX.none}u<<${DIAGNOSTIC_WORD.hlodShift}u){return word;}
 return (word&~at)|(min(drawn,${DIAGNOSTIC_WORD.hlodMask}u)<<${DIAGNOSTIC_WORD.hlodShift}u);
}
fn diagnosticHlod(index:u32)->vec3f{return DIAGNOSTIC_HLOD_COLORS[min(index,${HLOD_COLORS.length - 1}u)];}
fn diagnosticDebugColor(color:vec3f,base:vec3f)->vec3f{return color*(0.05+0.95*luminance(base));}
fn diagnosticError(ratio:f32)->vec3f{return vec3f(ratio,1.0-ratio,0.12);}
fn diagnosticShade(color:vec3f,normal:vec3f)->vec3f{
 let q=normal*normal;let sum=q.x+q.y+q.z;
 return color*select(1.0,dot(q,vec3f(0.72,1.0,0.56))/sum,sum>0.0);
}
/** The error of a diagnostic word's cluster in world units: its half float times the largest
 *  stretch of the world's linear part. */
fn diagnosticWorldError(word:u32,world:mat4x4f)->f32{
 let stretch=max(length(world[0].xyz),max(length(world[1].xyz),length(world[2].xyz)));
 return unpack2x16float(word).y*stretch;
}
/** The screen-error ratio of a pixel, the cut's measure (\`projectedClusterError\`) at the pixel's own
 *  clip \`w\`: the world error \`error\` times the focal length in the view's pixels (the larger of
 *  \`viewProj\`'s x and y rows over the viewport in CSS pixels, \`viewport/pixelRatio\`), over \`w\`, over
 *  the cut's threshold — 0 exact, 1 at or past it. */
fn diagnosticScreenError(error:f32,w:f32,viewProj:mat4x4f,viewport:vec2f,pixelRatio:f32,threshold:f32)->f32{
 if(!(error>0.0)){return 0.0;}
 if(!(threshold>0.0)){return 1.0;}
 let rows=vec2f(length(vec3f(viewProj[0].x,viewProj[1].x,viewProj[2].x)),length(vec3f(viewProj[0].y,viewProj[1].y,viewProj[2].y)));
 let focal=max(rows.x*viewport.x,rows.y*viewport.y)*0.5/max(pixelRatio,1e-6);
 return saturate(error*focal/(max(w,1e-6)*threshold));
}
/** What a view's colour reads of a pixel: its cluster's hash, its triangle, its cluster's diagnostic
 *  word (\`DIAGNOSTIC_WORD\`), its material class, its base colour plus emission, its face's normal
 *  and its screen-error ratio (\`diagnosticScreenError\`, read by that view alone). */
struct DiagnosticPixel{cluster:u32,triangle:u32,word:u32,material:u32,base:vec3f,normal:vec3f,screenError:f32}
fn diagnosticColor(mode:u32,p:DiagnosticPixel)->vec3f{
 switch(mode){
  case ${V.triangles.code}u:{return diagnosticShade(hashColor(stableTriangleId(p.cluster,p.triangle)),p.normal);}
  case ${V.clusters.code}u:{return diagnosticShade(hashColor(p.cluster),p.normal);}
  case ${V.lod.code}u:{return diagnosticDebugColor(diagnosticLevel(p.word&${DIAGNOSTIC_WORD.levelMask}u),p.base);}
  case ${V.hlod.code}u:{return diagnosticDebugColor(diagnosticHlod((p.word>>${DIAGNOSTIC_WORD.hlodShift}u)&${DIAGNOSTIC_WORD.hlodMask}u),p.base);}
  case ${V['screen-error'].code}u:{return diagnosticShade(diagnosticError(p.screenError),p.normal);}
  case ${V.materials.code}u:{return diagnosticShade(hashColor(p.material),p.normal);}
  case ${V.voxels.code}u:{
   if((p.material&${CLASS_FEATURE.VOXEL}u)!=0u){return diagnosticShade(diagnosticLevel(p.word&${DIAGNOSTIC_WORD.levelMask}u),p.normal);}
   return vec3f(0.15+0.5*luminance(p.base));
  }
  default:{return diagnosticShade(diagnosticFlat(),p.normal);}
 }
}`,
)
