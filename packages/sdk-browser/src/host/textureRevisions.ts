/**
 * The revisions of the engine records of host textures (#360, #361): which records a read refilled
 * or re-placed, for the readers that follow what they hold, and the host version followed where
 * the host writes it.
 */
import type { Texture } from '../../../sdk-core/src/index.ts';
import type { HostTexture } from './resources.ts';

/** The sets of the readers that follow the records (`watchTextureRevisions`). */
const watchers = new Set<Set<Texture>>();

/**
 * Adds to `into`, from now on, every record a read refilled or whose UV matrix it recomposed to
 * another placement (`importHostTexture`, `surfaceImport.ts`): a reader of what the records hold — the WebGPU sampling headers — follows
 * the records named there, and only those (#360, #361). Returns the call that stops it.
 */
export function watchTextureRevisions(into: Set<Texture>) {
  watchers.add(into);
  return () => void watchers.delete(into);
}

/** Names a refilled or re-placed record to the watchers. */
export const reviseTexture = (record: Texture) => {
  for (const into of watchers) into.add(record);
};

/**
 * The host bumps a texture's version on `needsUpdate` without touching the materials that hold it,
 * so a filter written then is read by no surface refill. The version the host writes is followed
 * where it is written: the record is refilled then. A host whose version is not a plain field is
 * left to the surface reads.
 */
export function followHostVersion(host: HostTexture, refill: (host: HostTexture) => unknown) {
  const own = Object.getOwnPropertyDescriptor(host, 'version');
  if (!own?.configurable || !own.writable) return;
  let version = own.value as number;
  Object.defineProperty(host, 'version', {
    configurable: true,
    enumerable: own.enumerable,
    get: () => version,
    set(value: number) {
      version = value;
      refill(host);
    },
  });
}
