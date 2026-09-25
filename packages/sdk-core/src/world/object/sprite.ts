import { Mesh } from './mesh.ts';
import { plane } from '../geometry/basic.ts';
import type { Material } from '../material/material.ts';
import { material as materials } from '../material/index.ts';
import { Vector2 } from '../math/vector2.ts';
import { listen } from '../math/observed.ts';

/**
 * A flat picture that always faces the camera: a unit square every renderer turns toward the
 * image at draw time, about the sprite's position.
 *
 * Its size is its world scale on `x` and `y`; its turn in the image plane is its material's
 * `rotation`; its own rotation is not read. A sprite casts no shadow.
 */
export class Sprite extends Mesh {
  /** Always `true`: tells a sprite apart from any other mesh. */
  readonly isSprite = true as const;
  /**
   * The point of the picture that sits on the sprite's position: `(0.5, 0.5)` its middle,
   * `(0, 0)` its bottom-left corner, `(0.5, 0)` the middle of its bottom edge.
   * @defaultValue (0.5, 0.5)
   */
  readonly center = new Vector2(0.5, 0.5);
  constructor(material?: Material) {
    super(plane(1, 1), material ?? materials.sprite(), 'sprite');
    listen(this.center, () => this._link?.content(this));
  }
  /** A shallow clone shares this sprite's geometry and material, and keeps its centre. */
  protected override blank(): this {
    const sprite = new Sprite(this.material as Material);
    sprite.geometry = this.geometry;
    sprite.center.copy(this.center);
    return sprite as this;
  }
}
