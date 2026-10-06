// What the device proofs share: open the WebGPU device, run the proof's sequences, close it,
// and report the adapter, the events and the errors beside what the sequences returned.
import { openGpuDevice } from './webgpuDevice.ts';

/** Result common to every device proof: the adapter reading or `indisponible` (unavailable) /
 *  `erreur` (error) on failure, the events and errors collected, plus whatever `body` filled in. */
interface DeviceResult {
  indisponible?: string;
  erreur?: string;
  adaptateur?: string;
  evenements?: unknown[];
  erreurs?: string[];
  passes?: Record<string, unknown>;
  sans?: unknown;
  avec?: unknown;
  witness?: unknown;
}

/**
 * Common envelope of a device proof: opens the device (`openGpuDevice`), runs
 * `body(device, events, result)` — which fills `result` as it goes, so what ran before a failure is
 * still reported —, closes the device. This function only carries what every device proof repeats
 * identically; `R` names the fields a proof adds to the common result.
 */
export async function runOnDevice<R extends object = object>(
  body: (
    device: GPUDevice,
    events: unknown[],
    result: Partial<R> & DeviceResult,
  ) => Promise<void>,
  requiredLimits?: Record<string, number>,
): Promise<Partial<R> & DeviceResult> {
  const gpu = await openGpuDevice([], requiredLimits);
  if (!gpu) return { indisponible: 'no WebGPU adapter' } as Partial<R> & DeviceResult;
  const { device, erreurs } = gpu;
  const evenements: unknown[] = [],
    result = {} as Partial<R> & DeviceResult;
  try {
    await body(device, evenements, result);
  } catch (error) {
    const trace = error instanceof Error ? (error.stack ?? '') : '';
    await gpu.fermer();
    return { erreur: String(error) + trace, ...result, evenements, erreurs };
  }
  const info = await gpu.fermer();
  return { adaptateur: info.court, ...result, evenements, erreurs };
}

/** A two-pass proof, unpaged then paged: `sequence(device, paged, events)` for each, reported
 *  under `passes['non-pagine']` and `passes.pagine`. */
export function runPasses(
  sequence: (device: GPUDevice, paged: boolean, events: unknown[]) => Promise<unknown>,
): Promise<DeviceResult> {
  return runOnDevice(async (device, events, result) => {
    const passes: Record<string, unknown> = (result.passes = {});
    for (const paged of [false, true])
      passes[paged ? 'pagine' : 'non-pagine'] = await sequence(device, paged, events);
  });
}

/** A proof without temporal accumulation (`sans`), with it (`avec`), then with it again — the A/A
 *  witness (`witness`): `sequence(device, events, temporal)` for each. */
export function runAccumulation(
  sequence: (device: GPUDevice, events: unknown[], temporal: boolean) => Promise<unknown>,
): Promise<DeviceResult> {
  return runOnDevice(async (device, events, result) => {
    result.sans = await sequence(device, events, false);
    result.avec = await sequence(device, events, true);
    result.witness = await sequence(device, events, true);
  });
}
