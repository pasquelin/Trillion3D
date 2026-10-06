import { candidates, importFacts, type ImportFacts } from './import-facts.ts'
import { isUnitTest } from './unit-tests.ts'

// The unit tests a change can affect, as the "affected" selection of Bazel, Nx or Turborepo: the
// tests of the changed file's own domain folder, and those that reach it by a chain of value
// imports. Type-only imports run no code and are not followed. A named import through a barrel
// also reaches the file that defines the name, so a chain never has to run through the barrel
// itself; nor does it run through an aggregator that composes a whole subsystem, unless that
// aggregator imports the changed file itself. A file's direct importers are always selected.

/** Modules a file imports from which it is an aggregator: it composes a whole subsystem (the
 *  renderer, the world), so a test that drives it tests that subsystem, not each of its parts. */
export const AGGREGATOR_IMPORTS = 15

const barrel =
  /(?:^|\/)index\.ts$|^packages\/sdk\/[^/]+\.m?ts$|^packages\/sdk\/(?:browser|common)\//

/** How far a change travels through a file: `barrel` (an `index.ts` or the public facade that only
 *  re-exports) stops it, `aggregator` passes it only from a changed file it imports itself,
 *  `module` always passes it. */
type Role = 'barrel' | 'aggregator' | 'module'

/** One source file of the graph: the files it reads values from, and its role. */
interface GraphNode {
  dependencies: Set<string>
  role: Role
}

/** The folder of `file` whose tests always run when it changes: two levels under a package's `src/`
 *  (`packages/sdk-browser/src/webgpu/shadow/`), none for a file at a source root or elsewhere. */
export function domainOf(file: string): string | undefined {
  return /^packages\/[^/]+\/src\/[^/]+\/(?:[^/]+\/)?/.exec(file)?.[0]
}

type Facts = Map<string, ImportFacts>

function resolver(facts: Facts, known: (file: string) => boolean) {
  const targets = (importer: string, specifier: string): string[] =>
    candidates(importer, specifier).filter(known)
  // The files that define `name` as `file` exports it; null when `file` does not export it.
  const definers = (file: string, name: string, seen: Set<string>): string[] | null => {
    const module = facts.get(file)
    if (!module || module.locals.has(name)) return [file]
    const key = `${file}#${name}`
    if (seen.has(key)) return null
    seen.add(key)
    const reExport = module.reExports.find(({ alias }) => alias === name)
    if (reExport)
      return targets(file, reExport.specifier).flatMap((target) =>
        reExport.name === '*'
          ? whole(target, seen)
          : (definers(target, reExport.name, seen) ?? [target]),
      )
    const found = module.stars.flatMap((specifier) =>
      targets(file, specifier).flatMap((target) => definers(target, name, seen) ?? []),
    )
    return found.length ? found : null
  }
  // A whole module: the file and everything it re-exports.
  const whole = (file: string, seen: Set<string>): string[] => {
    const module = facts.get(file)
    if (!module || seen.has(file)) return [file]
    seen.add(file)
    const specifiers = [...module.stars, ...module.reExports.map(({ specifier }) => specifier)]
    return [
      file,
      ...specifiers.flatMap((specifier) =>
        targets(file, specifier).flatMap((target) => whole(target, seen)),
      ),
    ]
  }
  return (importer: string): GraphNode => {
    const imports = facts.get(importer)!.imports.map(({ specifier, names }) => ({
      names,
      modules: targets(importer, specifier),
    }))
    const modules = new Set(imports.flatMap(({ modules }) => modules))
    // A barrel that imports values defines names of its own from them: a module, whose importers
    // a change of what it imports reaches.
    const role: Role =
      barrel.test(importer) && !imports.length
        ? 'barrel'
        : !isUnitTest(importer) && modules.size >= AGGREGATOR_IMPORTS
          ? 'aggregator'
          : 'module'
    const read = imports.flatMap(({ names, modules }) =>
      modules.flatMap((target) =>
        names === '*'
          ? whole(target, new Set())
          : names.flatMap((name) => definers(target, name, new Set()) ?? []),
      ),
    )
    return { dependencies: new Set([...modules, ...read]), role }
  }
}

/** Each source file's value dependencies: the modules it imports, and through them the files that
 *  define what it reads. */
function importGraph(files: Map<string, string>, changed: Set<string>): Map<string, GraphNode> {
  const facts: Facts = new Map([...files].map(([file, text]) => [file, importFacts(file, text)]))
  const node = resolver(facts, (path) => files.has(path) || changed.has(path))
  return new Map([...files.keys()].map((file) => [file, node(file)]))
}

/** The unit tests `changed` can affect, sorted. */
export function relatedTests(files: Map<string, string>, changed: Set<string>): string[] {
  return affectedTests(importGraph(files, changed), changed)
}

/** The unit tests of `graph` that `changed` can affect, sorted. */
function affectedTests(graph: Map<string, GraphNode>, changed: Set<string>): string[] {
  const importers = new Map<string, string[]>()
  for (const [file, { dependencies }] of graph)
    for (const dependency of dependencies) {
      const list = importers.get(dependency)
      if (list) list.push(file)
      else importers.set(dependency, [file])
    }
  const reached = new Set(changed)
  const queue = [...changed]
  for (const file of queue)
    for (const importer of importers.get(file) ?? []) {
      if (reached.has(importer)) continue
      reached.add(importer)
      const role = graph.get(importer)?.role
      if (role === 'barrel' || (role === 'aggregator' && !changed.has(file))) continue
      queue.push(importer)
    }
  const domains = [...changed].flatMap((file) => (isUnitTest(file) ? [] : (domainOf(file) ?? [])))
  return [...graph.keys()]
    .filter(
      (file) =>
        isUnitTest(file) &&
        (reached.has(file) || domains.some((domain) => file.startsWith(domain))),
    )
    .sort()
}
