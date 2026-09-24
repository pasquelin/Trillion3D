/**
 * The images the prepared scene's textures sample, read from where the scene tables say they are —
 * an address beside the published document, or a view of its binary — and decoded the way the host
 * loader decoded them: an `ImageBitmap` with neither premultiplication nor colour conversion where
 * the platform offers one, an image element otherwise.
 *
 * An image whose whole mip chain the cache baked is not read: a one-pixel placeholder stands in its
 * place, and the engine reads the baked levels instead (`../../texture/skip.ts`). An image that
 * cannot be read or decoded is no image — its textures are left empty — as the loader left them.
 */
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts';
import { PLACEHOLDER_IMAGE } from '../../texture/skip.ts';
import type { ByteMeter } from '../../cluster/byteMeter.ts';

/** Decode options of the host loader: pixels as the file stores them. */
const BITMAP: ImageBitmapOptions = { premultiplyAlpha: 'none', colorSpaceConversion: 'none' };

/** An image element holding `url`, decoded: the path of a platform without `createImageBitmap`. */
async function element(url: string) {
  const image = new Image();
  if (!url.startsWith('data:')) image.crossOrigin = 'anonymous';
  image.src = url;
  await image.decode();
  return image;
}

async function decodeAddress(url: string, signal: AbortSignal | undefined, meter: ByteMeter) {
  if (typeof createImageBitmap !== 'function') return element(url);
  const response = meter(await fetch(url, { signal, credentials: 'same-origin' }));
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
  return createImageBitmap(await response.blob(), BITMAP);
}

async function decodeBytes(bytes: Uint8Array<ArrayBuffer>, type: string) {
  const blob = new Blob([bytes], { type });
  if (typeof createImageBitmap === 'function') return createImageBitmap(blob, BITMAP);
  const url = URL.createObjectURL(blob);
  try {
    return await element(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

type Inputs = {
  document: TableDocument;
  /** Address of the published document: relative image addresses resolve against it. */
  documentUrl: string;
  /** The document's binary, which embedded images are views of. */
  binary: ArrayBuffer | null;
  /** Resolved addresses of the images whose chain the cache baked. */
  skipped: ReadonlySet<string>;
  signal: AbortSignal | undefined;
  /** Wraps each read the way the session counts resources for its progress. */
  track: <T>(resource: string, read: Promise<T>) => Promise<T>;
  /** Counts the bytes of each image read as they arrive. */
  meter: ByteMeter;
};

/** The resolved address of an image's `uri`, as the skip set and the fetch both write it. */
export const imageAddress = (uri: string, documentUrl: string) => new URL(uri, documentUrl).href;

/**
 * The decoded image of each rank of the document, read on first request — only the images a worn
 * surface samples cross the network — or `null` when it could not be read.
 */
export function preparedImages(inputs: Inputs) {
  const { document, documentUrl, binary, skipped, signal, track, meter } = inputs;
  const read = async (rank: number): Promise<unknown> => {
    const image = document.images[rank];
    if (image.uri !== null) {
      const url = imageAddress(image.uri, documentUrl);
      const address = skipped.has(url) ? PLACEHOLDER_IMAGE : url;
      return track(address, decodeAddress(address, signal, meter));
    }
    if (image.view === null || !binary) throw new Error(`image ${rank} names no source`);
    const view = document.views[image.view];
    const bytes = new Uint8Array(binary, view.offset, view.length);
    return decodeBytes(bytes, image.mimeType ?? '');
  };
  const held = new Map<number, Promise<unknown>>();
  return (rank: number): Promise<unknown> => {
    let image = held.get(rank);
    if (!image) {
      image = read(rank).catch((error: unknown) => {
        signal?.throwIfAborted();
        console.error('Trillion3D: could not read image', rank, error);
        return null;
      });
      held.set(rank, image);
    }
    return image;
  };
}
