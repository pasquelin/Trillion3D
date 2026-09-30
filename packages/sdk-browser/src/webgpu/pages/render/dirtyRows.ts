import { PAGE_INFO_STRIDE } from '../../../visibility/buffer.ts';
import { forEachDirtyRun } from '../../row/dirty.ts';
import type { WebgpuPagesRuntime } from '../runtime.ts';

/** Uploads the rows whose bytes changed, run by run, and nothing when none did. */
export function uploadDirtyRows(rt: WebgpuPagesRuntime) {
  const { rows } = rt.layout;
  rt.timing.encodeCounts.rowsUploaded = 0;
  if (rows.dirtyTo < rows.dirtyFrom || !rt.vis.pageTable || !rows.pageTableFloats) return;
  forEachDirtyRun(rows.dirtyMarks, rows.dirtyFrom, rows.dirtyTo, rt, uploadRun);
  rows.clearDirty();
}

function uploadRun(rt: WebgpuPagesRuntime, from: number, to: number) {
  const floats = rt.layout.rows.pageTableFloats!;
  rt.gpu.device!.queue.writeBuffer(
    rt.vis.pageTable!,
    from * PAGE_INFO_STRIDE,
    floats.buffer as ArrayBuffer,
    floats.byteOffset + from * PAGE_INFO_STRIDE,
    (to - from + 1) * PAGE_INFO_STRIDE,
  );
  rt.timing.encodeCounts.rowsUploaded += to - from + 1;
}
