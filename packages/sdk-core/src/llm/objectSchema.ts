import {
  DEFAULT_BANK_BOUNDS_SCALE,
  DEFAULT_BANK_LOOPING,
  DEFAULT_BANK_PLAY_RATE,
  DEFAULT_BANK_POSITION,
  DEFAULT_OBJECT_ANIMATION_MIN_SCREEN_SIZE,
  DEFAULT_OBJECT_MOBILITY,
  DEFAULT_SPATIALLY_LOADED,
  OBJECT_MOBILITIES,
  OBJECT_SETTINGS_OBJECTS,
  SKINNED_INSTANCE_SETTING,
  SPATIALLY_LOADED_SETTING,
  type ObjectSettingsWire,
  type SkinnedInstanceWire,
} from '../contracts/compilerAbi.ts'
import { flag, num, positive, sceneAndRules } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The settings of an instanced skinned object (`objectOptions.ts`, `SkinnedInstanceSettings`),
 *  one for each key the compiler reads. */
const skinnedInstanceSettings: Record<keyof SkinnedInstanceWire, JsonSchemaProperty> =
  /* @__PURE__ */ (() => ({
    clip: {
      description:
        'The animation it plays: its rank in the document, or its name (default the first animation of the document that moves a joint of its skin).',
      anyOf: [
        { type: 'integer', minimum: 0, description: "The animation's rank in the document." },
        { type: 'string', description: "The animation's name." },
      ],
    },
    looping: flag(
      `Whether its track wraps at its end, or holds its last pose (default ${DEFAULT_BANK_LOOPING}).`,
    ),
    playRate: num(`The seconds of the clip one second plays (default ${DEFAULT_BANK_PLAY_RATE}).`),
    position: num(
      `The second of the clip it starts from, from 0 to the clip's length (default ${DEFAULT_BANK_POSITION}).`,
      0,
    ),
    boundsScale: positive(
      `The scale of its sampled bounds about their centre: room for vertices the joints carry out of them (default ${DEFAULT_BANK_BOUNDS_SCALE}).`,
    ),
    animationMinScreenSize: num(
      `The screen size — its bounds' diameter over the view's height — under which it stops animating and is drawn in its rest pose: 0 the run-time setting animationMinScreenSize, a negative value never (default ${DEFAULT_OBJECT_ANIMATION_MIN_SCREEN_SIZE}).`,
    ),
    mobility: {
      type: 'string',
      enum: OBJECT_MOBILITIES,
      description: `static or stationary makes it HLOD-relevant — its cell's HLOD 0 actor plays it on —, movable keeps it out of every HLOD (default ${DEFAULT_OBJECT_MOBILITY}).`,
    },
  }))()

/** The settings of one source of `objectSettings` (`objectOptions.ts`): the scene's or a rule's. */
const objectSettingsOf: Record<keyof ObjectSettingsWire, JsonSchemaProperty> =
  /* @__PURE__ */ (() => ({
    [SPATIALLY_LOADED_SETTING]: flag(
      `Whether the object streams on the partition's main grid, drawn while the view lies within the grid's loading range of its cell, or is loaded with the scene and always drawn (false). An animated object — skinned, morphed, or moved by a clip itself or through a parent — streams too, and no HLOD stands for it past its cell's range (default ${DEFAULT_SPATIALLY_LOADED}).`,
    ),
    [SKINNED_INSTANCE_SETTING]: {
      description:
        "Whether a skinned object plays a clip baked into the scene's animation banks on the GPU, every instance of one clip, mesh and settings in one pose: true every default, false (the default) a skinned object its host's clips move, or the settings it names over the defaults.",
      anyOf: [
        flag('true every default, false not instanced.'),
        {
          type: 'object',
          description: 'The settings it names over the defaults.',
          properties: skinnedInstanceSettings,
        },
      ],
    },
  }))()

/** The `objectSettings` option (`objectOptions.ts`, `resolveObjectSettings`). */
export const objectSettings: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description: `Each object's settings: the settings for every object, and ${OBJECT_SETTINGS_OBJECTS}, rules setting them for the objects a match names. For each setting of an object the first that names it wins: the first rule matching it, the scene's setting, its node's own glTF extras under the setting's name, the default.`,
  properties: sceneAndRules(objectSettingsOf, OBJECT_SETTINGS_OBJECTS, 'them'),
}))()
