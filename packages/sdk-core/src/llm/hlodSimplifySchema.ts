import { HLOD_NORMAL_METHODS, HLOD_TRANSFER_RAYS } from '../contracts/compilerAbi.ts'
import { flag, int, num } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** A simplify layer's own settings (`HlodSimplifySettings`). */
export const simplifySettings: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  type: 'object',
  description:
    "A simplify layer's own settings: its objects remeshed through their volume (a signed distance field, its gaps closed, its surface drawn), simplified for the distance the actor is first drawn from, charted, and their materials transferred onto the atlas by rays. Lengths in metres.",
  properties: {
    voxel: num(
      "The voxel the sources are sampled on; omit it to derive it from the screen size the actor is first drawn at (the bounds' largest side over that pixel count, held from 50 to 900, times 0.65).",
      0.001,
    ),
    gapWidth: num('The widest gap closed between the sources (default 0, none).', 0),
    unresolvedColor: {
      type: 'array',
      items: int('Red, green, then blue.', 0, 255),
      description:
        'The base colour, three sRGB bytes, of a texel the transfer finds no source for (default [0, 0, 0]).',
    },
    transferDistance: num(
      "How far a transfer ray looks for the sources (default six voxels), never under a voxel nor past the bounds' largest side.",
      0,
    ),
    hardAngle: {
      description:
        'The angle, degrees, two faces split their vertices past; true 130, false none (default false).',
      anyOf: [num('Degrees.', 0, 180), flag('true 130, false none.')],
    },
    normalMethod: {
      type: 'string',
      enum: [...HLOD_NORMAL_METHODS],
      description: `How the vertex normals weigh the faces around a vertex: by the angle each makes there, its area, or alike (default ${HLOD_NORMAL_METHODS[0]}).`,
    },
    gapSteps: int(
      "The most dilation steps each way the gap closing takes on the sources' own grid before it steps on a coarser one; 0 closes no gap (default 7).",
      0,
      64,
    ),
    transferRays: {
      type: 'string',
      enum: [...HLOD_TRANSFER_RAYS],
      description: `How a transfer ray, one each way along a texel's normal, picks its hit: the nearer, or a source facing the ray's way first (default ${HLOD_TRANSFER_RAYS[0]}).`,
    },
    separateFoldedWalls: flag(
      'Whether faces the simplification folded into one another are pushed apart, each a seventh of a voxel along its normal (default false).',
    ),
    serialSimplify: flag(
      'Whether the simplification runs as one pass over the whole mesh rather than in slabs first (default false).',
    ),
  },
}))()
