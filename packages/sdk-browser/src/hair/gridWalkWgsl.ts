import { wgslFn } from '../../../math/src/wgsl/decl.ts'

/** One step of a digital differential analyser over a grid: the cell whose next boundary is nearer
 *  along x (`side.x < side.y`, ties go to y) is left, `coord` stepping by `step` along that axis and
 *  `side`, the distance to the next boundary there, growing by `delta`. */
export const gridWalkAdvance = wgslFn(
  'gridWalkAdvance',
  [],
  `fn gridWalkAdvance(coord:ptr<function,vec2f>,side:ptr<function,vec2f>,delta:vec2f,step:vec2f){
 if((*side).x<(*side).y){
  (*side).x+=delta.x;
  (*coord).x+=step.x;
 }else{
  (*side).y+=delta.y;
  (*coord).y+=step.y;
 }
}`,
)
