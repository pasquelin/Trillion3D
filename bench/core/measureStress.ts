// Stress cases, over `measure`.
import { measure } from './measure.ts'

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
