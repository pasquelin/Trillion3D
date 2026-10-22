import { retire } from '../../../gpu/core/frameRetire.ts'
import { madeTextureBytes } from '../../../gpu/core/textureBytes.ts'
import { MOTION_BLUR_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { createList } from '../../../gpu/dispatch/list.ts'
import {
  BASE_VARIANT,
  FLAT_FORMS,
  OUTPUT_FORMAT,
  TILE_DEPTH_FORMAT,
  TILE_FORMAT,
  classEntries,
  flattenTiles,
  sameVariant,
  tileClasses,
  type BlurVariant,
} from './motionBlurLayout.ts'

/** One image of the blur: its texture and the view the passes name. */
type Image = { texture: GPUTexture; view: GPUTextureView }

/** What the blur holds for an image size (`createMotionBlurTargets`): the flattened motion, and the
 *  two tile images and the depth the spread is drawn with; with two directions, the two images of
 *  the tiles' second largest motions beside the tile images. */
type Made = {
  flat: Image
  tilesA: Image
  tilesB: Image
  depth: Image
  secondsA?: Image
  secondsB?: Image
}

/** The error of a read before `ensure`. */
const fail = (): never => {
  throw new Error('MOTION_BLUR_TARGETS_MISSING')
}

/** Whether `a` and `b` name the same size. */
const same = (a: readonly number[], b: readonly number[]) => a[0] === b[0] && a[1] === b[1]

/** An `image` of `label` in a texture of `size`, `format` and `usage`. */
function imageOf(
  device: GPUDevice,
  label: string,
  [width, height]: readonly number[],
  format: GPUTextureFormat,
  usage: number,
): Image {
  const texture = device.createTexture({
    label: `${MOTION_BLUR_PASS} ${label}`,
    size: { width, height },
    format,
    usage,
  })
  return { texture, view: texture.createView() }
}

/** What a blur holds for a motion measured on a grid of at most `grid`: the motion flattened, in the
 *  form of the variant, and the tiles, at the grid, and with two directions the images of their
 *  second largest motions. */
function makeHeld(
  device: GPUDevice,
  grid: readonly number[],
  { directions, flat }: BlurVariant,
): Made {
  const STORAGE = GPUTextureUsage.STORAGE_BINDING,
    TEXTURE = GPUTextureUsage.TEXTURE_BINDING
  const tiles = [flattenTiles(grid[0]), flattenTiles(grid[1])]
  const spread = STORAGE | TEXTURE | GPUTextureUsage.RENDER_ATTACHMENT
  const seconds =
    directions > 1
      ? {
          secondsA: imageOf(device, 'second tiles', tiles, TILE_FORMAT, STORAGE | TEXTURE),
          secondsB: imageOf(device, 'spread second tiles', tiles, TILE_FORMAT, STORAGE | TEXTURE),
        }
      : {}
  return {
    ...seconds,
    flat: imageOf(device, 'flat', grid, FLAT_FORMS[flat].format, STORAGE | TEXTURE),
    tilesA: imageOf(device, 'tiles', tiles, TILE_FORMAT, STORAGE | TEXTURE),
    tilesB: imageOf(device, 'spread tiles', tiles, TILE_FORMAT, spread),
    depth: imageOf(
      device,
      'spread depth',
      tiles,
      TILE_DEPTH_FORMAT,
      GPUTextureUsage.RENDER_ATTACHMENT,
    ),
  }
}

/** The textures of what a blur holds. */
const texturesOf = ({ flat, tilesA, tilesB, depth, secondsA, secondsB }: Made) =>
  [flat, tilesA, tilesB, depth, secondsA, secondsB].filter((image) => image !== undefined)

/** The lists of the filter tiles of each blur of a chain, one a class (`tileClasses`), made at the
 *  first ask for the images' `extent` and retired together (`gpu/dispatch/list.ts`). */
function createClassLists(device: GPUDevice) {
  const made: (readonly GPUBuffer[] | undefined)[] = []
  return {
    of(nth: number, extent: readonly number[], directions: number) {
      return (made[nth] ??= tileClasses(directions).map((kind) =>
        createList(
          device,
          `${MOTION_BLUR_PASS} ${kind} tiles`,
          classEntries(extent[0], extent[1]),
          1,
        ),
      ))
    },
    get bytes() {
      let bytes = 0
      for (const held of made) for (const list of held ?? []) bytes += list.size
      return bytes
    },
    release() {
      for (const held of made) for (const list of held ?? []) retire(device, list)
      made.length = 0
    },
  }
}

/**
 * THE IMAGES AND BUFFERS OF THE MOTION BLUR, shared by every blur of a chain — they run one after
 * the other, each finished with them before the next begins:
 * - for the motion's grid, the largest it is measured on (`allocated`): the
 *   flattened motion, and, a tile of `FLATTEN_TILE` texels each, the tile ranges, twice — what
 *   the flattening wrote and what the spread made of it — and the depth the spread is drawn with;
 * - the blurred images, as many as the chain's blurs ask, at most two, and the image a second pass
 *   of the blur reads (`separable`), made as they are asked;
 * - the lists of the filter tiles of each class (`lists`), four for each blur of the chain — five
 *   with two directions, which also keep the images of the tiles' second largest motions —, as many
 *   entries as the images' extent holds tiles, made as they are asked: a blur's are filled and
 *   read within its own passes, but every blur of an image is submitted together, so no two share
 *   a list.
 * All are made again when a size moves; `generation` counts the times, so the groups naming them
 * are made again. A resource replaced is retired, destroyed once the frame that may name it is
 * submitted.
 */
export function createMotionBlurTargets(device: GPUDevice) {
  let size: readonly number[] = [0, 0],
    allocated: readonly number[] = [0, 0],
    variant = BASE_VARIANT,
    made: Made | undefined,
    generation = 0
  const images: (Image | undefined)[] = [],
    classLists = createClassLists(device)
  const every = (): Image[] => [
    ...images.filter((image) => image !== undefined),
    ...(made ? texturesOf(made) : []),
  ]
  const drop = () => {
    for (const { texture } of every()) retire(device, texture)
    images.length = 0
    classLists.release()
    made = undefined
  }
  return {
    /** Counts the times what the passes name was made again. */
    get generation() {
      return generation
    },
    /** Makes what a blur needs for images in textures of `extent` — the image's own size, or the
     *  largest a frame is drawn at, the image lying in their top-left — and a motion measured on a
     *  grid of at most `grid`, drawn by the programs of `wanted`: remade where a size or it moved. */
    ensure(extent: readonly number[], grid: readonly number[], wanted = BASE_VARIANT) {
      if (made && same(size, extent) && same(allocated, grid) && sameVariant(variant, wanted))
        return
      drop()
      size = [extent[0], extent[1]]
      allocated = [grid[0], grid[1]]
      variant = wanted
      made = makeHeld(device, allocated, variant)
      generation++
    },
    /** What the flattening, the spread and the classifying write and the filter reads. */
    get held(): Made {
      return made ?? fail()
    },
    /** The `at`-th blurred image of the size `ensure` was given, made at the first ask: 0 and 1 for
     *  the blurs of a chain, taking turns, 2 for the image a second pass of one reads. */
    output(at: number): Image {
      const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING
      return (images[at] ??= imageOf(device, `image ${at}`, size, OUTPUT_FORMAT, usage))
    },
    /** The lists of the filter tiles of the `nth` blur, one a class (`tileClasses`). */
    lists: (nth: number) => classLists.of(nth, size, variant.directions),
    /** Bytes of every image and list made. */
    get bytes() {
      return every().reduce((sum, { texture }) => sum + madeTextureBytes(texture), classLists.bytes)
    },
    /** Frees everything. */
    release() {
      drop()
      size = allocated = [0, 0]
      generation++
    },
  }
}

/** The targets of the blur (`createMotionBlurTargets`). */
export type MotionBlurTargets = ReturnType<typeof createMotionBlurTargets>
