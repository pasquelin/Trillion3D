import type { WorldStreamingField } from '../contracts/worldStreamingOptions.ts'

/** The settings of the view as a source of streaming that rank its cells, by their field. */
export type WorldSourceField = Extract<
  WorldStreamingField,
  'worldStreamingPriority' | 'worldStreamingUseVelocity'
>

/** What each of them means (`../contracts/worldStreamingOptions.ts`). */
export const WORLD_SOURCE_MEANINGS: Readonly<Record<WorldSourceField, string>> = {
  worldStreamingPriority:
    "The view's priority as a streaming source, a whole number from 0 (the highest) to 255 (the lowest), 128 by default: the cells of the source of the highest priority load first. A scene has one view, so every cell it wishes has this one priority and no order changes; a change of it makes the cells wished again.",
  worldStreamingUseVelocity:
    "Whether the view's average velocity — over its last frames, none after a jump of more than 100 m or an idle of more than 5 s — is added to the axis a loose grid's cells are sorted along: a cell ahead of where the view is going loads before one ahead of where it looks; false by default.",
}
