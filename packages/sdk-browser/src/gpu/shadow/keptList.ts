import { MAX_SHADOW_REGIONS } from './recordPack.ts';
import { pendingBuffers } from '../core/tableGrowth.ts';

/** Bytes of one row of every region of a kept list. */
export const KEPT_ROW_BYTES = MAX_SHADOW_REGIONS * 4;

/** The casters every region keeps, `capacity` rows each, in one list (`cull.ts`). */
export const keptList = (
  device: GPUDevice,
  capacity: number,
  label = 'Trillion3D shadow kept clusters v1',
) =>
  device.createBuffer({
    label,
    size: Math.max(4, capacity * KEPT_ROW_BYTES),
    usage: GPUBufferUsage.STORAGE,
  });

/** Each region's place in the shared list — and the end of the last, where its cutout list
 *  starts down (#965) —, `capacity` rows apart. */
export function writeRegionOffsets(device: GPUDevice, offsets: GPUBuffer, capacity: number) {
  const words = new Uint32Array(MAX_SHADOW_REGIONS + 1);
  for (let region = 0; region <= MAX_SHADOW_REGIONS; region++) words[region] = region * capacity;
  device.queue.writeBuffer(offsets, 0, words);
}

/**
 * The lists of `targets` grown to `rows` rows a region, the table's caster rows: made now and put
 * in place by `commit` (`../core/tableGrowth.ts`), the regions' offsets following; `rebound`
 * then hears that the list changed identity.
 */
export function growKeptList(
  device: GPUDevice,
  targets: { kept: GPUBuffer; capacity: number },
  offsets: GPUBuffer,
  rows: number,
  rebound: () => void,
) {
  const next = keptList(device, rows);
  return pendingBuffers([next], () => {
    const old = targets.kept;
    targets.kept = next;
    targets.capacity = rows;
    writeRegionOffsets(device, offsets, rows);
    rebound();
    return [old];
  });
}
