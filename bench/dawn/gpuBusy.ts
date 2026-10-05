// How busy the GPU is with other programs, read before a bench measures: the GPU is shared, and a
// window server, a terminal or a page drawing elsewhere takes time the bench would count as its own.
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { stats } from '../core/chrono.ts';

/** The share of the GPU the macOS accelerator says it is busy, 0–100, or `null` where none says. */
function gpuUtilization(): number | null {
  try {
    const text = execFileSync('ioreg', ['-r', '-d', '1', '-w', '0', '-c', 'IOAccelerator'], {
      encoding: 'utf8',
    });
    const found = /"Device Utilization %"=(\d+)/.exec(text);
    return found ? Number(found[1]) : null;
  } catch {
    return null;
  }
}

/** Above this median share the GPU is called busy: the run is marked disturbed in its report. */
const BUSY_PERCENT = 30;

/** The GPU's share taken by others over `samples` readings `everyMs` apart: median and highest,
 *  `null` where the machine does not say. */
export async function gpuBusy(samples = 8, everyMs = 250) {
  const read: number[] = [];
  for (let i = 0; i < samples; i++) {
    const value = gpuUtilization();
    if (value !== null) read.push(value);
    if (i < samples - 1) await sleep(everyMs);
  }
  if (!read.length) return null;
  const { medianeMs: median } = stats(read);
  return { median, max: Math.max(...read), busy: median > BUSY_PERCENT };
}
