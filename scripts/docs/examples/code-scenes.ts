import { writeAvenue } from './avenue.ts';
import { writeChessObj } from './chess-obj.ts';
import { writeChessSet } from './chess-set.ts';
import { writeCourtyard } from './courtyard.ts';
import { writeFlag } from './flag.ts';
import { writeRing } from './ring.ts';
import { writeTerrain } from './terrain.ts';
import { writeTerrainTiles } from './terrain-tiles.ts';

/** A scene modelled in code: it reads no model, its writer draws every file of its folder. */
const inCode =
  (write: (directory: string) => Promise<void>) => (_models: string, directory: string) =>
    write(directory);

/** The example scenes modelled in code, beside the imported models of `models.ts`. */
export const codeScenes = {
  'a-model-from-obj': inCode(writeChessObj),
  'a-model-from-usdz': inCode(writeChessSet),
  'compressed-textures': inCode(writeCourtyard),
  'detail-by-pixel-error': inCode(writeAvenue),
  'ten-thousand-objects': inCode(writeRing),
  terrain: inCode(writeTerrain),
  'terrain-tiles': inCode(writeTerrainTiles),
  flag: inCode(writeFlag),
};
