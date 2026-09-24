/**
 * The engine record of a host texture, read in one place — here — and kept ONE for the session:
 * atlas layers, preview ranks and lane pools address a texture by the identity of its record, so
 * the record is refilled in place, once per image, by `followHostTextures`. Its three counters say
 * what moved: `version` (the picture), `sampling`, `placement` (#360, #361).
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
/** A record and the placement its host was last composed from (`placed`). */
type Imported = { record: Editable; placed: Float64Array };
/** Every host texture imported, until the host disposes of it: what `followHostTextures` walks. */
const imported = new Map<HostTexture, Imported>();

/** Writes `value` at `i`; 1 when it moved. */
function put(into: Float64Array, i: number, value: number) {
  if (into[i] === value) return 0;
  into[i] = value;
  return 1;
}

/** Refills the record's picture fields from its host; its version is the host's. */
function fillPicture(record: Editable, host: HostTexture) {
  record.id = host.uuid;
  record.name = host.name;
  record.image = host.image;
  record.channel = host.channel;
  record.flipY = host.flipY;
  record.premultiplyAlpha = host.premultiplyAlpha;
  record.generateMipmaps = host.generateMipmaps;
  record.colorSpace = host.colorSpace === 'srgb' ? 'srgb' : 'linear';
  record.version = host.version;
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
      put(placed, 6, NaN)
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

/** Brings a record up to its host; true when anything moved. Its three counters say what: the
 *  host's version (the picture sent again), `sampling`, `placement`. */
function follow(host: HostTexture, { record, placed }: Imported) {
  let moved = 0;
  if (record.version !== host.version || record.image !== host.image) {
    fillPicture(record, host);
    moved = 1;
  }
  if (fillSampling(record, host)) {
    record.sampling++;
    moved = 1;
  }
  if (fillPlacement(host, placed)) {
    record.placement++;
    moved = 1;
  }
  return moved !== 0;
}

/**
 * The engine record of a host texture: built once, its UV matrix composed at once — a
 * `KHR_texture_transform` is read at load (`../scene/tables.ts`) —, then brought up to its host
 * once per image by `followHostTextures`. The record ALIASES the host's UV matrix (`transform`).
 */
export function importHostTexture(host: HostTexture): Texture {
  const held = imported.get(host);
  if (held) return held.record;
  const entry = {
    record: Object.assign({} as Editable, {
      sampling: 0,
      placement: 0,
      transform: host.matrix.elements,
    }),
    placed: new Float64Array(7).fill(NaN),
  };
  fillPicture(entry.record, host);
  fillSampling(entry.record, host);
  fillPlacement(host, entry.placed);
  imported.set(host, entry);
  host.addEventListener?.('dispose', () => imported.delete(host));
  return entry.record;
}

/** The records the last `followHostTextures` found moved. */
const moved = new Set<Texture>();

/**
 * Brings every imported record up to its host, once per image before any backend reads it, as
 * the host's own renderer reads its textures at every draw: a new version or image, a sampler
 * field, a placement — a filter written after `needsUpdate` included. Returns the records that
 * moved, whose counters say what; a backend looks up only those it holds. Nothing allocated.
 */
export function followHostTextures(): ReadonlySet<Texture> {
  moved.clear();
  for (const [host, entry] of imported) if (follow(host, entry)) moved.add(entry.record);
  return moved;
}
