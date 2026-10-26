import {
  DEFAULT_BANK_BOUNDS_SCALE,
  DEFAULT_BANK_LOOPING,
  DEFAULT_BANK_PLAY_RATE,
  DEFAULT_BANK_POSITION,
  DEFAULT_DRAW_DISTANCE_MAX,
  DEFAULT_DRAW_DISTANCE_MIN,
  DEFAULT_DRAW_DISTANCE_PER_INSTANCE,
  DEFAULT_OBJECT_ANIMATION_MIN_SCREEN_SIZE,
  DEFAULT_OBJECT_MOBILITY,
  DEFAULT_SPATIALLY_LOADED,
  DRAW_DISTANCE_SETTING,
  OBJECT_MOBILITIES,
  OBJECT_SETTINGS_OBJECTS,
  RUNTIME_GRID_SETTING,
  FAR_FIELD_SETTING,
  DEFAULT_FAR_FIELD,
  CAST_FAR_SHADOW_SETTING,
  DEFAULT_CAST_FAR_SHADOW,
  FAR_SHADOW_TEST_SETTING,
  SKINNED_INSTANCE_SETTING,
  SPATIALLY_LOADED_SETTING,
  type DrawDistanceWire,
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

/** The distances of an object's draw distance (`objectOptions.ts`, `DrawDistanceSettings`), one for
 *  each key the compiler reads. */
const drawDistanceSettings: Record<keyof DrawDistanceWire, JsonSchemaProperty> =
  /* @__PURE__ */ (() => ({
    min: num(
      `The distance under which the object is not drawn, in the scene's units: the sphere of its bounds is wholly nearer to the eye (default ${DEFAULT_DRAW_DISTANCE_MIN}).`,
      0,
    ),
    max: num(
      `The distance past which the object is not drawn, in the scene's units: the sphere of its bounds is wholly farther from the eye; 0 none (default ${DEFAULT_DRAW_DISTANCE_MAX}).`,
      0,
    ),
    perInstance: flag(
      `Whether the object is one instance of an instanced mesh: its bounds' centre is tested instead of the sphere, and only a max above 0 is a distance, a min alone is none (default ${DEFAULT_DRAW_DISTANCE_PER_INSTANCE}).`,
    ),
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
    [DRAW_DISTANCE_SETTING]: {
      description:
        'The distances the object is drawn at, culled nearer than min and farther than max from the eye, measured to the sphere of its bounds (cutDistanceCullToSphereEdge) or, for an instance (perInstance), to the centre of its bounds: false (the default) none, the object is drawn at every distance, or the distances it names over their defaults. The run-time setting cutDrawDistanceCulling turns the cull of instances off (an object of its own is always culled), cutViewDistanceScale scales the distances.',
      anyOf: [
        flag('false: none, the object is drawn at every distance; true is refused.'),
        {
          type: 'object',
          description: 'The distances it names over the defaults.',
          properties: drawDistanceSettings,
        },
      ],
    },
    [FAR_FIELD_SETTING]: flag(
      `Whether a view's primed depth draws the object: the small, coarse draw its Hi-Z pyramid is built from before its cut (hizPrime). With hizPrimeFarFieldOnly, only objects that set it are drawn (default ${DEFAULT_FAR_FIELD}).`,
    ),
    [CAST_FAR_SHADOW_SETTING]: flag(
      `Whether the object casts far shadows: a directional light's shadow maps leave out the casters past the edge of its shadow distance (farShadowCulling), and the objects it casts far shadows for are kept at any distance (default ${DEFAULT_CAST_FAR_SHADOW}).`,
    ),
    [FAR_SHADOW_TEST_SETTING]: flag(
      "Whether a directional light's far-shadow test reaches the object: true, the object is left out of the light's shadow maps past the edge of its shadow distance unless it casts far shadows (castFarShadow); false, the test never leaves it out. Left out, the view's rule decides: only the merged far-field shells of the world's coarser levels, or every caster when farShadowCullsAllMeshes is true.",
    ),
    [RUNTIME_GRID_SETTING]: {
      type: 'string',
      description:
        "The name of the streaming grid the object streams on (partitionGrids), a text with no ':' or '.': the first grid when it names none or a grid the job does not hold (default the first grid). An object attached under another streams on its topmost object's grid.",
    },
  }))()

/** The `objectSettings` option (`objectOptions.ts`, `resolveObjectSettings`). */
export const objectSettings: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description: `Each object's settings: the settings for every object, and ${OBJECT_SETTINGS_OBJECTS}, rules setting them for the objects a match names. For each setting of an object the first that names it wins: the first rule matching it, the scene's setting, its node's own glTF extras under the setting's name, the default.`,
  properties: sceneAndRules(objectSettingsOf, OBJECT_SETTINGS_OBJECTS, 'them'),
}))()
