import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { BOUNCE_ATLAS_FORMAT, TABLE_LAYER } from '../atlas.ts'
import { TABLE_BINDINGS } from './probeBindings.ts'

/** Words of a record of the table's queue: the texel's column and row, its four lanes — the entries'
 *  slots + 1, as `f32`s —, and two words of padding. The queue's first record holds the count. */
export const TABLE_RECORD_WORDS = 8

/**
 * The table's writes: the texels of the table that changed — a probe published by its first update,
 * a probe given back — written into the table's layer of the probes' atlas and of its snapshot, a
 * thread a record. A record carries the texel's four entries whole, all of them composed by the
 * host after every allocation and release of the frame, so two records of one texel are equal and
 * their order is no matter. The queue's first record holds the count of the records after it.
 */
export const BOUNCE_TABLE_SHADER = wgslProgram(
  `${wgslConsts({ TABLE_LAYER, TABLE_RECORD_WORDS })}
@group(0) @binding(${TABLE_BINDINGS.records}) var<storage,read> tableRecords:array<u32>;
@group(0) @binding(${TABLE_BINDINGS.probes}) var probesOut:texture_storage_2d_array<${BOUNCE_ATLAS_FORMAT},write>;
@group(0) @binding(${TABLE_BINDINGS.snapshot}) var snapshotOut:texture_storage_2d_array<${BOUNCE_ATLAS_FORMAT},write>;
@compute @workgroup_size(WORKGROUP_THREADS)
fn writeTable(@builtin(global_invocation_id) id:vec3u){
 if(id.x>=tableRecords[0]){return;}
 let at=(id.x+1u)*TABLE_RECORD_WORDS;
 let place=vec2u(tableRecords[at],tableRecords[at+1u]);
 let lanes=vec4f(bitcast<f32>(tableRecords[at+2u]),bitcast<f32>(tableRecords[at+3u]),bitcast<f32>(tableRecords[at+4u]),bitcast<f32>(tableRecords[at+5u]));
 textureStore(probesOut,place,TABLE_LAYER,lanes);
 textureStore(snapshotOut,place,TABLE_LAYER,lanes);
}`,
  [WORKGROUP_THREADS_WGSL],
)
