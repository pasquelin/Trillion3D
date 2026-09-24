/**
 * The engine record of a host texture, read in one place — here — and kept ONE per host texture:
 * atlas layers, preview ranks and lane pools address a texture by the identity of its record, so
 * the record is refilled in place, once per image, by `followHostTexture`, called by each consumer
 * on the records it holds. Its three counters say what moved: `version` (the picture), `sampling`,
 * `placement` (#360, #361).
 */
import type { HostTexture } from './resources.ts';
import {
  HOST_FILTER_LINEAR_MIP_LINEAR,
  HOST_FILTER_LINEAR_MIP_NEAREST,
  HOST_FILTER_NEAREST,
  HOST_FILTER_NEAREST_MIP_LINEAR,
  HOST_FILTER_NEAREST_MIP_NEAREST,
  HOST_WRAP_CLAMP_TO_EDGE,
  HOST_WRAP_MIRRORED_REPEAT,
} from './surfaceConstants.ts';
import type { Texture, TextureFilter, WrapMode } from '../../../sdk-core/src/index.ts';

/** Addressing the host declared, in the engine's words; anything else repeats, as the samplers do. */
export function importWrapMode(wrap: number): WrapMode {
  if (wrap === HOST_WRAP_CLAMP_TO_EDGE) return 'clamp';
  return wrap === HOST_WRAP_MIRRORED_REPEAT ? 'mirror' : 'repeat';
}

/** Filtering the host declared; an unknown constant reads linear, as the binders already did. */
function filterOf(filter: number): TextureFilter {
  if (filter === HOST_FILTER_NEAREST) return 'nearest';
  if (filter === HOST_FILTER_NEAREST_MIP_NEAREST) return 'nearest-mip-nearest';
  if (filter === HOST_FILTER_NEAREST_MIP_LINEAR) return 'nearest-mip-linear';
  if (filter === HOST_FILTER_LINEAR_MIP_NEAREST) return 'linear-mip-nearest';
  return filter === HOST_FILTER_LINEAR_MIP_LINEAR ? 'linear-mip-linear' : 'linear';
}

type Editable = { -readonly [K in keyof Texture]: Texture[K] };
/**
 * A record and what it was last filled from: the host's version and image, and the placement
 * its matrix was composed from (`placed`); `stale` when the host disposed of it since, and the
 * image it was last followed at (`followed`).
 */
type Imported = {
  host: HostTexture;
  record: Editable;
  hostVersion: number;
  image: unknown;
  placed: Float64Array;
  stale: boolean;
  followed: number;
};
/** One record per host texture, for as long as the host keeps it: an identity table, never
 *  walked — each consumer follows the records it holds. */
const imported = new WeakMap<HostTexture, Imported>();
/** The same entries, by record: what `followHostTexture` looks a record up in. */
const byRecord = new WeakMap<Texture, Imported>();

/** Writes `value` at `i`; 1 when it moved. */
function put(into: Float64Array, i: number, value: number) {
  if (into[i] === value) return 0;
  into[i] = value;
  return 1;
}

/** Refills the record's picture fields from its host. */
function fillPicture(entry: Imported) {
  const { record, host } = entry;
  record.id = host.uuid;
  record.name = host.name;
  record.image = host.image;
  record.channel = host.channel;
  record.flipY = host.flipY;
  record.premultiplyAlpha = host.premultiplyAlpha;
  record.generateMipmaps = host.generateMipmaps;
  record.colorSpace = host.colorSpace === 'srgb' ? 'srgb' : 'linear';
  entry.hostVersion = host.version;
  entry.image = host.image;
}

/** Refills the record's sampler fields; 1 when one moved. */
function fillSampling(record: Editable, host: HostTexture) {
  const wrapS = importWrapMode(host.wrapS),
    wrapT = importWrapMode(host.wrapT),
    magFilter = filterOf(host.magFilter),
    minFilter = filterOf(host.minFilter);
  if (
    record.wrapS === wrapS &&
    record.wrapT === wrapT &&
    record.magFilter === magFilter &&
    record.minFilter === minFilter &&
    record.anisotropy === host.anisotropy
  )
    return 0;
  Object.assign(record, { wrapS, wrapT, magFilter, minFilter, anisotropy: host.anisotropy });
  return 1;
}

