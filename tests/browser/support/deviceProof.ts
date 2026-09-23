// What the device proofs share: open the WebGPU device, run the proof's sequences, close it,
// and report the adapter, the events and the errors beside what the sequences returned.
import { ouvrirAppareil } from '../probes/webgpuDevice.ts';

/** Result common to every device proof: the adapter reading or `indisponible`/`erreur` on
 *  failure, the events and errors collected, plus whatever `corps` filled into `resultat`. */
interface ResultatAppareil {
  indisponible?: string;
  erreur?: string;
  adaptateur?: string;
  evenements?: unknown[];
  erreurs?: string[];
  passes?: Record<string, unknown>;
  sans?: unknown;
  avec?: unknown;
  temoin?: unknown;
}

/**
 * Common envelope of a device proof: opens the device, runs `corps(device, evenements, resultat)`
 * — which fills `resultat` as it goes, so what ran before a failure is still reported —,
 * closes the device. This function only carries what every device proof repeats identically;
 * `R` names the fields a proof adds to the common result.
 */
export async function executerAppareil<R extends object = object>(
  corps: (
    device: GPUDevice,
    evenements: unknown[],
    resultat: Partial<R> & ResultatAppareil,
  ) => Promise<void>,
): Promise<Partial<R> & ResultatAppareil> {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' } as Partial<R> & ResultatAppareil;
  const { device, erreurs } = appareil;
  const evenements: unknown[] = [],
    resultat = {} as Partial<R> & ResultatAppareil;
  try {
    await corps(device, evenements, resultat);
  } catch (error) {
    const trace = error instanceof Error ? (error.stack ?? '') : '';
    return { erreur: String(error) + trace, ...resultat, evenements, erreurs };
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, ...resultat, evenements, erreurs };
}

/** A two-pass proof (paged, unpaged): `sequence(device, pagine, evenements)` for each. */
export function executerPasses(
  sequence: (device: GPUDevice, pagine: boolean, evenements: unknown[]) => Promise<unknown>,
): Promise<ResultatAppareil> {
  return executerAppareil(async (device, evenements, resultat) => {
    const passes: Record<string, unknown> = (resultat.passes = {});
    for (const pagine of [false, true])
      passes[pagine ? 'pagine' : 'non-pagine'] = await sequence(device, pagine, evenements);
  });
}

/** A proof with and without temporal accumulation: `sequence(device, evenements, temporel)`
 *  without, with, then with again — the A/A witness. */
export function executerAccumulation(
  sequence: (device: GPUDevice, evenements: unknown[], temporel: boolean) => Promise<unknown>,
): Promise<ResultatAppareil> {
  return executerAppareil(async (device, evenements, resultat) => {
    resultat.sans = await sequence(device, evenements, false);
    resultat.avec = await sequence(device, evenements, true);
    resultat.temoin = await sequence(device, evenements, true);
  });
}
