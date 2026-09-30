import { DRAW_INDIRECT_WORDS, DRAW_INDIRECT_STRIDE } from '../../gpu/draw/contract.ts';
import { createEngineCamera } from '../../camera/world.ts';
import { type PageRec } from '../../page/selection/selection.ts';
import { createSelectionResult } from '../../page/cut/state.ts';
import { MAX_SHADOW_RUNS } from '../../gpu/shadow/batchBudget.ts';

/** Usage of the lists' buffers, read when one is made: the GPU globals exist only then. */
const storage = () => GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST;

export function createCpuCasterLists(device: GPUDevice, pageCount: number) {
  return {
    frame: -1,
    /** Faces of every batch of the frame, together. */
    runs: 0,
    source: device.createBuffer({
      label: 'Trillion3D CPU light casters',
      size: 4,
      usage: storage(),
    }),
    indirect: device.createBuffer({
      size: MAX_SHADOW_RUNS * DRAW_INDIRECT_STRIDE,
      usage: storage(),
    }),
    bases: new Uint32Array(MAX_SHADOW_RUNS),
    lengths: new Uint32Array(MAX_SHADOW_RUNS),
    commands: new Uint32Array(MAX_SHADOW_RUNS * DRAW_INDIRECT_WORDS),
    words: new Uint32Array(1),
    /** The cut's record scratch per face, and the packed ranks it publishes beside them. */
    shown: [] as PageRec[][],
    wanted: [] as PageRec[][],
    shownPacked: [] as number[][],
    wantedPacked: [] as number[][],
    casters: [] as PageRec[],
    /** The packed rank of each caster, rank by rank (#1235): one record serves many placements. */
    castersPacked: [] as number[],
    /** Per catalogue page: the frame that last marked it, and its row that frame. */
    marks: new Uint32Array(pageCount),
    rowOf: new Int32Array(pageCount),
    result: createSelectionResult<PageRec>(),
    camera: createEngineCamera(),
    viewport: [1, 1] as [number, number],
  };
}
