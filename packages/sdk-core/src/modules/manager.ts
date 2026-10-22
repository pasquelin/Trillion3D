import { EngineError } from '../contracts/cache.ts'
import { STRONGEST_FIRST, type RenderSettingSource } from '../runtime/renderSettings.ts'
import {
  mergeModuleParts,
  resolveModuleOption,
  type ModuleDecision,
  type ModuleDescriptor,
  type ModuleOption,
  type ModuleReason,
  type ModuleState,
} from './descriptor.ts'

/** What the manager calls on one module. Nothing of a disabled module runs. */
export interface ModuleHooks<Context, Instance> {
  /** Starts the module, when it becomes enabled, with its merged parts; returns what runs. */
  start(context: Context, parts: ModuleState['parts']): Instance
  /** Stops what `start` returned, when the module becomes disabled or the manager is disposed. */
  stop(instance: Instance): void
  /** Called on a running module whose merged parts changed at an `apply`. */
  update?(instance: Instance, parts: ModuleState['parts']): void
}

/** The modules of one engine: their layered options, and what runs. */
export interface ModuleManager<Name extends string, Context> {
  /** Writes what `source` says of module `name`; refused when `value` is not a module option. */
  set(source: RenderSettingSource, name: Name, value: ModuleOption): void
  /** Takes back what `source` said of module `name`. */
  clear(source: RenderSettingSource, name: Name): void
  /** Whether module `name` is to run, why — the source or default that decided, or the module that
   *  needs it —, and its merged parts. */
  state(name: Name): ModuleState
  /** Stops the modules that turned off, in stop order, then starts the newly enabled ones in start
   *  order and updates the running ones whose parts changed. */
  apply(context: Context): void
  /** Stops every running module, in stop order. */
  dispose(): void
}

/** Each source's decision by module name. */
type Layers<Name extends string> = Record<RenderSettingSource, Map<Name, ModuleDecision>>

/** The refusal of a module that is not registered, `chain` the requirements that led to it. */
const missing = (chain: readonly string[]) =>
  new EngineError(
    'MODULE_MISSING',
    `Module ${chain.at(-1)} is not registered: ${chain.join(' → ')}`,
    {
      chain,
    },
  )

/** The strongest source holding a decision of module `name`, if any. */
const decidingSource = <Name extends string>(layers: Layers<Name>, name: Name) =>
  STRONGEST_FIRST.find((source) => layers[source].has(name))

/** Every enabled module of `descriptors` with its reason: those its strongest source — or, with
 *  none, its default — switches on, then, breadth-first, every module one of them requires. */
function enabledModules<Name extends string>(
  descriptors: readonly ModuleDescriptor<Name>[],
  byName: ReadonlyMap<string, ModuleDescriptor<Name>>,
  layers: Layers<Name>,
) {
  const enabled = new Map<Name, ModuleReason>()
  const queue: { name: Name; chain: string[] }[] = []
  for (const { name, enabledByDefault } of descriptors) {
    const source = decidingSource(layers, name)
    if (!(source ? layers[source].get(name) !== false : enabledByDefault)) continue
    enabled.set(name, source ?? 'default')
    queue.push({ name, chain: [name] })
  }
  for (const { name, chain } of queue)
    for (const required of byName.get(name)!.requires) {
      const path = [...chain, required]
      if (!byName.has(required)) throw missing(path)
      if (enabled.has(required as Name)) continue
      enabled.set(required as Name, { requiredBy: name })
      queue.push({ name: required as Name, chain: path })
    }
  return enabled
}

/** The enabled modules, each after those it requires, otherwise in registration order. */
function startOrder<Name extends string>(
  descriptors: readonly ModuleDescriptor<Name>[],
  byName: ReadonlyMap<string, ModuleDescriptor<Name>>,
  enabled: ReadonlyMap<Name, ModuleReason>,
) {
  const order: Name[] = [],
    seen = new Set<string>()
  const visit = (name: Name) => {
    if (seen.has(name)) return
    seen.add(name)
    for (const required of byName.get(name)!.requires) visit(required as Name)
    order.push(name)
  }
  for (const { name } of descriptors) if (enabled.has(name)) visit(name)
  return order
}

/** `parts` as one string, its fields' keys sorted: two mergings of the same values read alike
 *  whatever order the sources gave their fields in. */
const partsKey = (parts: ModuleState['parts']) =>
  JSON.stringify(parts, (_, value: unknown) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : value,
  )

/**
 * The manager of `descriptors`, started and stopped through `hooks` by module name. A module's value
 * is the one the strongest source holding it gives (`STRONGEST_FIRST`), its descriptor's default
 * when none does; every module an enabled one requires is enabled too, transitively, even one a
 * source switched off. A module starts after those it requires, otherwise in registration order;
 * stops are the exact reverse of the starts. This is the manager, at the root of `modules/`; each
 * module lives in its own folder under `modules/`.
 */
export function createModuleManager<Name extends string, Context, Instance>(
  descriptors: readonly ModuleDescriptor<Name>[],
  hooks: Readonly<Record<Name, ModuleHooks<Context, Instance>>>,
): ModuleManager<Name, Context> {
  const byName = new Map<string, ModuleDescriptor<Name>>(descriptors.map((d) => [d.name, d]))
  const layers = Object.fromEntries(
    STRONGEST_FIRST.map((source) => [source, new Map<Name, ModuleDecision>()]),
  ) as Layers<Name>
  // In start order: a Map keeps its insertion order.
  const running = new Map<Name, { instance: Instance; parts: string }>()
  const descriptorOf = (name: Name) => byName.get(name) ?? (missing([name]) as never)
  const partsOf = (name: Name) =>
    mergeModuleParts(
      descriptorOf(name),
      STRONGEST_FIRST.flatMap((source) => layers[source].get(name) || []),
    )
  const stopAll = (names: readonly Name[]) => {
    for (const name of [...names].reverse()) {
      const entry = running.get(name)!
      running.delete(name)
      hooks[name].stop(entry.instance)
    }
  }
  const manager: ModuleManager<Name, Context> = {
    set(source, name, value) {
      const decision = resolveModuleOption(descriptorOf(name), value)
      if (decision === undefined) layers[source].delete(name)
      else layers[source].set(name, decision)
    },
    clear: (source, name) => manager.set(source, name, null),
    state(name) {
      descriptorOf(name)
      const by = enabledModules(descriptors, byName, layers).get(name)
      const decided = decidingSource(layers, name) ?? 'default'
      return { enabled: by !== undefined, by: by ?? decided, parts: partsOf(name) }
    },
    apply(context) {
      const enabled = enabledModules(descriptors, byName, layers)
      stopAll([...running.keys()].filter((name) => !enabled.has(name)))
      for (const name of startOrder(descriptors, byName, enabled)) {
        const parts = partsOf(name),
          key = partsKey(parts),
          entry = running.get(name)
        if (!entry) running.set(name, { instance: hooks[name].start(context, parts), parts: key })
        else if (entry.parts !== key) {
          hooks[name].update?.(entry.instance, parts)
          entry.parts = key
        }
      }
    },
    dispose: () => stopAll([...running.keys()]),
  }
  return manager
}
