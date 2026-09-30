import { DRAW_INDIRECT_WORDS } from '../../gpu/draw/contract.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';

/**
 * Once the rows are written: each face's casters as rows, one after the other in one buffer,
 * and one indirect command per face that says how many — what the region cull reads. A blended
 * cluster the face keeps is listed at its caster row.
 *
 * The casters arrive as the packed ranks `selectCpuCasters` published (`./cpuCasters.ts`): the
 * ranks index the rows directly, no record is read back here.
 */
export function writeCpuCasters(rt: WebgpuPagesRuntime, device: GPUDevice) {
  const { lights, run, layout } = rt,
    { rows } = layout,
    lists = lights.cpuCasters;
  if (!lists || lights.plannedFrame !== run.frame || !lists.runs) return;
  const { marks, rowOf, shownPacked, commands } = lists;
  // A second stamp, after the selection's: this frame's rows, by catalogue page.
  const stamp = ~run.frame >>> 0 || 1;
  for (let row = 0; row < rows.packedCount; row++) {
    const page = rows.packedPageIndex[row];
    rowOf[page] = row;
    marks[page] = stamp;
  }
  let total = 0;
  for (let r = 0; r < lists.runs; r++) total += shownPacked[r].length;
  if (lists.words.length < total) {
    lists.words = new Uint32Array(1 << Math.ceil(Math.log2(total)));
    lists.source.destroy();
    lists.source = device.createBuffer({
      label: 'Trillion3D CPU light casters',
      size: lists.words.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
  }
  const { words } = lists;
  let at = 0;
  for (let r = 0; r < lists.runs; r++) {
    lists.bases[r] = at;
    for (const page of shownPacked[r]) {
      // A blended cluster casts from its own row, behind the table (`../row/blendCasters.ts`).
      if (marks[page] === stamp) words[at++] = rowOf[page];
      else if (rows.blendRowOf[page] >= 0) words[at++] = rows.blendRowOf[page];
    }
    lists.lengths[r] = at - lists.bases[r];
    commands[r * DRAW_INDIRECT_WORDS + 1] = lists.lengths[r];
  }
  if (at) device.queue.writeBuffer(lists.source, 0, words, 0, at);
  device.queue.writeBuffer(lists.indirect, 0, commands, 0, lists.runs * DRAW_INDIRECT_WORDS);
  lists.frame = run.frame;
}
