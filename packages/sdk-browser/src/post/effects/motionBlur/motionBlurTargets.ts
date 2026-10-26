import { retire } from '../../../gpu/core/frameRetire.ts'
import { madeBytesOf } from '../../../gpu/core/textureBytes.ts'
import { MOTION_BLUR_PASS } from '../../../diagnostic/stage/passLabels.ts'
import { createList } from '../../../gpu/dispatch/list.ts'
import { HALF_IMAGE_FORMAT, halfSize } from '../../filters/levelSizes.ts'
import { imageOf as madeImage } from '../../filters/sizedImage.ts'
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

/** The usage of an image a pass writes and another reads. */
const storedAndRead = () => GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING

/** The `at`-th of the `list`, made by `make` at the first ask. */
const slot = <T>(list: (T | undefined)[], at: number, make: () => T): T => (list[at] ??= make())

/** The images of `list` that are made. */
const madeOf = (list: readonly (Image | undefined)[]) => list.filter((image) => image !== undefined)

/** An `image` of `label` in a texture of `size`, `format` and `usage`. */
const imageOf = (
  device: GPUDevice,
  label: string,
  size: readonly number[],
  format: GPUTextureFormat,
  usage: number,
): Image => madeImage(device, `${MOTION_BLUR_PASS} ${label}`, size, format, usage)

/** What a blur holds for a motion measured on a grid of at most `grid`: the motion flattened, in the
 *  form of the variant, and the tiles, at the grid, and with two directions the images of their
 *  second largest motions. */
function makeHeld(
  device: GPUDevice,
  grid: readonly number[],
  { directions, flat }: BlurVariant,
): Made {
  const tiles = [flattenTiles(grid[0]), flattenTiles(grid[1])]
  const spread = storedAndRead() | GPUTextureUsage.RENDER_ATTACHMENT
  const seconds =
    directions > 1
      ? {
          secondsA: imageOf(device, 'second tiles', tiles, TILE_FORMAT, storedAndRead()),
          secondsB: imageOf(device, 'spread second tiles', tiles, TILE_FORMAT, storedAndRead()),
        }
      : {}
  return {
    ...seconds,
    flat: imageOf(device, 'flat', grid, FLAT_FORMS[flat].format, storedAndRead()),
    tilesA: imageOf(device, 'tiles', tiles, TILE_FORMAT, storedAndRead()),
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
  madeOf([flat, tilesA, tilesB, depth, secondsA, secondsB])

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

/** What `createMotionBlurTargets` keeps: the sizes the images were made for, the variant, what the
 *  passes share, the blurred and half-size images, the tile lists and the count of remakes. */
type Store = {
  device: GPUDevice
  size: readonly number[]
  allocated: readonly number[]
  variant: BlurVariant
  made: Made | undefined
  generation: number
  images: (Image | undefined)[]
  halves: (Image | undefined)[]
  classLists: ReturnType<typeof createClassLists>
}

/** The empty store of a device: nothing made yet. */
const newStore = (device: GPUDevice): Store => ({
  device,
  size: [0, 0],
  allocated: [0, 0],
  variant: BASE_VARIANT,
  made: undefined,
  generation: 0,
  images: [],
  halves: [],
  classLists: createClassLists(device),
})

/** Every image made. */
const everyImage = (store: Store): Image[] => [
  ...madeOf(store.images),
  ...madeOf(store.halves),
  ...(store.made ? texturesOf(store.made) : []),
]

/** Retires every image and list made. */
function dropStore(store: Store) {
  for (const { texture } of everyImage(store)) retire(store.device, texture)
  store.images.length = 0
  store.halves.length = 0
  store.classLists.release()
  store.made = undefined
}

/** Makes what a blur needs for images in textures of `extent` and a motion measured on a grid of
 *  at most `grid`, drawn by the programs of `wanted`: remade where a size or it moved. */
function ensureStore(
  store: Store,
  extent: readonly number[],
  grid: readonly number[],
  wanted: BlurVariant,
) {
  const { size, allocated, variant, made } = store
  if (made && same(size, extent) && same(allocated, grid) && sameVariant(variant, wanted)) return
  dropStore(store)
  store.size = [extent[0], extent[1]]
  store.allocated = [grid[0], grid[1]]
  store.variant = wanted
  store.made = makeHeld(store.device, store.allocated, wanted)
  store.generation++
}

/**
 * THE IMAGES AND BUFFERS OF THE MOTION BLUR, shared by every blur of a chain — they run one after
 * the other, each finished with them before the next begins:
 * - for the motion's grid, the largest it is measured on (`allocated`): the
 *   flattened motion, and, a tile of `FLATTEN_TILE` texels each, the tile ranges, twice — what
 *   the flattening wrote and what the spread made of it — and the depth the spread is drawn with;
 * - the blurred images, as many as the chain's blurs ask, at most two, the half-size image beside
 *   each (`half`) and the image a second pass of the blur reads (`separable`), made as they are
 *   asked;
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
  const store = newStore(device)
  return {
    /** Counts the times what the passes name was made again. */
    get generation() {
      return store.generation
    },
    /** Makes what a blur needs for images in textures of `extent` — the image's own size, or the
     *  largest a frame is drawn at, the image lying in their top-left — and a motion measured on a
     *  grid of at most `grid`, drawn by the programs of `wanted`: remade where a size or it moved. */
    ensure(extent: readonly number[], grid: readonly number[], wanted = BASE_VARIANT) {
      ensureStore(store, extent, grid, wanted)
    },
    /** What the flattening, the spread and the classifying write and the filter reads. */
    get held(): Made {
      return store.made ?? fail()
    },
    /** The `at`-th blurred image of the size `ensure` was given, made at the first ask: 0 and 1 for
     *  the blurs of a chain, taking turns, 2 for the image a second pass of one reads. */
    output(at: number): Image {
      return slot(store.images, at, () =>
        imageOf(device, `image ${at}`, store.size, OUTPUT_FORMAT, storedAndRead()),
      )
    },
    /** The half-size image the filter writes beside the `at`-th blurred image (0 or 1), made at the
     *  first ask: half the size `ensure` was given, rounded up. */
    half(at: number): Image {
      return slot(store.halves, at, () =>
        imageOf(
          device,
          `half ${at}`,
          halfSize(store.size[0], store.size[1]),
          HALF_IMAGE_FORMAT,
          storedAndRead(),
        ),
      )
    },
    /** The lists of the filter tiles of the `nth` blur, one a class (`tileClasses`). */
    lists: (nth: number) => store.classLists.of(nth, store.size, store.variant.directions),
    /** Bytes of every image and list made. */
    get bytes() {
      return madeBytesOf(everyImage(store).map(({ texture }) => texture)) + store.classLists.bytes
    },
    /** Frees everything. */
    release() {
      dropStore(store)
      store.size = store.allocated = [0, 0]
      store.generation++
    },
  }
}

/** The targets of the blur (`createMotionBlurTargets`). */
export type MotionBlurTargets = ReturnType<typeof createMotionBlurTargets>
