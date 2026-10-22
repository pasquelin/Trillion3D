import type { Trillion3dTool } from './types.ts'
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts'
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts'
import { LEAST_POOL_BUDGET } from '../contracts/poolBudgets.ts'
import { DIAGNOSTICS, type DiagnosticMode } from '../runtime/diagnostics.ts'
import { RASTER_RULES } from '../contracts/rasterOptions.ts'
import { STREAMING_RULES } from '../contracts/streamingOptions.ts'
import { WORLD_STREAMING_RULES } from '../contracts/worldStreamingOptions.ts'
import { CUT_RULES } from '../contracts/cutOptions.ts'
import { DYNAMIC_RESOLUTION_RULES } from '../contracts/dynamicResolutionOptions.ts'
import { ANIMATION_RULES } from '../contracts/animationOptions.ts'
import { SHADING_RULES } from '../contracts/shadingOptions.ts'
import { EXPOSURE_RULES } from '../contracts/exposureOptions.ts'
import { TEMPORAL_RULES } from '../contracts/temporalOptions.ts'
import { HIZ_RULES } from '../contracts/hizOptions.ts'
import { LIGHT_FUNCTION_RULES } from '../contracts/lightFunctionOptions.ts'
import { VOLUMETRIC_LIGHTMAP_RULES } from '../contracts/volumetricLightmapOptions.ts'
import { DISTANCE_FIELD_OCCLUSION_RULES } from '../contracts/distanceFieldOcclusionOptions.ts'
import { GLOBAL_DISTANCE_FIELD_RULES } from '../contracts/globalDistanceFieldOptions.ts'
import { SHADOW_DISTANCE_DEFAULT, SHADOW_RULES } from '../contracts/shadowOptions.ts'
import { MOTION_BLUR_RULES } from '../contracts/motionBlurOptions.ts'
import { DEPTH_OF_FIELD_RULES } from '../contracts/depthOfFieldRules.ts'
import { TESSELLATION_RULES } from '../contracts/tessellationOptions.ts'
import { BLOOM_RULES } from '../contracts/bloomRules.ts'
import { GAUSSIAN_BLUR_RULES } from '../contracts/gaussianBlurRules.ts'
import { FILM_RULES } from '../contracts/filmOptions.ts'
import { VOLUMETRIC_FOG_RULES } from '../contracts/volumetricFogOptions.ts'
import { SCREEN_PROBE_RULES } from '../bounce/screenProbeOptions.ts'
import { REFLECTION_RULES } from '../contracts/reflectionOptions.ts'
import { AMBIENT_OCCLUSION_RULES } from '../contracts/ambientOcclusionOptions.ts'
import { SKY_QUALITY_RULES } from '../modules/sky/quality.ts'

/** A tool that writes the run-time settings of the rules by field `rules`, each as the explorer's
 *  options describe it (`EXPLORER_OPTIONS_SCHEMA`). Each call is marked pure, so a bundle that
 *  never reads the tools drops them. */
const settingTool = (
  name: string,
  description: string,
  rules: Readonly<Record<string, unknown>>,
): Trillion3dTool => ({
  name,
  description,
  parameters: {
    type: 'object',
    properties: Object.fromEntries(
      Object.keys(rules).map((field) => [field, EXPLORER_OPTIONS_SCHEMA.properties[field]!]),
    ),
    additionalProperties: false,
  },
})

/** The view modes this engine can show: the others `setDiagnostic` refuses. Pure, so a bundle
 *  that never reads the tools drops it. */
const AVAILABLE_DIAGNOSTICS = /* @__PURE__ */ (Object.keys(DIAGNOSTICS) as DiagnosticMode[]).filter(
  (mode) => DIAGNOSTICS[mode].available,
)

/**
 * Complete catalog of tools and runtime functions available to control Trillion3D from an LLM.
 */
