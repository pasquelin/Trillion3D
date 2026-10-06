// Stress cases and the reference/optimised comparison, over `measure`.
import { measure } from './measure.ts'
import type { MeasureParams } from './measure.ts'

export interface CasExtreme<Entree = unknown> {
  name: string
  input: Entree
}

/** Checks that a calculation absorbs its extremes without throwing: no exception is the contract. */
export async function stress<Entree = unknown>({
  name,
  calculation,
  extremes,
}: {
  name: string
  calculation: (input: Entree) => unknown
  extremes: CasExtreme<Entree>[]
}): Promise<void> {
  for (const cas of extremes) {
    try {
      await calculation(cas.input)
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      throw new Error(`Stress ${name} / ${cas.name} : ${message}`, { cause: e })
    }
  }
}

/** Parameters of `compare`: `measure` under different names for the reference/optimised split. */
export interface CompareParams<Entree = unknown, Sortie = unknown> extends Omit<
  MeasureParams<Entree, Sortie>,
  'calculation' | 'expected'
> {
  reference: (input: Entree) => Sortie | Promise<Sortie>
  optimised: (input: Entree) => Sortie | Promise<Sortie>
}

/** Measures package code using the pre-optimisation implementation as the oracle. */
export const compare = <Entree = unknown, Sortie = unknown>({
  reference,
  optimised,
  ...reste
}: CompareParams<Entree, Sortie>) =>
  measure({ ...reste, calculation: optimised, expected: reference })
