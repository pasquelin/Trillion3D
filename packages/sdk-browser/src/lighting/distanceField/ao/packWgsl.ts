import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { DFAO_COMMON_WGSL } from './commonWgsl.ts'
import { HISTORY_GROUP } from './historyWgsl.ts'
import { DFAO_BINDING as B } from './layout.ts'

/**
 * THE IMAGE PACKED FOR THE LIT PASS (`dfaoPack`), a thread a cell of the grid's view: the cell of the image the history holds
 * (the bent normal and the scene depth in centimetres, four half floats) written as two words into a buffer, row by row at
 * the grid's width. The lit pass has no sampled texture left to read the image with, and reads this buffer by load instead
 * (`dfaoReadWgsl`); half floats in a texture and half floats in two words are the same bits.
 */
export const DFAO_PACK_WGSL = wgslProgram(
  `@group(0) @binding(${B.history}) var image:texture_2d<f32>;
@group(0) @binding(${B.packed}) var<storage,read_write> packed:array<vec2u>;
@compute @workgroup_size(${HISTORY_GROUP},${HISTORY_GROUP})
fn dfaoPack(@builtin(global_invocation_id) id:vec3u){
 if(any(id.xy>=dfao.grid.zw/2u)){return;}
 let cell=textureLoad(image,vec2i(id.xy),0);
 packed[id.y*dfao.grid.x+id.x]=vec2u(pack2x16float(cell.xy),pack2x16float(cell.zw));
}`,
  [DFAO_COMMON_WGSL],
)
