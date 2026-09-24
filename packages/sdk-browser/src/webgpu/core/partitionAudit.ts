import { FLAG_CLIP, ROW_DATA_U32, ROW_FLAGS, ROW_NEAREST } from '../../gpu/partition/contract.ts';
import { visLayerTop } from '../visibility/uniforms.ts';

/** Doubles of a world box: eight corners of three coordinates, as `createBoxCorners` holds them.
 *  That is the REFERENCE layout, not that of the two-word buffer the kernel reads. */
const BOX_CORNER_VALUES = 24;
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/**
 * What an image sent to the GPU partition, and what the partition wrote of it, row by row.
 *
 * This is the conservativeness proof tool: the screen rectangle and depth bound the GPU computed in
 * single precision, beside the world corners in double precision and the matrices they come from. A
 * caller can therefore redo the reference calculation on the SAME inputs and check, cluster by
 * cluster, that the GPU rectangle contains the reference's, that a box cut by the near plane does
 * carry its flag, and that the GPU depth underestimates the reference's.
 *
 * This is not a pass of the image: none of this exists until the host asks for it, and the read only
 * makes sense after a rendered image.
 */
export interface PartitionAudit {
  /** Rows checked. */
  rows: number;
  /** Width in pixels. */
  width: number;
  /** Height in pixels. */
  height: number;
  /** Nearest distance. */
  near: number;
  /** View and view-projection elements in double precision, as the image posted them. */
  view: Float64Array;
  /** The camera's view-projection. */
  viewProj: Float64Array;
  /** World corners in double precision, eight per row: the exact input of both calculations. */
  corners: Float64Array;
  /** Coplanar layer of each row, as the draw row carries it. */
  layers: Uint32Array;
  /** Unclipped screen rectangle the GPU wrote, four integers per row. */
  rect: Int32Array;
  /** Depth bound the GPU wrote, layer bias included. */
  nearest: Float32Array;
  /** 1 when the row carries the cut flag, therefore can never be rejected. */
  clips: Uint8Array;
}

/**
 * Reads the rectangles and depths the GPU partition wrote for the last image, with the inputs it
 * drew them from. `null` when no partition runs or no image has encoded it yet.
 */
export async function readPartitionAudit(rt: WebgpuPagesRuntime): Promise<PartitionAudit | null> {
  const partition = rt.vis.gpuPartition,
    device = rt.gpu.device,
    frame = partition?.lastFrame;
  if (!partition || !device || !frame) return null;
  const { rows } = frame;
  if (rows < 1) return null;
  const words = await partition.readRowData(rows);
  if (!words) return null;
  const rect = new Int32Array(rows * 4),
    nearest = new Float32Array(rows),
    clips = new Uint8Array(rows),
    layers = new Uint32Array(rows),
    corners = new Float64Array(rows * BOX_CORNER_VALUES);
  const ints = new Int32Array(words.buffer, words.byteOffset, words.length),
    floats = new Float32Array(words.buffer, words.byteOffset, words.length);
  const { boxCorners, rows: table } = rt.layout;
  for (let row = 0; row < rows; row++) {
    const base = row * ROW_DATA_U32;
    for (let k = 0; k < 4; k++) rect[row * 4 + k] = ints[base + k];
    nearest[row] = floats[base + ROW_NEAREST];
    clips[row] = words[base + ROW_FLAGS] & FLAG_CLIP ? 1 : 0;
    const rec = table.packedRecs[row];
    layers[row] = rec ? Math.min(rec.depthLayer, visLayerTop(rt.vis)) : 0;
    if (!rec) continue;
    // The corners the GPU read are these, rounded to single precision for transport: the reference
    // therefore starts from the same doubles, and the rounding enters the kernel's error bound.
    const at = boxCorners.at(table.packedPageIndex[row], rec, table.tableEpoch);
    for (let k = 0; k < BOX_CORNER_VALUES; k++)
      corners[row * BOX_CORNER_VALUES + k] = boxCorners.corners[at + k];
  }
  return {
    rows,
    width: frame.width,
    height: frame.height,
    near: frame.near,
    view: frame.view,
    viewProj: frame.viewProj,
    corners,
    layers,
    rect,
    nearest,
    clips,
  };
}
