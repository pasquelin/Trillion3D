import { object } from '../../../../sdk-core/src/world/object/index.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { Sprite } from '../../../../sdk-core/src/world/object/sprite.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';
import { Color, type ColorInput } from '../../../../sdk-core/src/world/math/color.ts';
import { texture } from '../texture/index.ts';
import { markHelper } from '../helper/mark.ts';
import { rasterLabel } from './raster.ts';

/** Text and placement of a camera-facing, depth-tested scene label. */
export interface LabelOptions {
  /** Text to paint, with newlines supported; the browser shapes Unicode and ligatures. */
  text: string;
  /** Bottom-centre position in the parent's coordinates. @defaultValue [0, 0, 0] */
  position?: readonly [number, number, number];
  /** Height of the whole label in world units before the parent's scale. @defaultValue 0.25 */
  height?: number;
  /** CSS canvas font; loading finishes before the label is attached. @defaultValue '32px sans-serif' */
  font?: string;
  /** Colour of the glyphs; their background is transparent. @defaultValue '#ffffff' */
  color?: ColorInput;
}

/** One label's scene object and owned resources. */
export interface LabelHandle {
  /** The ordinary sprite: position, scale and visibility use the scene's existing API. */
  readonly object: Sprite;
  /** Repaints changed text; a newer call or removal prevents an older result from being published. */
  setText(text: string): Promise<void>;
  /** Removes the sprite and releases its own texture, material and geometry; safe to repeat. */
  remove(): void;
}

/**
 * Adds readable text to a scene node, on WebGL2 and WebGPU through the existing sprite material.
 * The label faces the camera, tests scene depth, casts no shadow and is skipped by scene saving
 * and picking, like other helpers. Each image is limited to 2048 pixels a side (16 MiB), plus one replacement while updating;
 * text is limited to 16384 UTF-16 units. Larger text is refused, never clipped. Empty text remains an empty transparent label.
 * @param parent - The scene or object the label follows in local coordinates.
 * @param options - Its text, font, colour and placement.
 * @returns The attached label after its font and glyph image are ready.
 */
export async function addLabel(parent: Object3D, options: LabelOptions): Promise<LabelHandle> {
  const height = options.height ?? 0.25;
  const position = [...(options.position ?? [0, 0, 0])];
  if (
    !(height > 0 && Number.isFinite(height)) ||
    position.length !== 3 ||
    !position.every(Number.isFinite)
  )
    throw new RangeError(
      'A label needs a positive finite height and three finite position coordinates.',
    );
  const font = options.font ?? '32px sans-serif';
  const text = options.text;
  const color = new Color(options.color ?? '#ffffff');
  const image = await rasterLabel(text, font);
  const map = texture.canvas(image);
  const paint = material.sprite({ map, color, depthWrite: false });
  const sprite = markHelper(object.sprite(paint));
  sprite.castShadow = false;
  sprite.center.set(0.5, 0);
  sprite.position.fromArray(position);
  sprite.scale.set((height * image.width) / image.height, height, 1);
  parent.add(sprite);
  let current = text,
    revision = 0,
    removed = false;
  return {
    object: sprite,
    async setText(text) {
      if (removed) throw new Error('The label has been removed.');
      const own = ++revision;
      if (text === current) return;
      const next = await rasterLabel(text, font, () => !removed && own === revision);
      if (!next) return;
      if (removed || own !== revision) {
        next.width = next.height = 1;
        return;
      }
      // Keep the material and texture identity; the engine updates the image through its normal path.
      const aspect = image.width / image.height;
      image.width = next.width;
      image.height = next.height;
      const context = image.getContext('2d') as
        CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      context.drawImage(next, 0, 0);
      current = text;
      sprite.scale.x *= image.width / image.height / aspect;
      map.needsUpdate = true;
      next.width = next.height = 1;
    },
    remove() {
      if (removed) return;
      removed = true;
      revision++;
      sprite.removeFromParent();
      sprite.geometry.dispose();
      paint.dispose();
      map.dispose();
      image.width = image.height = 1;
    },
  };
}
