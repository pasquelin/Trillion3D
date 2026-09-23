// Discrepancy tallies shared by the addressing probes (defect 4, 7, 8): split out of
// `addressingCases.ts` to keep the case model and the reporting under the 200-line gate.
import type { AdressageCas } from './addressingCases.ts';

/** One tallied row of a `bilan`: how many cases, how many discrepancies, one readable example. */
interface BilanLigne {
  cas: number;
  ecarts: number;
  exemple: string | null;
}

/**
 * Discrepancy tally of a comparison, component by component: the exercised axis by mode and
 * by boundary, the axis fixed at 1.3 by mode. `ecart(c, k)` returns `null` or a readable example.
 */
export function bilan(
  nom: string,
  liste: AdressageCas[],
  ecart: (c: AdressageCas, k: number) => string | null,
) {
  const lignes: Record<string, BilanLigne> = {};
  const compte = (cle: string, e: string | null) => {
    lignes[cle] ??= { cas: 0, ecarts: 0, exemple: null };
    lignes[cle].cas++;
    if (!e) return;
    lignes[cle].ecarts++;
    lignes[cle].exemple ??= e;
  };
  for (const c of liste) {
    const k = c.axe === 'u' ? 0 : 1;
    const marques = `${c.frontiere ? ' (boundary)' : ''}${c.couture ? ' (seam)' : ''}`;
    compte(`${c.eprouve}${marques}`, ecart(c, k));
    compte(`${k ? c.nomS : c.nomT} (fixed axis)`, ecart(c, 1 - k));
  }
  console.log(`\n${nom}`);
  for (const [cle, l] of Object.entries(lignes).sort())
    console.log(
      `  ${cle.padEnd(38)} ${String(l.ecarts).padStart(4)} discrepancies / ${l.cas}${l.exemple ? `  e.g. ${l.exemple}` : ''}`,
    );
  return lignes;
}

/** Discrepancies of a bilan's rows that `retenue(cle)` counts as blocking. */
export const somme = (
  lignes: Record<string, BilanLigne>,
  retenue: (cle: string) => boolean = () => true,
) => Object.entries(lignes).reduce((n, [cle, l]) => n + (retenue(cle) ? l.ecarts : 0), 0);
