import { DRAW_ITEM_WGSL } from '../draw/contract.ts';
import { BOX_PROJECT_WGSL, PARTITION_UNI_WGSL } from '../core/boxProjectWgsl.ts';
import { HIZ_HIDDEN_WGSL } from '../hiz/rectWgsl.ts';
import { PARTITION_CLASSIFY_WGSL } from './classifyWgsl.ts';
import { PARTITION_PROJECT_WGSL } from './projectWgsl.ts';
import { PARTITION_BINDING as B } from './contract.ts';

/**
 * GPU partition module: two kernels on the same buffers.
 *
 * `projectRows` reads what each resident row held from the previous image — its verdict, its
 * rectangle — culls it against that image's pyramid, then projects it for this one;
 * `classifyRows` bins each row into its half, counts its indirect slot and packs the tested box.
 * The CPU encodes only these two dispatches, whose count depends only on the row count, and
 * reads nothing back.
 *
 * Ten buffers, of which nine are storage: a stage may bind eight, so each kernel's layout names
 * the buffers it touches and no other (`PARTITION_KERNEL_BINDINGS`). Rest bits and per-slot
 * counts are those of the draw compact, written here rather than uploaded; `flags` is the
 * verdict buffer: `projectRows` reads last frame's, then `classifyRows` writes this frame's —
 * `0` for the occluder half, `2` for the tested half, which the Hi-Z test will set to `1` on
 * rows it rejects. It is through this word, not an extra buffer, that the compute raster learns
 * which half a row is in. `pyramid` is the Hi-Z buffer as the previous image left it.
 */
export const PARTITION_SHADER = `${DRAW_ITEM_WGSL}
${PARTITION_UNI_WGSL}@group(0) @binding(${B.corners}) var<storage, read> corners:array<f32>;
@group(0) @binding(${B.items}) var<storage, read> items:array<DrawItem>;
@group(0) @binding(${B.flags}) var<storage, read_write> flags:array<u32>;
@group(0) @binding(${B.rowData}) var<storage, read_write> rowData:array<u32>;
@group(0) @binding(${B.tested}) var<storage, read_write> tested:array<u32>;
@group(0) @binding(${B.restBits}) var<storage, read_write> restBits:array<atomic<u32>>;
@group(0) @binding(${B.slotUsed}) var<storage, read_write> slotUsed:array<atomic<u32>>;
@group(0) @binding(${B.state}) var<storage, read_write> state:array<atomic<u32>>;
@group(0) @binding(${B.uniforms}) var<uniform> uni:Uni;
@group(0) @binding(${B.pyramid}) var<storage, read> pyramid:array<f32>;
${BOX_PROJECT_WGSL}
${HIZ_HIDDEN_WGSL}
${PARTITION_PROJECT_WGSL}
${PARTITION_CLASSIFY_WGSL}
`;
