/** The bits of a page's flag word, the second `pageU32` slot of the binary manifest
 *  (`binaryFormat.ts`). */
export const FLAG_ROLE = 1,
  FLAG_COARSE = 2,
  FLAG_GEOMETRY = 4,
  FLAG_CLUSTER_ERROR = 8,
  FLAG_PARENT_ERROR = 16,
  FLAG_PARENT_ERROR_FINITE = 32,
  FLAG_PARENT_SPHERE = 64,
  FLAG_PARENT_SPHERE_SET = 128,
  FLAG_GROUP = 256,
  FLAG_SOURCE = 512;
