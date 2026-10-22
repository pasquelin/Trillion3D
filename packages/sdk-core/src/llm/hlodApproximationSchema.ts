import {
  DEFAULT_HLOD_BASE_CAPPING,
  DEFAULT_HLOD_GROUND_CLIPPING,
  HLOD_BASE_CAPPINGS,
  HLOD_GROUND_CLIPPINGS,
} from '../contracts/compilerAbi.ts'
import { choiceOrFlag, flag, int, num } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The images an approximate layer's atlas bakes beside the base colour, the five its compiler's
 *  reader admits (`HlodApproximation.maps`). */
const approximationMaps: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description:
    'The images the atlas bakes beside the base colour; the roughness, metallic and specular share one packed image (R, G, B); a channel not baked takes the constant roughness 0.5 or metallic 0 (default the normal map alone).',
  properties: {
    normal: flag('The normal map (default true).'),
    roughness: flag('The roughness (default false).'),
    metallic: flag('The metallic (default false).'),
    specular: flag('The specular (default false).'),
    emissive: flag('The emission map (default false).'),
  },
}))()

/** An approximate layer's other steps (`HlodApproximation`), as `description` names whose: an
 *  expert layer's `approximation`. */
export const approximation = (description: string): JsonSchemaProperty => ({
  type: 'object',
  description: `${description} Each step its default when left out; a multiplier is a count of the layer's voxels.`,
  properties: {
    voxelClamp: int("The most voxels across the bounds' diagonal (default 1024).", 64, 1290),
    autoThicken: flag('Whether a thin part is thickened by a shell (default true).'),
    thicknessMultiplier: num(
      'The thickness a thin part is brought to, in voxels (default 1.5).',
      0.001,
    ),
    ignoreTinyParts: flag('Whether a tiny thin part is dropped (default true).'),
    tinyPartMultiplier: num('The size a thin part is tiny under, in voxels (default 0.05).', 0.001),
    windingThreshold: num(
      'The winding number past which a point is inside (default 0.5).',
      0.01,
      0.99,
    ),
    fillGaps: flag('Whether the gaps are closed by a morphological closing (default true).'),
    gapDistance: num('The widest gap closed, metres (default 0.1).', 0.001),
    occlusion: {
      type: 'string',
      enum: ['visibility', 'none'],
      description:
        'Which hidden triangles are dropped: those no ray from outside reaches, or none (default visibility).',
    },
    occludeFromBelow: flag(
      'Whether a floor under the shell hides what only faces down (default true).',
    ),
    simplification: {
      type: 'string',
      enum: ['geometricTolerance', 'trianglesPerArea', 'fixedTriangleCount'],
      description:
        "What the shell is simplified to: the layer's deviation, trianglesPerSquareMetre of its area, or triangleCount triangles (default geometricTolerance).",
    },
    triangleCount: int(
      'The triangles a fixedTriangleCount shell keeps (default 2000).',
      16,
      2147483647,
    ),
    trianglesPerSquareMetre: num(
      'The triangles a trianglesPerArea shell keeps per square metre, up to the largest single-precision number (default 2).',
      0.01,
    ),
    simplifyPrePass: flag(
      'Whether a fast collapse pass goes first on a dense shell (default true).',
    ),
    hardNormals: flag(
      'Whether faces turning past hardNormalAngle get separate normals; otherwise one normal a vertex (default true).',
    ),
    hardNormalAngle: num('The crease angle, degrees (default 60).', 0, 90),
    uvMethod: {
      type: 'string',
      enum: ['charts', 'patches', 'uvAtlas'],
      description:
        'How the shell is unwrapped: charts grown by cost and flattened conformally, patches merged into islands, or charts cut by spectral analysis of the surface (default charts).',
    },
    uvAtlasStretch: num('The most stretch the uvAtlas charts may reach (default 0.1).', 0, 1),
    initialPatches: int("The patches unwrap's initial patch count (default 250).", 1, 99999999),
    curvatureAlignment: num(
      "The patches unwrap's weight of the normal's turn (default 1).",
      0.01,
      100,
    ),
    mergingThreshold: num(
      "The patches unwrap's area distortion an island may reach (default 1.5).",
      1,
    ),
    maxAngleDeviation: num(
      "The patches unwrap's normal deviation, degrees, two merged patches may differ by (default 45).",
      0,
      180,
    ),
    captureResolution: int(
      "Each view's side the bake reads the sources from, pixels; 0 the atlas side (default 2048).",
      0,
      16384,
    ),
    captureFieldOfView: num("Each view's horizontal field of view, degrees (default 30).", 5, 160),
    nearPlane: num("Each view's near plane, metres (default 0.01).", 0.00001, 10),
    multiSampling: int(
      'The atlas baked this many times larger per side, then averaged down; 0 or 1 none (default 0).',
      0,
      8,
    ),
    captureAnisotropy: int(
      "The most samples a view's texture read takes along its footprint's longer side, the views' sampler anisotropy (default 8).",
      1,
      16,
    ),
    maps: approximationMaps,
    baseCapping: choiceOrFlag(
      `How the scene's base is closed before the solid is read: ${HLOD_BASE_CAPPINGS[0]}; ${HLOD_BASE_CAPPINGS[1]}, the convex hull of the vertices within baseHeight above the scene's lowest point, flat there and facing down, which makes the scene read as open meshes; ${HLOD_BASE_CAPPINGS[2]}, that hull extruded up by baseThickness into a slab. true is ${DEFAULT_HLOD_BASE_CAPPING}, false ${HLOD_BASE_CAPPINGS[0]} (default ${DEFAULT_HLOD_BASE_CAPPING}).`,
      HLOD_BASE_CAPPINGS,
      'A capping.',
      `true ${DEFAULT_HLOD_BASE_CAPPING}, false ${HLOD_BASE_CAPPINGS[0]}.`,
    ),
    baseHeight: num(
      "The height above the scene's lowest point whose vertices the base cap hulls, metres; 0 twice the layer's accuracy (default 0).",
      0,
    ),
    baseThickness: num(
      "A convexSolid cap's thickness, metres; 0 the thickening's thickness when autoThicken, else 1.25 times the layer's accuracy (default 0).",
      0,
    ),
    groundClipping: choiceOrFlag(
      `How a horizontal plane at groundHeight clips the shell once its hidden triangles are dropped: ${HLOD_GROUND_CLIPPINGS[0]}; ${HLOD_GROUND_CLIPPINGS[1]}, the triangles whose corners all lie on or under it dropped with the hidden ones, only where the occlusion filter drops some; ${HLOD_GROUND_CLIPPINGS[2]}, cut along it and what lies under it removed; ${HLOD_GROUND_CLIPPINGS[3]}, cut and each cut loop filled flat. true is ${DEFAULT_HLOD_GROUND_CLIPPING}, false ${HLOD_GROUND_CLIPPINGS[0]} (default ${DEFAULT_HLOD_GROUND_CLIPPING}).`,
      HLOD_GROUND_CLIPPINGS,
      'A clipping.',
      `true ${DEFAULT_HLOD_GROUND_CLIPPING}, false ${HLOD_GROUND_CLIPPINGS[0]}.`,
    ),
    groundHeight: num("The ground plane's height, the world's up coordinate, metres (default 0)."),
    useRenderLODMeshes: flag(
      'Whether each source mesh is read as its vertex buffers hold it, its vertices split where its attributes are, rather than welded by position (default false).',
    ),
  },
})
