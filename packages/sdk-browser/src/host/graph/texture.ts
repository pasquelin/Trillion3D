/**
 * A TEXTURE OF THE ENGINE'S OWN GRAPH: an image, the sampler state it is read with and the
 * transform of its coordinates, at the reference's values until a scene says otherwise. The
 * constants are the engine's named ones (`../surfaceConstants.ts`).
 */
import { Matrix3 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { Vector2 } from '../../../../sdk-core/src/world/math/vector2.ts';
import {
  HOST_COLOUR_SPACE_NONE,
  HOST_FILTER_LINEAR,
  HOST_FILTER_LINEAR_MIP_LINEAR,
  HOST_MAPPING_UV,
  HOST_WRAP_CLAMP_TO_EDGE,
} from '../surfaceConstants.ts';
import { Releasable, identity } from './resource.ts';

/** An image and the sampler state it is read with, and the transform of its coordinates. */
export class GraphTexture extends Releasable {
  /** Tells a texture from any other field of a surface: a decoded picture, or raw texels
   *  (`image` holding `{ data, width, height }`). */
  kind: 'texture' | 'texels' = 'texture';
  /** A name unique to the texture. */
  readonly uuid = identity('texture');
  /** Its name. */
  name = '';
  /** How it is addressed: by a UV set. */
  mapping = HOST_MAPPING_UV;
  /** The UV set it reads. */
  channel = 0;
  /** How it repeats across. */
  wrapS = HOST_WRAP_CLAMP_TO_EDGE;
  /** How it repeats up. */
  wrapT = HOST_WRAP_CLAMP_TO_EDGE;
  /** Filter when shown bigger. */
  magFilter = HOST_FILTER_LINEAR;
  /** Filter when shown smaller. */
  minFilter = HOST_FILTER_LINEAR_MIP_LINEAR;
  /** Sharpness at a slant. */
  anisotropy = 1;
  /** How its numbers are read: `'srgb'`, `'srgb-linear'`, or `''` when it declares none. */
  colorSpace: string = HOST_COLOUR_SPACE_NONE;
  /** The coordinate transform: moved, stretched, turned about `center`. */
  readonly offset = new Vector2(0, 0);
  /** How many times it fits. */
  readonly repeat = new Vector2(1, 1);
  /** The pivot of the rotation. */
  readonly center = new Vector2(0, 0);
  /** The rotation, in radians. */
  rotation = 0;
  /** Whether `matrix` is rebuilt from the four above. */
  matrixAutoUpdate = true;
  /** The coordinate transform as three rows. */
  readonly matrix = new Matrix3();
  /** Whether smaller copies are made. */
  generateMipmaps = true;
  /** Whether colour is pre-multiplied by alpha. */
  premultiplyAlpha = false;
  /** Whether rows are flipped on upload. */
  flipY = true;
  /** Bumped by every declared change: what an upload compares to skip a re-copy. */
  version = 0;
  /** Free room for the data of whoever built the texture. */
  userData: Record<string, unknown> = {};
  /** The channels of a raw texture's texels (`HOST_FORMAT_*`). */
  declare format?: number;
  /** The decoded picture, in the container its decoder gave. */
  image: unknown;
  constructor(image: unknown = null) {
    super();
    this.image = image;
  }
  /** `needsUpdate = true` after a change: a reader uploads it again. */
  set needsUpdate(value: boolean) {
    if (value) this.version++;
  }
  get needsUpdate() {
    return false;
  }
  /** Rebuilds `matrix` from offset, repeat, rotation and centre. */
  updateMatrix() {
    const [tx, ty, sx, sy] = [this.offset.x, this.offset.y, this.repeat.x, this.repeat.y];
    const [cx, cy, c, s] = [
      this.center.x,
      this.center.y,
      Math.cos(this.rotation),
      Math.sin(this.rotation),
    ];
    // prettier-ignore
    this.matrix.set(
      sx * c, sx * s, -sx * (c * cx + s * cy) + cx + tx,
      -sy * s, sy * c, -sy * (-s * cx + c * cy) + cy + ty,
      0, 0, 1,
    );
  }
  /** A texture of the same image and state, announced as changed. */
  clone() {
    const copy = new GraphTexture(this.image);
    copy.name = this.name;
    copy.mapping = this.mapping;
    copy.channel = this.channel;
    copy.wrapS = this.wrapS;
    copy.wrapT = this.wrapT;
    copy.magFilter = this.magFilter;
    copy.minFilter = this.minFilter;
    copy.anisotropy = this.anisotropy;
    copy.colorSpace = this.colorSpace;
    copy.offset.set(this.offset.x, this.offset.y);
    copy.repeat.set(this.repeat.x, this.repeat.y);
    copy.center.set(this.center.x, this.center.y);
    copy.rotation = this.rotation;
    copy.matrixAutoUpdate = this.matrixAutoUpdate;
    copy.matrix.copy(this.matrix);
    copy.generateMipmaps = this.generateMipmaps;
    copy.premultiplyAlpha = this.premultiplyAlpha;
    copy.flipY = this.flipY;
    copy.userData = JSON.parse(JSON.stringify(this.userData)) as Record<string, unknown>;
    copy.needsUpdate = true;
    return copy;
  }
}

/** Whether a field of a surface is a texture of the graph: told by its `kind`, whatever its slot. */
export const isGraphTexture = (value: unknown): value is GraphTexture =>
  typeof value === 'object' &&
  value !== null &&
  'kind' in value &&
  (value.kind === 'texture' || value.kind === 'texels');
