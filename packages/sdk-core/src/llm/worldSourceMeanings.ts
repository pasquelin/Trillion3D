import type { WorldStreamingField } from '../contracts/worldStreamingOptions.ts'

/** The settings of the view as a source of streaming — when its wishes are worked out again, its
 *  shape beyond the grids' ranges, what it asks of the cells, how its cells rank —, by their field. */
export type WorldSourceField = Extract<
  WorldStreamingField,
  | 'worldStreamingUpdateOptimization'
  | 'worldStreamingLocationQuantization'
  | 'worldStreamingRotationQuantization'
  | 'worldStreamingForceUpdateFrameCount'
  | 'worldStreamingForce2D'
  | 'worldStreamingExtraRadius'
  | 'worldStreamingExtraAngle'
  | 'worldStreamingTargetState'
  | 'worldStreamingPriority'
  | 'worldStreamingUseVelocity'
>

/** What each of them means (`../contracts/worldStreamingOptions.ts`). */
export const WORLD_SOURCE_MEANINGS: Readonly<Record<WorldSourceField, string>> = {
  worldStreamingUpdateOptimization:
    'Whether the cells the view wishes are worked out again only once its position or heading moved enough (worldStreamingLocationQuantization, worldStreamingRotationQuantization), at once while a cell wished is still loading or not yet shown or the initial load runs; false, at every frame. Both quantizations at 0 count as false.',
  worldStreamingLocationQuantization:
    "Metres: the squares the view's position is cut into on the ground, and in height on a grid that streams in 3D, to tell whether it moved enough for the cells to be wished again; 0, its exact position.",
  worldStreamingRotationQuantization:
    "Degrees: the steps the view's yaw is cut into, and its pitch on a grid that streams in 3D, to tell whether it turned enough for the cells to be wished again; 0, its exact angle.",
  worldStreamingForceUpdateFrameCount:
    'Frames: every that many frames the cells the view wishes are worked out again whatever the view did (worldStreamingUpdateOptimization); 0, never forced.',
  worldStreamingForce2D:
    "Whether a loose grid (partitionScheme hashSet) that streams in 3D wishes its cells by their footprint on the ground, the view's height ignored, as a flat grid does; no effect on a flat or a square grid.",
  worldStreamingExtraRadius:
    "Metres added to the radius of the view's streaming circle (a sphere on a grid that streams in 3D).",
  worldStreamingExtraAngle:
    "Degrees added to the angle of the view's sector (worldStreamingSector), a whole turn at most.",
  worldStreamingTargetState:
    'What the view asks of the cells it reaches: activated, to load and draw them; loaded, to load them and keep them placed in memory without activating them: no cell file, HLOD 0 actor nor HLOD actor a cell holds draws, none of the rows a scene compiled without HLOD places either, and none holds the images back. The actors always loaded — held by no cell — stay activated and drawn.',
  worldStreamingPriority:
    "The view's priority as a streaming source, a whole number from 0 (the highest) to 255 (the lowest), 128 by default: the cells of the source of the highest priority load first. A scene has one view, so every cell it wishes has this one priority and no order changes; a change of it makes the cells wished again.",
  worldStreamingUseVelocity:
    "Whether the view's average velocity — over its last frames, none after a jump of more than 100 m or an idle of more than 5 s — is added to the axis a loose grid's cells are sorted along: a cell ahead of where the view is going loads before one ahead of where it looks; false by default.",
}