export const TRILLION3D_RUNTIME_TOOLS: Trillion3dTool[] = [
  {
    name: 'trillion3d_create_explorer',
    description: 'Initializes the Trillion3D explorer with specified rendering options.',
    parameters: EXPLORER_OPTIONS_SCHEMA,
  },
  {
    name: 'trillion3d_compile_asset',
    description:
      'Compiles a source 3D asset (FBX, OBJ, glTF) to the virtualized cluster geometry format.',
    parameters: COMPILER_OPTIONS_SCHEMA,
  },
  {
    name: 'trillion3d_set_memory_budgets',
    description:
      'Dynamically adjusts GPU memory pools (virtualized geometry and virtual textures) during live execution.',
    parameters: {
      type: 'object',
      properties: {
        geometryPoolBytes: {
          type: 'integer',
          minimum: LEAST_POOL_BUDGET,
          description: 'New budget for the geometry pool in bytes (e.g., 268435456 for 256 MiB).',
        },
        texturePoolBytes: {
          type: 'integer',
          minimum: LEAST_POOL_BUDGET,
          description: 'New budget for the virtual texture pool in bytes.',
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_set_lod_error',
    description:
      'Adjusts the geometric screen-space error threshold in pixels to trade fidelity for performance.',
    parameters: {
      type: 'object',
      properties: {
        pixelError: {
          type: 'number',
          minimum: 0,
          description:
            'Threshold in pixels (0 = maximum visual fidelity without simplification, 1 to 2 = standard, > 2 = higher FPS).',
        },
      },
      required: ['pixelError'],
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_set_temporal_antialiasing',
    description: 'Enables or disables temporal antialiasing (TAA).',
    parameters: {
      type: 'object',
      properties: {
        enabled: {
          type: 'boolean',
          description:
            'true to enable temporal accumulation, false for instantaneous pixel-exact rendering.',
        },
      },
      required: ['enabled'],
      additionalProperties: false,
    },
  },
  /* @__PURE__ */ settingTool(
    'trillion3d_set_raster',
    'Chooses which rasterizer draws each cluster from the next frame: the compute (software) raster for clusters whose edges project small, the hardware rasterizer for the others.',
    RASTER_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_streaming',
    'Changes how the geometry streaming runs from its next update: the pages it keeps started at once, the pages a frame installs, how the streaming pool load scales the screen error, and the bandwidth the reads are simulated to have.',
    STREAMING_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_world_streaming',
    "Changes from the next frame how the view streams a partitioned scene's cells (how many load at once, their load order, the streaming circle's range or radius, a sector) and the warm-up an HLOD switch waits on.",
    WORLD_STREAMING_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_cut',
    "Changes from the next frame how the GPU cluster cut culls: its two-pass occlusion against the depth pyramid, its frustum and too-coarse culls, the draw distances objects name and their scale, whether a view's clip plane applies (off by default) and culls and whether its lists of hidden and shown objects apply, how an upscaled image's level of detail follows the display, and the GPU time budget that coarsens its screen error.",
    CUT_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_dynamic_resolution',
    "Changes from the next GPU time how the dynamic resolution fits the render scale, where it is 'auto', and the cut's edge scale beside it to their GPU time budget: the frame's budget (the frame cap's interval by default), the headrooms, the history kept and the weight of its frames, the change period and threshold, how far a rise goes, the frames over budget that end a history, the most the scale may be while throttled, and whether the CPU time of a frame excuses it. The scale's bounds are renderScale's.",
    DYNAMIC_RESOLUTION_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_animation',
    "Changes from the next frame the animation the GPU plays: the screen size under which an instanced skinned object stops animating and is drawn in its rest pose, whether the animation banks' tracks blend their two nearest keys, and the scale of the world's seconds they advance by.",
    ANIMATION_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_shading',
    "Changes from the next frame how the material pass bins each material's pixels before shading them: by pixel or by 2 × 2 quad, or as each material's shading asks. The image is the same in each mode.",
    SHADING_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_exposure',
    "Changes from the next frame how the automatic exposure follows the image: the bias in stops, the range of the mean luminance in EV100, the histogram's span, the shares of the pixels left out, the speeds in stops a second, the transition distance, the weight of the black bucket and how a pixel's luminance is read. They apply where the exposure is 'auto', the default.",
    EXPOSURE_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_temporal',
    "Changes from the next frame how the temporal anti-aliasing, whose level trillion3d_set_temporal_antialiasing sets, treats geometry thinner than a pixel: whether it looks for a wire or a rail and relaxes its history there, off by default. It applies at any level but 'off'.",
    TEMPORAL_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_hiz',
    "Changes from the next frame how the depth pyramid is read: how the reflections' screen trace walks it ('reference', the closest opaque depth of each texel, or 'planes', each pixel a plane), whether its trace layers hold the transparent surfaces (off by default) and how the transparent clusters are tested against it ('finer' or 'reference').",
    HIZ_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_light_function',
    "Changes from the next frame how the light functions are drawn: whether the atlas is made, the texels of a slot and the slots of its side, the most lights that read it, whether a texel holds a grey or a colour, and which passes read it: the opaque lighting, the volumetric fog's local lights (its sun always reads it) and the translucent layers (off by default).",
    LIGHT_FUNCTION_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_volumetric_lightmap',
    "Changes from the next frame whether the precomputed indirect light of the scene (its volumetric lightmap) is read, by the fog's static term and by the lighting of movable objects; on by default. Off, every read answers black.",
    VOLUMETRIC_LIGHTMAP_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_global_distance_field',
    "Changes from the next frame how the global distance field is made from the meshes' distance fields (a mesh has one where its build sets distanceField): whether it is made and updated, how many clipmaps (4 by default, at most 6), the view distance and resolution that size them, how often each updates, whether the static meshes are composited apart, the fast camera mode, and the budgets of the atlas the meshes' fields are streamed into. A scene whose meshes built no distance field is not touched.",
    GLOBAL_DISTANCE_FIELD_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_distance_field_occlusion',
    "Changes from the next frame how the dynamic sky light is occluded by the distance fields (the global one and the meshes' own, which a mesh has where its build sets distanceField): whether it is drawn and its quality (1 the global field alone, 2 the meshes' fields too), how the cones' samples are spaced, the farthest a pixel is lit by it, the cones' sample set and jitter, the temporal filter, the specular occlusion's mode and strength, and the room of a screen tile for meshes. A scene with no distance field, a sky light that casts no shadow or screen probes lighting the pixels are not touched.",
    DISTANCE_FIELD_OCCLUSION_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_shadows',
    "Changes from the next frame how a directional light's shadow maps take their casters by distance: the factor on every light's shadow distance, whether the casters past that distance are left out, and whether that test reaches every caster or the world's merged far-field shells alone, and whether the lights whose maps would pass what one pass of the shadow raster lists are drawn in several passes. It also sets the shadow maps' own: the sun clipmap's levels and depth range, the coarse pages, the resolution biases at rest and while a light moves, the size under which a caster is left out of a map redrawn whole, the rays and steps of a shadow trace, and the page pool.",
    SHADOW_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_motion_blur',
    "Changes from the next frame how the motion blur is drawn: its quality — the samples a pixel gathers along its streak, off for none —, whether a long streak is gathered at half the resolution, whether its samples read the half-resolution image, whether the blur runs twice, and whether the largest motion of each tile is spread by drawing it. The strength, the longest streak and the frame rate are the effect's.",
    MOTION_BLUR_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_depth_of_field',
    "Changes from the next frame how the depth of field is drawn: its quality — off for none —, the size and the accumulator of the gather, its rings, its post-filter and its bokeh, how the bright highlights are scattered as sprites for the foreground and for the background, and the recombine's slight out of focus. The lens, the focus and the camera are the effect's.",
    DEPTH_OF_FIELD_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_tessellation',
    'Changes from the next frame how a material that names a displacement and switches its tessellation on is drawn: whether it is cut into micro-triangles and pushed along its normals by its height map, the size in pixels of those micro-triangles, the patches a group of the dicing pass takes, and the patches the splitting queue and the visible list hold. A scene whose materials name no displacement is not touched.',
    TESSELLATION_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_bloom',
    "Changes from the next frame how the bloom is drawn: its quality — how many of the six Gaussian levels draw, the widest first, off for none —, the cross given to the Gaussian blur, the resolution of the convolution bloom, whether the local exposure reaches the image it reads and whether the convolution keeps its kernel's transform. The glow's method, intensity, levels, convolution and dirt mask are the effect's.",
    BLOOM_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_gaussian_blur',
    "Changes from the next frame how the Gaussian blur of the bloom's levels and of the local exposure's blurred luminance is drawn: the radius from which a blur writes its first pass at half the width, the reach of its kernel as a multiple of its radius, and the most reads of a pass.",
    GAUSSIAN_BLUR_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_film',
    "Changes from the next frame the film effects of the display finishing: the film grain (off by default) with its shares in the dark, middle and bright pixels, its size and its repeat; the colour fringe toward the corners (off by default), its start, quality and cap; the vignette's shape, colour, centre, size and softness (its strength is the scene's); the tonemapper's quality, which gates the vignette and the grain, its sharpening, and the scene's tint; and the dither that hides the display's steps, on by default (24 bits or more switches it off).",
    FILM_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_volumetric_fog',
    "Changes from the next frame how the fog's volume is drawn where the sky module's height fog turns it on (scene.sky heightFog.volumetric): its quality — the cells' size and depth, off for none —, how a surface filters it, how the volume of the image before is blended in, and the tuning of its lighting samples.",
    VOLUMETRIC_FOG_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_sky_quality',
    "Changes from the next frame how the sky is drawn: the atmosphere's switches, its samples and their caps, the sizes of its tables and of the haze volume it hazes the distance with, whether a light's shadow shades the air, the clouds' tracing and shadows, the light shafts and the sky light's capture. Each setting's default is the reference's top level; the quality presets write the lower ones.",
    SKY_QUALITY_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_indirect_light',
    "Changes from the next frame how a pixel gets the light that bounced before reaching it: the level of the screen probes (off, high, ultra, cinematic) placed on the screen, one a tile of pixels, and how they are traced, filtered in space and time, and occluded at a short range. Off, the pixel reads the world's bounce probes.",
    SCREEN_PROBE_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_reflections',
    "Changes from the next frame how the reflections are traced: their level (off, high, ultra, cinematic: how many rays a pixel's reflection is made of and how the rays round it are read), how far a reflected ray looks before the sky answers — the iterations of its march of the screen, the steps it may take in each of the four rings the world's probes cut it into (a ring that spends them before it found a surface is skipped, one that found a surface keeps it), whether and how its first metres are walked in detail, whether the screen is looked at once more past the rings, how far and in how many steps —, what a ray brings back (the ceiling of its radiance, the fog along it, the lit image where a scene hit agrees with the screen) and how the rays are denoised in space and time.",
    REFLECTION_RULES,
  ),
  /* @__PURE__ */ settingTool(
    'trillion3d_set_ambient_occlusion',
    "Changes from the next frame the screen-space ambient occlusion: the contact shadow a crease or a corner casts on the light that comes from all round, found in the depth the image drew. Its intensity (0 is off), radius, fade distance, power and bias, its quality — the resolutions it searches at and the samples a pixel takes — and whether it also occludes the screen probes' light. It applies where no screen probes light the pixels.",
    AMBIENT_OCCLUSION_RULES,
  ),
  {
    name: 'trillion3d_add_light',
    description: 'Adds a punctual point light, spot light, or directional sunlight into the scene.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Unique identifier for the light.' },
        kind: {
          type: 'string',
          enum: ['point', 'spot', 'directional'],
          description: 'Light emitter type.',
        },
        color: {
          type: 'array',
          items: {
            type: 'number',
            minimum: 0,
            maximum: 1,
            description: 'Normalized linear RGB component.',
          },
          description: 'Linear RGB color [R, G, B] between 0 and 1.',
        },
        intensity: { type: 'number', minimum: 0, description: 'Radiometric light intensity.' },
        position: {
          type: 'array',
          items: { type: 'number', description: 'Spatial coordinate in meters.' },
          description:
            'Position [X, Y, Z] in meters (required for point and spot; forbidden for directional).',
        },
        direction: {
          type: 'array',
          items: { type: 'number', description: 'Normalized vector component.' },
          description: 'Propagation direction [X, Y, Z] (required for spot and directional).',
        },
        range: {
          type: 'number',
          minimum: 0.1,
          description: 'Maximum reach in meters (point and spot).',
        },
        coneAngle: {
          type: 'number',
          minimum: 0.01,
          // The engine refuses a half-angle of π/2 or more (`scene/light/validate.ts`); an inclusive
          // bound below π/2 keeps to the subset every provider reads (no `exclusiveMaximum`).
          maximum: 1.57,
          description: 'Half-angle beam spread in radians (spot).',
        },
        castsShadow: {
          type: 'boolean',
          default: false,
          description: 'Enables virtual shadow map casting.',
        },
        fogScattering: {
          type: 'number',
          minimum: 0,
          default: 1,
          description:
            'How much of this light the volumetric fog and the clouds scatter, a factor on its colour there; 0 leaves it out of both. It does not change the light on surfaces.',
        },
        shadowsFog: {
          type: 'boolean',
          description:
            "Whether this light's shadow also shadows the volumetric fog (it must cast shadows). True by default for a directional light, false for any other.",
        },
        useTemperature: {
          type: 'boolean',
          default: false,
          description:
            "Whether this light's colour is multiplied by the colour of a black body at temperatureKelvin.",
        },
        temperatureKelvin: {
          type: 'number',
          default: 6500,
          description:
            'The black body temperature in kelvin that useTemperature takes the colour of, read between 1000 and 15000; 6500 is white.',
        },
        sunDiskTint: {
          type: 'array',
          items: { type: 'number', minimum: 0, description: 'Linear RGB component.' },
          description:
            "Directional only: a linear RGB colour [R, G, B] the sun's disk in the sky is multiplied by, never the light it gives; white by default.",
        },
        shaftOcclusion: {
          type: 'boolean',
          default: false,
          description:
            "Directional only: whether this light darkens the fog's inscattering where the scene hides it (light shafts).",
        },
        shaftOcclusionDarkness: {
          type: 'number',
          default: 0.05,
          description: 'Directional only: what a shaft occlusion of 0 maps to; 1 darkens nothing.',
        },
        shaftOcclusionDepthRange: {
          type: 'number',
          default: 1000,
          description:
            'Directional only: everything closer to the eye than this distance, in metres, occludes the shafts.',
        },
        shaftOverrideDirection: {
          type: 'array',
          items: { type: 'number', description: 'Direction component.' },
          description:
            "Directional only: a direction [x, y, z] the shafts come from instead of the light's own; zero, the default, keeps the light's.",
        },
        shaftBloom: {
          type: 'boolean',
          default: false,
          description: 'Whether this light adds a bloom around itself (light shafts).',
        },
        shaftBloomScale: {
          type: 'number',
          default: 0.2,
          description: 'The factor on the colour the shaft bloom adds.',
        },
        shaftBloomThreshold: {
          type: 'number',
          default: 0,
          description: 'The brightness the image must pass, after exposure, to bloom.',
        },
        shaftBloomMaxBrightness: {
          type: 'number',
          default: 100,
          description: 'A brightness above it, after exposure, is brought down to it.',
        },
        shaftBloomTint: {
          type: 'array',
          items: { type: 'number', minimum: 0, description: 'Linear RGB component.' },
          description:
            "A linear RGB colour [R, G, B] the shaft bloom's colour is multiplied by; white by default.",
        },
        shadowsAir: {
          type: 'boolean',
          default: false,
          description:
            "Directional only: whether this light's shadow also shades the atmosphere (the haze and the sky's march read it along their rays); it must cast shadows.",
        },
        transmittancePerPixel: {
          type: 'boolean',
          default: false,
          description:
            "Directional only: whether the atmosphere's transmittance toward this light is read for each surface point and not once at the ground.",
        },
        shadowDistance: {
          type: 'number',
          minimum: 0,
          default: SHADOW_DISTANCE_DEFAULT,
          description:
            "Directional only: how far from the eye, in meters, its shadows are asked to reach (the far-shadow test's edge lies a little farther, 427 m at 400). Past the edge a caster that does not set castFarShadow is left out: by default only the merged far-field shells of the world's coarser levels, every caster when the view's farShadowCullsAllMeshes is true. 0 leaves none out.",
        },
      },
      required: ['id', 'kind', 'color', 'intensity'],
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_remove_light',
    description: 'Removes a light source from the scene by its identifier.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Identifier of the light to remove.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_set_diagnostic',
    description:
      'Activates an engine diagnostic mode to inspect underlying geometry, materials, or culling.',
    parameters: {
      type: 'object',
      properties: {
        mode: {
          type: 'string',
          enum: AVAILABLE_DIAGNOSTICS,
          description: 'Technical diagnostic mode to display.',
        },
      },
      required: ['mode'],
      additionalProperties: false,
    },
  },
  {
    name: 'trillion3d_get_metrics',
    description:
      'Queries live telemetry metrics (FPS, resident cluster pages, visible triangles, shadow wait queues).',
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: false,
    },
  },
]
