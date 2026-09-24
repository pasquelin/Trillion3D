import type { EntryNote } from '../model.ts';

/** Constants and enums of the image and its quality, each read from the file named in `module`. */

export const ENUMS_IMAGE: EntryNote[] = [
  {
    id: 'IDENTITY_MATRIX4',
    valueNames: ['[1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1]'],
    replaces: 'Matrix4.identity()',
    example: `import { IDENTITY_MATRIX4, copyMatrix4 } from 'trillion3d';

copyMatrix4(nodeTransform, IDENTITY_MATRIX4); // reset, no allocation`,
  },
  {
    id: 'DiagnosticMode',
    valueNames: [
      "'beauty'",
      "'wireframe'",
      "'clusters'",
      "'lod'",
      "'screen-error'",
      "'materials'",
      "'visibility'",
      "'pages'",
      "'texture-mip'",
      "'overdraw'",
    ],
    example: `import { DIAGNOSTICS } from 'trillion3d';

world.diagnostic.mode = 'clusters';
console.log(DIAGNOSTICS['overdraw']); // { available: false, reason: 'No fragment counter' }`,
  },
  {
    id: 'LodQualityId',
    valueNames: ["'source'", "'high'", "'balanced'", "'adaptive'"],
    example: `import { LOD_QUALITY, lodQuality } from 'trillion3d';

const { pixelError } = lodQuality('balanced'); // 4; an unknown id throws
world.pixelError = pixelError; // the world's own property reads the same threshold back
console.log(world.pixelError);`,
  },
  {
    id: 'ScreenErrorVariant',
    valueNames: ["'certifiee'", "'reference'"],
    example: `import { screenErrorVariant, setScreenErrorVariant } from 'trillion3d';

setScreenErrorVariant('reference'); // null or undefined restores 'certifiee'
console.log(screenErrorVariant());`,
  },
];
