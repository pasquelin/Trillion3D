import type { MeasuredWorld } from '../explorer.ts'
import {
  resolveSetting,
  type SettingOptions,
} from '../../../../sdk-core/src/contracts/settingRules.ts'
import {
  setterOf,
  SETTING_FAMILIES,
  type FamilyRules as Rules,
  type FamilyTable,
} from '../../../../sdk-core/src/runtime/settingFamilies.ts'
import type { WorldSettings } from './settings.ts'

/** The values of the family of rules `R`, by field. */
type Values<R extends Rules> = { -readonly [F in keyof R]: R[F]['default'] }
/** A field of the family of rules `R`. */
type Field<R extends Rules> = keyof R & string

/**
 * A family of settings declared by rule (`settingRules.ts`) among the world's switches
 * (`switches.ts`): each field a render setting of the world's registry under its own name
 * (`settings.ts`), read by the one resolver of the rules (`resolveSetting`) wherever it is
 * written.
 * - `page` writes the settings the page opened the world with, at the page's priority;
 * - `get` is one of its settings resolved over the page and the preset;
 * - `values` is the family resolved over the page and the preset, by field: what a session opens
 *   with;
 * - `watch` writes each resolved value that changes into the open session (`write`, the family's
 *   setter of a session) and asks for a frame;
 * - `apply` writes into the session just opened each setting the page changed since it was given
 *   its options;
 * - `set` writes the page's settings `options` name: one `null` gives the setting back to the
 *   preset, one left out stays as it is.
 * The registry is typed over every family at once; a family names its own fields alone.
 */
function ruledSwitches<R extends Rules>(
  settings: WorldSettings,
  rules: R,
  write: (session: MeasuredWorld, field: Field<R>, value: never) => void,
) {
  const fields = Object.keys(rules) as Field<R>[]
  const registry = settings as unknown as {
    get(name: string): R[Field<R>]['default']
    set(name: string, value: R[Field<R>]['default'], source: 'page'): void
    clear(name: string, source: 'page'): void
    watch(name: string, hook: (value: R[Field<R>]['default']) => void): void
  }
  /** The page's `option` of `field`, as its one resolver reads it (a level also takes a switch). */
  const pageSet = (field: Field<R>, option: SettingOptions<R>[Field<R>]) =>
    registry.set(field, resolveSetting(rules[field], option as never), 'page')
  return {
    page(options: SettingOptions<R>) {
      for (const field of fields) if (options[field] != null) pageSet(field, options[field]!)
    },
    get: <F extends Field<R>>(field: F) => registry.get(field) as R[F]['default'],
    values: () =>
      Object.fromEntries(fields.map((field) => [field, registry.get(field)])) as Values<R>,
    watch(session: () => MeasuredWorld | null, invalidate: () => void) {
      for (const field of fields)
        registry.watch(field, (value) => {
          const opened = session()
          if (opened) write(opened, field, value as never)
          invalidate()
        })
    },
    apply(opened: MeasuredWorld, given: SettingOptions<R>) {
      for (const field of fields)
        if (registry.get(field) !== given[field]) write(opened, field, registry.get(field) as never)
    },
    set(options: SettingOptions<R>) {
      for (const field of fields) {
        if (!(field in options)) continue
        const option = options[field]
        if (option == null) registry.clear(field, 'page')
        else pageSet(field, option)
      }
    },
  }
}

/** The session's writer of one setting of a family: `session.setCut(field, value)` for the cut. */
type Write = (session: MeasuredWorld, field: string, value: never) => void

/** The families whose session writer is not the method `setterOf` names, which takes `(field, value)`:
 *  the cluster raster has one method for each of its settings (`setSoftwareRaster`,
 *  `setHardwareRasterEdgePixels`, `setDepthBucketing`, `setDepthBucketsMinZ`,
 *  `setDepthBucketsMaxZ`), told apart by the field. Every other family is written by
 *  `writerOf`. */
const WRITERS: Readonly<Record<string, Write>> = {
  raster: (session, field, value) => {
    switch (field) {
      case 'softwareRaster':
        return session.setSoftwareRaster(value as boolean)
      case 'hardwareRasterEdgePixels':
        return session.setHardwareRasterEdgePixels(value as number)
      case 'depthBucketing':
        return session.setDepthBucketing(value as boolean)
      case 'depthBucketsMinZ':
        return session.setDepthBucketsMinZ(value as number)
      default:
        return session.setDepthBucketsMaxZ(value as number)
    }
  },
}

/** The writer of the family `name`: its override, else the session's method `setterOf(name)`. */
const writerOf = (name: string): Write =>
  WRITERS[name] ??
  ((session, field, value) =>
    (session as unknown as Record<string, (field: string, value: unknown) => void>)[setterOf(name)](
      field,
      value,
    ))

/** The family `name`'s rules read and written over the registry. */
type Ruled<R extends Rules> = ReturnType<typeof ruledSwitches<R>>

/** The world's families by rule over its registry `settings` (`SETTING_FAMILIES`, in its order), each
 *  read by its rules' one resolver and written into a session by its own setter. */
export type WorldFamilies = {
  [N in keyof typeof SETTING_FAMILIES]: Ruled<(typeof SETTING_FAMILIES)[N]['rules']>
}

/** The world's families by rule over its registry `settings`: every row of `table`
 *  (`SETTING_FAMILIES`) made one `ruledSwitches`, read by its rules' one resolver and written into a
 *  session by `writerOf` its name. */
export const worldFamilies = (
  settings: WorldSettings,
  table: FamilyTable = SETTING_FAMILIES,
): WorldFamilies =>
  Object.fromEntries(
    Object.entries(table).map(([name, family]) => [
      name,
      ruledSwitches(settings, family.rules, writerOf(name)),
    ]),
  ) as unknown as WorldFamilies
