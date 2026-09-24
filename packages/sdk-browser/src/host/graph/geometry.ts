/**
 * THE GEOMETRY OF THE ENGINE'S OWN GRAPH: the attributes a mesh draws (`attributes.ts`), the
 * triangle list they are indexed through, the morph targets that move them, and the local box and
 * sphere computed over them — every vertex spanned, the morph targets included, as the reference
 * spans them.
 */
import { Box3 } from '../../../../sdk-core/src/world/math/box3.ts';
import { Sphere } from '../../../../sdk-core/src/world/math/volumes.ts';
import { Vector3 } from '../../../../sdk-core/src/world/math/vector3.ts';
import type { GraphAttribute, GraphElements } from './attributes.ts';
import { Releasable } from './resource.ts';

/** The box of an attribute's vertices, written into `min` and `max` (six numbers). */
function spanInto(into: Float64Array, attribute: GraphElements) {
  into.set([Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]);
  for (let i = 0; i < attribute.count; i++)
    for (let c = 0; c < 3; c++) {
      const v = attribute.getComponent(i, c);
      into[c] = Math.min(into[c], v);
      into[3 + c] = Math.max(into[3 + c], v);
    }
}

/** Grows the box `into` by `point` (three numbers at `at`). */
function grow(into: Float64Array, point: ArrayLike<number>, at: number) {
  for (let c = 0; c < 3; c++) {
    into[c] = Math.min(into[c], point[at + c]);
    into[3 + c] = Math.max(into[3 + c], point[at + c]);
  }
}

/** Scratch of the bounds below. */
const whole = new Float64Array(6),
  morph = new Float64Array(6),
  sum = new Float64Array(3);

/**
 * The attributes a mesh draws, the triangle list they are indexed through, the morph targets that
 * move them, and the local box and sphere computed over them.
 */
export class GraphGeometry extends Releasable {
  /** Always `true`: tells a geometry apart. */
  readonly isBufferGeometry = true as const;
  /** The kind, as a renderer names it. */
  readonly type = 'BufferGeometry';
  /** Its name. */
  name = '';
  /** The triangle list, or `null` to draw the vertices in order. */
  index: GraphAttribute | null = null;
  /** Its vertex attributes, by name. */
  attributes: Record<string, GraphElements> = {};
  /** Per morphed attribute, one attribute per morph target. */
  morphAttributes: Record<string, GraphElements[]> = {};
  /** True when a morph target holds displacements, not positions. */
  morphTargetsRelative = false;
  /** Ranges of the index drawn with one surface each. */
  groups: { start: number; count: number; materialIndex?: number }[] = [];
  /** The range of the index drawn. */
  drawRange = { start: 0, count: Infinity };
  /** The local box, once computed or declared. */
  boundingBox: Box3 | null = null;
  /** The local sphere, once computed or declared. */
  boundingSphere: Sphere | null = null;
  /** Free room for the data of whoever built the geometry. */
  userData: Record<string, unknown> = {};

  /** The triangle list. */
  getIndex() {
    return this.index;
  }
  /** Sets the triangle list. */
  setIndex(index: GraphAttribute | null) {
    this.index = index;
    return this;
  }
  /** The attribute of that name. */
  getAttribute(name: string) {
    return this.attributes[name];
  }
  /** Names an attribute. */
  setAttribute(name: string, attribute: GraphElements) {
    this.attributes[name] = attribute;
    return this;
  }
  /** Forgets an attribute. */
  deleteAttribute(name: string) {
    delete this.attributes[name];
    return this;
  }
  /** Whether it has an attribute of that name. */
  hasAttribute(name: string) {
    return this.attributes[name] !== undefined;
  }
  /** The box of the positions, and of every shape a morph target gives them. */
  private span() {
    const position = this.attributes.position;
    if (!position) return false;
    spanInto(whole, position);
    for (const target of this.morphAttributes.position ?? []) {
      spanInto(morph, target);
      if (this.morphTargetsRelative) {
        for (let c = 0; c < 3; c++) sum[c] = whole[c] + morph[c];
        grow(whole, sum, 0);
        for (let c = 0; c < 3; c++) sum[c] = whole[3 + c] + morph[3 + c];
        grow(whole, sum, 0);
      } else {
        grow(whole, morph, 0);
        grow(whole, morph, 3);
      }
    }
    return true;
  }
  /** Computes the local box over every vertex. */
  computeBoundingBox() {
    this.boundingBox ??= new Box3();
    if (this.span())
      this.boundingBox.set(
        { x: whole[0], y: whole[1], z: whole[2] },
        { x: whole[3], y: whole[4], z: whole[5] },
      );
    else this.boundingBox.makeEmpty();
  }
  /** Computes the local sphere: centred on the box, reaching the farthest vertex. */
  computeBoundingSphere() {
    this.boundingSphere ??= new Sphere();
    const position = this.attributes.position;
    if (!position || !this.span()) return;
    const empty = whole[3] < whole[0] || whole[4] < whole[1] || whole[5] < whole[2];
    const cx = empty ? 0 : (whole[0] + whole[3]) * 0.5,
      cy = empty ? 0 : (whole[1] + whole[4]) * 0.5,
      cz = empty ? 0 : (whole[2] + whole[5]) * 0.5;
    let far = 0;
    const reach = (x: number, y: number, z: number) => {
      const dx = cx - x,
        dy = cy - y,
        dz = cz - z;
      far = Math.max(far, dx * dx + dy * dy + dz * dz);
    };
    for (let i = 0; i < position.count; i++)
      reach(position.getX(i), position.getY(i), position.getZ(i));
    for (const target of this.morphAttributes.position ?? [])
      for (let j = 0; j < target.count; j++) {
        let [x, y, z] = [target.getX(j), target.getY(j), target.getZ(j)];
        if (this.morphTargetsRelative) {
          x += position.getX(j);
          y += position.getY(j);
          z += position.getZ(j);
        }
        reach(x, y, z);
      }
    this.boundingSphere.center = new Vector3(cx, cy, cz);
    this.boundingSphere.radius = Math.sqrt(far);
  }
}
