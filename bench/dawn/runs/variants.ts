// Option variants played in one process (`BENCH_VARIANTS`): one load of the page, then each variant's
// options written into the live world through its public accessors (`world.reflections = { … }`, as a
// scenario segment's `world` does), settled, and the scenario's segments played and measured under it.

/** One variant: its name and the options it sets, by family (the world's accessor) and option. */
export type Variant = { name: string; world: Record<string, Record<string, unknown>> }

/** The frames a variant settles, unmeasured, before its segments (`BENCH_VARIANT_SETTLE`). */
export const VARIANT_SETTLE = Number(process.env.BENCH_VARIANT_SETTLE ?? 60)

const fail = (text: string): never => {
  throw new Error(`BENCH_VARIANTS: ${text}`)
}

/** The variants `BENCH_VARIANTS` names (a JSON array), checked in form; none where it is unset. */
export function readVariants(text = process.env.BENCH_VARIANTS): Variant[] | null {
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    return fail(`not JSON: ${(cause as Error).message}`)
  }
  if (!Array.isArray(parsed) || !parsed.length) return fail('expected a JSON array of variants')
  const names = new Set<string>()
  for (const variant of parsed as Partial<Variant>[]) {
    const { name, world } = variant
    if (typeof name !== 'string' || !name) fail('each variant needs a name')
    if (names.has(name!)) fail(`the name ${name} is given twice`)
    names.add(name!)
    if (!world || typeof world !== 'object' || Array.isArray(world))
      fail(`${name}: world must be an object of families`)
    for (const [family, options] of Object.entries(world!))
      if (!options || typeof options !== 'object' || Array.isArray(options))
        fail(`${name}: ${family} must be an object of options`)
  }
  return parsed as Variant[]
}

/** Whether `name` is an accessor of the world with a setter, on the world or up its prototype chain (not `Object.prototype`'s). */
function hasSetter(world: object, name: string) {
  for (let at: object | null = world; at && at !== Object.prototype; at = Object.getPrototypeOf(at))
    if (Object.hasOwn(at, name)) return Boolean(Object.getOwnPropertyDescriptor(at, name)?.set)
  return false
}

/** Whether a value read back is the one written. A level or a distance rule also takes a switch (`true`/`false`), which reads back as its level or metres. */
const sameValue = (read: unknown, written: unknown) =>
  read === written || (typeof written === 'boolean' && typeof read !== 'boolean')

/** The family `name`'s values now, by option; a named failure where the world has no such family to write. */
function familyOf(world: object, variant: string, name: string) {
  const values = (world as Record<string, unknown>)[name]
  if (!hasSetter(world, name) || !values || typeof values !== 'object')
    fail(`${variant}: the world has no setting family ${name} to write at run time`)
  return values as Record<string, unknown>
}

/** The values before any variant of every option the variants name, by family and option; fails on a family or option the world does not have. */
export function baselineOf(world: object, variants: readonly Variant[]) {
  const before: Record<string, Record<string, unknown>> = {}
  for (const variant of variants)
    for (const [family, options] of Object.entries(variant.world)) {
      const values = familyOf(world, variant.name, family)
      for (const option of Object.keys(options)) {
        if (!(option in values))
          fail(`${variant.name}: the family ${family} has no option ${option}`)
        ;(before[family] ??= {})[option] = values[option]
      }
    }
  return before
}

/** Writes `options` into the family `name` through the world's accessor, and reads each back. A refusal or a value not taken is a named failure. */
function write(world: object, variant: string, name: string, options: Record<string, unknown>) {
  try {
    ;(world as Record<string, unknown>)[name] = options
  } catch (cause) {
    fail(`${variant}: ${name} refused ${JSON.stringify(options)}: ${(cause as Error).message}`)
  }
  const values = familyOf(world, variant, name)
  for (const [option, value] of Object.entries(options))
    if (!sameValue(values[option], value))
      fail(
        `${variant}: ${name}.${option} reads back ${JSON.stringify(values[option])} after ${JSON.stringify(value)} was written (not taken at run time)`,
      )
}

/** Puts the world in the state of `variant` (`null`: before any variant): first the options the previous variant changed go back to their baseline, then the variant's own are written and read back. */
export function applyVariant(
  world: object,
  before: Record<string, Record<string, unknown>>,
  previous: Variant | null,
  variant: Variant | null,
) {
  for (const [family, options] of Object.entries(previous?.world ?? {}))
    write(
      world,
      `${previous!.name} (restore)`,
      family,
      Object.fromEntries(Object.keys(options).map((option) => [option, before[family][option]])),
    )
  for (const [family, options] of Object.entries(variant?.world ?? {}))
    write(world, variant!.name, family, options)
}
