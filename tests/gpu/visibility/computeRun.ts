// One compute shader run on Dawn, its storage output read back: the shape of every proof that runs
// an engine WGSL function on known inputs (`shading-point.gpu.ts`, `../shadow/blend-transmittance.gpu.ts`).
import { computeReadback } from '../kit/computeReadback.ts';
import { runOnDawn } from '../kit/onDawn.ts';
import { openGpuModule } from '../kit/webgpuDevice.ts';

type Run = { code: string; bytes: number; workgroups: number };

async function run({ code, bytes, workgroups }: Run) {
  const opened = await openGpuModule(code);
  if (!opened.module)
    return {
      values: [],
      errors: 'compilation' in opened ? opened.compilation : [opened.unavailable],
    };
  const { gpu, module } = opened;
  const pipeline = await gpu.device.createComputePipelineAsync({
    layout: 'auto',
    compute: { module, entryPoint: 'main' },
  });
  const values = await computeReadback(gpu.device, pipeline, bytes, workgroups);
  await gpu.fermer();
  return { values, errors: gpu.errors };
}

/** `code`'s `main` dispatched over `workgroups` groups, its storage output at binding 0 read back
 *  as `bytes / 4` floats; the compilation and uncaptured errors, which must be none. */
export const computeOnDawn = (code: string, bytes: number, workgroups = 1) =>
  runOnDawn(run, { code, bytes, workgroups });
