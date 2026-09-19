import { BOX_PROJECT_WGSL, PARTITION_UNI_WGSL } from './gpuBoxProjectWgsl.ts';
import { HIZ_LEVEL_WGSL } from './gpuHizRectWgsl.ts';
import { PARTITION_CLASSIFY_WGSL } from './gpuPartitionClassifyWgsl.ts';
import { PARTITION_PROJECT_WGSL } from './gpuPartitionProjectWgsl.ts';

/**
 * GPU partition module: three kernels on the same eight storage buffers.
 *
 * `projectRows` projects each resident row and histograms its depth; `chooseSplit` reads that
 * histogram and sets the frame's split rule; `classifyRows` bins each row into its half, counts
 * its indirect slot and packs the tested box. The CPU encodes only these three dispatches, whose
 * count depends only on the row count, and reads nothing back.
 *
 * Exactly eight storage buffers, a stage's cap: rest bits and per-slot counts are those of the
 * draw compact, written here rather than uploaded, and `flags` is the verdict buffer:
 * `projectRows` reads last frame's, then `classifyRows` writes this frame's — `0` for the occluder
 * half, `2` for the tested half, which the Hi-Z test will set to `1` on rows it rejects. It is
 * through this word, not an extra buffer, that the compute raster learns which half a row is in.
 */
export const PARTITION_SHADER = `struct DrawItem{pageIndex:u32,bin:u32,selectionIndex:u32,layer:u32,triangles:u32,}
${PARTITION_UNI_WGSL}@group(0) @binding(0) var<storage, read> corners:array<f32>;
@group(0) @binding(1) var<storage, read> items:array<DrawItem>;
@group(0) @binding(2) var<storage, read_write> flags:array<u32>;
@group(0) @binding(3) var<storage, read_write> rowData:array<u32>;
@group(0) @binding(4) var<storage, read_write> tested:array<u32>;
@group(0) @binding(5) var<storage, read_write> restBits:array<atomic<u32>>;
@group(0) @binding(6) var<storage, read_write> slotUsed:array<atomic<u32>>;
@group(0) @binding(7) var<storage, read_write> state:array<atomic<u32>>;
@group(0) @binding(8) var<uniform> uni:Uni;
${BOX_PROJECT_WGSL}
${HIZ_LEVEL_WGSL}
${PARTITION_PROJECT_WGSL}
${PARTITION_CLASSIFY_WGSL}
`;
