import { dagGroupEntries } from './bindings.ts'

/** The names of the selection kernel's group 0. */
const NAMES = [
  'clusters',
  'nodes',
  'views',
  'flags',
  'out',
  'work',
  'worlds',
  'frames',
  'cold',
  'tree',
] as const

/** The binding of each table of the selection kernel's group 0, read off the entries the
 *  production group lays (`dagGroupEntries`): a stand-in per name that carries it, buffer or
 *  view, so each entry says which table it holds. */
export function dagBindingOf(): Record<(typeof NAMES)[number], number> {
  const standIns = Object.fromEntries(NAMES.map((name) => [name, name]))
  const entries = dagGroupEntries(standIns as unknown as Parameters<typeof dagGroupEntries>[0])
  return Object.fromEntries(
    entries.map(({ binding, resource }) => {
      const r = resource as unknown as string | { buffer: string }
      return [typeof r === 'string' ? r : r.buffer, binding]
    }),
  ) as Record<(typeof NAMES)[number], number>
}
