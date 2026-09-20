// What the device proofs share: open the WebGPU device, run the proof's sequences, close it,
// and report the adapter, the events and the errors beside what the sequences returned.
import { ouvrirAppareil } from '../justesse/appareilWebgpu.mjs';

/**
 * Common envelope of a device proof: opens the device, runs `corps(device, evenements, resultat)`
 * — which fills `resultat` as it goes, so what ran before a failure is still reported —,
 * closes the device. This function only carries what every device proof repeats identically.
 */
async function executerAppareil(corps) {
  const appareil = await ouvrirAppareil();
  if (!appareil) return { indisponible: 'no WebGPU adapter' };
  const { device, erreurs } = appareil;
  const evenements = [],
    resultat = {};
  try {
    await corps(device, evenements, resultat);
  } catch (error) {
    return { erreur: String(error) + (error?.stack ?? ''), ...resultat, evenements, erreurs };
  }
  const info = await appareil.fermer();
  return { adaptateur: info.court, ...resultat, evenements, erreurs };
}

/** A two-pass proof (paged, unpaged): `sequence(device, pagine, evenements)` for each. */
export function executerPasses(sequence) {
  return executerAppareil(async (device, evenements, resultat) => {
    const passes = (resultat.passes = {});
    for (const pagine of [false, true])
      passes[pagine ? 'pagine' : 'non-pagine'] = await sequence(device, pagine, evenements);
  });
}

/** A proof with and without temporal accumulation: `sequence(device, evenements, temporel)`
 *  without, with, then with again — the A/A witness. */
export function executerAccumulation(sequence) {
  return executerAppareil(async (device, evenements, resultat) => {
    resultat.sans = await sequence(device, evenements, false);
    resultat.avec = await sequence(device, evenements, true);
    resultat.temoin = await sequence(device, evenements, true);
  });
}