/** Recomposes the host's UV matrix, which the record aliases, when a source of it moved: the
 *  seven scalars the host composes it from, or its six affine entries when the page owns it
 *  (`matrixAutoUpdate` false). No trigonometry for a texture that stays put. 1 when it moved. */
function fillPlacement(host: HostTexture, placed: Float64Array) {
  const e = host.matrix.elements;
  if (!host.matrixAutoUpdate)
    return (
      put(placed, 0, e[0]) |
      put(placed, 1, e[1]) |
      put(placed, 2, e[3]) |
      put(placed, 3, e[4]) |
      put(placed, 4, e[6]) |
      put(placed, 5, e[7]) |
      put(placed, 6, 0)
    );
  const { offset, repeat, center } = host;
  const moved =
    put(placed, 0, offset.x) |
    put(placed, 1, offset.y) |
    put(placed, 2, repeat.x) |
    put(placed, 3, repeat.y) |
    put(placed, 4, host.rotation) |
    put(placed, 5, center.x) |
    put(placed, 6, center.y);
  if (moved) host.updateMatrix();
  return moved;
}

/**
 * The image a follow belongs to: one per task — the host's animation-frame callback renders
 * every engine of its image in one —, opened by the first follow of the task and closed after
 * it. A record is brought up to its host once per image, whichever engine asks first.
 */
let image = 0,
  imageOpen = false;
function currentImage() {
  if (!imageOpen) {
    imageOpen = true;
    image++;
    queueMicrotask(() => (imageOpen = false));
  }
  return image;
}

/**
 * The engine record of a host texture: built once, its UV matrix composed at once — a
 * `KHR_texture_transform` is read at load (`../scene/tables.ts`) —, then brought up to its host
 * once per image by `followHostTexture`. The record ALIASES the host's UV matrix (`transform`).
 * A host that disposes of a texture it still draws keeps its record: the picture is sent again at
 * the next follow, as the host's own renderer uploads it again at its next use.
 */
export function importHostTexture(host: HostTexture): Texture {
  const held = imported.get(host);
  if (held) return held.record;
  const entry: Imported = {
    host,
    record: Object.assign({} as Editable, {
      version: 0,
      sampling: 0,
      placement: 0,
      transform: host.matrix.elements,
    }),
    hostVersion: 0,
    image: undefined,
    placed: new Float64Array(7).fill(NaN),
    stale: false,
    followed: 0,
  };
  fillPicture(entry);
  fillSampling(entry.record, host);
  fillPlacement(host, entry.placed);
  imported.set(host, entry);
  byRecord.set(entry.record, entry);
  host.addEventListener?.('dispose', () => (entry.stale = true));
  return entry.record;
}

/**
 * Brings a record up to its host, once per image, before a consumer reads it — as the host's own
 * renderer reads its textures at every draw: a new version, image or disposal, a sampler field, a
 * placement, a filter written after `needsUpdate` included. Its three counters, monotonic, say
 * what moved (`version`: the picture, `sampling`, `placement`); each consumer compares them with
 * the ones it last read. A record that no host texture made is left as it is.
 */
export function followHostTexture(record: Texture) {
  const entry = byRecord.get(record);
  if (!entry) return;
  const now = currentImage();
  if (entry.followed === now) return;
  entry.followed = now;
  const { host, record: into } = entry;
  if (entry.stale || entry.hostVersion !== host.version || entry.image !== host.image) {
    entry.stale = false;
    fillPicture(entry);
    into.version++;
  }
  if (fillSampling(into, host)) into.sampling++;
  if (fillPlacement(host, entry.placed)) into.placement++;
}
