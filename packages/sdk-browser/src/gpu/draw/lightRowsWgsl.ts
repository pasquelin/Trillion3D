import { DRAW_ITEM_WGSL, WORKGROUP } from './contract.ts';

/**
 * Catalogue page → page-table row, on the card beside the draw records: how the pages a light cut
 * drew find the rows that hold them (`../shadow/cullShader.ts`, `SHADOW_LIGHT_CULL_SHADER`).
 *
 * The map is kept by the rows the table rewrites and by them alone (`markRows`, over the range the
 * camera's encode uploaded), so a frame where no page arrives, leaves or moves touches none of it.
 * A stale entry is never trusted: the row it names must still carry that page, or the reader
 * drops it.
 */
export const ROW_MAP_SHADER = `${DRAW_ITEM_WGSL}
struct Range{first:u32,last:u32,pad0:u32,pad1:u32,}
@group(0) @binding(0) var<storage, read> items:array<DrawItem>;
@group(0) @binding(1) var<uniform> range:Range;
@group(0) @binding(2) var<storage, read_write> rowOf:array<u32>;
@compute @workgroup_size(${WORKGROUP})
fn mapRows(@builtin(global_invocation_id) id:vec3u){
 let row=range.first+id.x;
 if(row>range.last){return;}
 rowOf[items[row].selectionIndex]=row;
}
`;
