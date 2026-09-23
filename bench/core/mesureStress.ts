// Stress cases and the reference/optimised comparison, over `mesure`.
import { mesure } from './mesure.ts';
import type { MesureParams } from './mesureTypes.ts';

export interface CasExtreme<Entree = unknown> {
  name: string;
  input: Entree;
}

/** Checks that a calculation absorbs its extremes without throwing: no exception is the contract. */
export async function stress<Entree = unknown>({
  name,
  calcul,
  extremes,
}: {
  name: string;
  calcul: (input: Entree) => unknown;
  extremes: CasExtreme<Entree>[];
}): Promise<void> {
  for (const cas of extremes) {
    try {
      await calcul(cas.input);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`Stress ${name} / ${cas.name} : ${message}`, { cause: e });
    }
  }
}

/** Parameters of `compare`: `mesure` under different names for the reference/optimised split. */
export interface CompareParams<Entree = unknown, Sortie = unknown> extends Omit<
  MesureParams<Entree, Sortie>,
  'calcul' | 'attendu'
> {
  reference: (input: Entree) => Sortie | Promise<Sortie>;
  optimisee: (input: Entree) => Sortie | Promise<Sortie>;
}

/** Measures package code using the pre-optimisation implementation as the oracle. */
export const compare = <Entree = unknown, Sortie = unknown>({
  reference,
  optimisee,
  ...reste
}: CompareParams<Entree, Sortie>) => mesure({ ...reste, calcul: optimisee, attendu: reference });
