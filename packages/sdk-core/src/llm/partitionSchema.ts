import {
  DEFAULT_PARTITION_CELL_SIZE,
  DEFAULT_PARTITION_LOADING_RANGE,
  DEFAULT_PARTITION_PRIORITY,
  MAX_PARTITION_PRIORITY,
} from '../contracts/compilerAbi.ts'
import {
  DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING,
  DEFAULT_PARTITION_FLAT,
  DEFAULT_PARTITION_NESTED_LEVELS,
  DEFAULT_PARTITION_PULL_COARSER,
  DEFAULT_PARTITION_SCHEME,
  DEFAULT_PARTITION_SMALL_BY_CENTRE,
  DEFAULT_PARTITION_STREAM_BOUNDS,
  PARTITION_SCHEMES,
  PARTITION_STREAM_BOUNDS,
} from '../contracts/partitionOptions.ts'
import { choiceOrFlag, flag, int, num } from './schemaParts.ts'
import type { JsonSchemaProperty } from './types.ts'

/** The `partitionScheme` option (`partitionOptions.ts`, `resolvePartitionScheme`). */
export const partitionScheme: JsonSchemaProperty = /* @__PURE__ */ (() =>
  choiceOrFlag(
    `How the spatially loaded objects are cut into cells and streamed. hashSet, the reference's default: a loose hierarchical grid with no top, an object in the cell under its centre at the level its size gives, each cell loading while the view comes within its grid's loading range of the box around its content, the cells of a higher level first; each HLOD level i on a grid of (2 << i) times the main grid's cell and range, the HLOD layers' own cellSize and loadingRange ignored. spatialHash: the older square hierarchical grid over the world, each cell loading by its square, an object no cell below the top holds always loaded, each HLOD layer on the grid its cellSize and loadingRange name. true is ${DEFAULT_PARTITION_SCHEME}. Default none: ${DEFAULT_PARTITION_SCHEME}, the cache key unchanged.`,
    PARTITION_SCHEMES,
    'A scheme.',
    `true ${DEFAULT_PARTITION_SCHEME}; false is refused: partitionGrid false turns the streaming off.`,
  ))()

/** The `partitionGrid` option (`partitionOptions.ts`, `resolvePartitionGrid`). */
export const partitionGrid: JsonSchemaProperty = /* @__PURE__ */ (() => ({
  description: `The partition's main grid, every spatially loaded object streaming on it (partitionScheme says how): its finest cells cellSize metres wide (default ${DEFAULT_PARTITION_CELL_SIZE}), doubled level by level, on origin [x, z] (default [0, 0]), each cell loaded while the view lies within loadingRange metres of it (default ${DEFAULT_PARTITION_LOADING_RANGE}), in the load order of priority among the grids, the lower the sooner (default ${DEFAULT_PARTITION_PRIORITY}; each HLOD grid's is 0 under hashSet, 100 plus its level under spatialHash). true names every default; false turns the streaming off: every object is loaded with the scene and no HLOD is built.`,
  anyOf: [
    flag('true every default, false the streaming off.'),
    {
      type: 'object',
      description: 'The settings it names over the defaults.',
      properties: {
        cellSize: num('Finest cell side, metres, above 0.', 0),
        loadingRange: num('Distance from the view, metres, above 0, within which a cell loads.', 0),
        priority: int(
          'Load priority among the grids, the lower the sooner.',
          0,
          MAX_PARTITION_PRIORITY,
        ),
        origin: {
          type: 'array',
          items: num('Metres.'),
          description:
            "The grid's origin, glTF x then z on the ground, or under hashSet x, y, z (its height read by a grid that does not lie flat alone).",
        },
        blockOnSlowStreaming: flag(
          `Whether, once the first image is shown and while the session's worldStreamingBlockOnSlowStreaming is on, a cell of this grid wished and not yet shown near the view holds the image back till it shows; the HLOD grids never do (default ${DEFAULT_PARTITION_BLOCK_ON_SLOW_STREAMING}).`,
        ),
        streamBounds: {
          type: 'string',
          enum: [...PARTITION_STREAM_BOUNDS],
          description: `hashSet alone: the bounds a cell of the finest level loads by: the box around its content, its cell's box (of unbounded height on a flat grid), or the first clipped to the second; a coarser cell always by its content (default ${DEFAULT_PARTITION_STREAM_BOUNDS}).`,
        },
        flat: flag(
          `hashSet alone: whether the grids lie flat on the ground; false, they cut height into cells too and a cell loads while the view comes within its range in 3D (default ${DEFAULT_PARTITION_FLAT}).`,
        ),
        hlodGrids: {
          type: 'array',
          description:
            "hashSet alone: each HLOD level's grid by level from 0; a level left out or null takes the main grid's cellSize and loadingRange times (2 << level).",
          items: {
            type: 'object',
            description:
              "One level's grid, each setting left out its default; null, every default.",
            properties: {
              cellSize: num('Finest cell side, metres.', 0),
              loadingRange: num('Distance from the view, metres, within which a cell loads.', 0),
            },
          },
        },
        nestedLevels: flag(
          `spatialHash alone: whether each level's cells nest in the next one's; false, each level below the top holds one cell more per side, its edges between those of the levels around it (default ${DEFAULT_PARTITION_NESTED_LEVELS}).`,
        ),
        pullCoarser: flag(
          `spatialHash alone: whether a wished cell pulls in every coarser cell below the top overlapping it, and those in turn, while the levels do not nest (default ${DEFAULT_PARTITION_PULL_COARSER}).`,
        ),
        smallByCentre: flag(
          `spatialHash alone: whether an object whose ground box is no larger than a finest cell goes to the finest cell under its centre (default ${DEFAULT_PARTITION_SMALL_BY_CENTRE}).`,
        ),
      },
    },
  ],
}))()
