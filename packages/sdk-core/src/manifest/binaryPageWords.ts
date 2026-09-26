/** Where each page's numbers sit in the page columns of the binary manifest (`binaryFormat.ts`):
 *  the slots of its `pageInt` and `pageU32` entries, and the bits of its flag word. */

/** `pageInt` slots. -1 is «absent or null»; the flag word says which. */
export const INT_ID = 0,
  INT_LEVEL = 1,
  INT_GROUP = 2,
  INT_SOURCE = 3,
  INT_STREAM = 4,
  INT_STREAM_OFFSET = 5,
  INT_COUNT = 6,
  INT_START = 7;
/** `pageU32` slots. */
export const U32_BYTES = 0,
  U32_FLAGS = 1;
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
