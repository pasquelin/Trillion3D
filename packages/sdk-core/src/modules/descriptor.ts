import { EngineError } from '../contracts/cache.ts'
import { isRecord } from '../contracts/nameMatch.ts'
import { type RenderSettingSource } from '../runtime/renderSettings.ts'

/**
 * The engine's modules: whole features a scene, a quality preset, the page or the editor switch on
 * or off. A module is declared once by a descriptor; a disabled module costs nothing.
 */

/** The fields of one part, as a source sets them; the module's own part resolvers read them. */
export type ModulePartFields = Readonly<Record<string, unknown>>
/** A module's parts as a source names them: each switched (`true`, `false`) or set (its fields). */
export type ModuleParts = Readonly<Record<string, boolean | ModulePartFields>>
/** What a source says of one module: `true` on with every part at its default, `false` off, an
 *  object on with those parts switched or set, `undefined` or `null` no word. */
export type ModuleOption = boolean | null | undefined | ModuleParts

/** A module, declared once. */
export interface ModuleDescriptor<Name extends string = string> {
  /** Its unique name, in lower camel case. */
  readonly name: Name
  /** Whether it runs when no source holds a value for it. */
  readonly enabledByDefault: boolean
  /** The modules it needs: each one runs whenever this one does. */
  readonly requires: readonly string[]
  /** Its sub-features, each switched alone. */
  readonly parts: readonly string[]
}

/** What a source decided for a module: off, or on with the parts it switched or set. */
export type ModuleDecision = false | { readonly parts: ModuleParts }

/** Who made a module run: its default, a source, or the module that needs it. */
export type ModuleReason = 'default' | RenderSettingSource | { readonly requiredBy: string }

/** A module as it runs: whether it does, why, and each part off (`false`) or its merged fields. */
export interface ModuleState {
  readonly enabled: boolean
  readonly by: ModuleReason
  readonly parts: Readonly<Record<string, false | ModulePartFields>>
}

/** Freezes `descriptor` after checking that its part names are unique and that it does not require
 *  itself. */
export function defineModule<const D extends ModuleDescriptor>(descriptor: D): Readonly<D> {
  const { name, parts, requires } = descriptor
  if (new Set(parts).size !== parts.length)
    throw new TypeError(`Module ${name} declares a part name twice: ${parts.join(', ')}`)
  if (requires.includes(name)) throw new TypeError(`Module ${name} requires itself`)
  return Object.freeze({
    ...descriptor,
    requires: Object.freeze([...requires]),
    parts: Object.freeze([...parts]),
  })
}

/** The refusal of a module option, naming the module, what was wrong and the forms allowed. */
function refuse(module: string, what: string, value: unknown) {
  return new EngineError(
    'INVALID_MODULE_OPTION',
    `Module ${module}: ${what} ${JSON.stringify(value) ?? String(value)}; a module takes true, false, ` +
      `or an object of its parts, each true, false or an object of that part's fields`,
    { module, value },
  )
}

/**
 * The one reading of a module's option: `true` is on with every part at its default, `false` off,
 * `undefined` or `null` no word (`undefined` is returned), an object on with its parts switched or
 * set. Anything else is refused: an unknown part name, a non-object, a part value that is not
 * `true`, `false` or an object.
 */
export function resolveModuleOption(
  descriptor: ModuleDescriptor,
  value: ModuleOption,
): ModuleDecision | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'boolean') return value ? { parts: {} } : false
  if (!isRecord(value)) throw refuse(descriptor.name, 'unexpected option', value)
  for (const [part, setting] of Object.entries(value)) {
    if (!descriptor.parts.includes(part))
      throw refuse(descriptor.name, `unknown part "${part}" in`, value)
    if (typeof setting !== 'boolean' && !isRecord(setting))
      throw refuse(
        descriptor.name,
        `part "${part}" takes neither a boolean nor an object, got`,
        setting,
      )
  }
  return { parts: value }
}

/**
 * The parts of `descriptor` across the decisions of the sources that left it on, strongest first.
 * Per part and per field the strongest source that sets it wins; a part the strongest source to name
 * it switched off stays off, whatever a weaker one sets. The fields are not checked here: the
 * module's own part resolvers do.
 */
export function mergeModuleParts(
  descriptor: ModuleDescriptor,
  decisions: readonly { readonly parts: ModuleParts }[],
): Record<string, false | ModulePartFields> {
  const merged: Record<string, false | ModulePartFields> = {}
  for (const part of descriptor.parts) {
    let fields: Record<string, unknown> = {},
      named = false,
      off = false
    for (const { parts } of decisions) {
      if (!Object.hasOwn(parts, part)) continue
      const setting = parts[part]
      if (setting === false) off ||= !named
      else {
        named = true
        if (setting !== true) fields = { ...setting, ...fields }
      }
      if (off) break
    }
    merged[part] = off ? false : fields
  }
  return merged
}
