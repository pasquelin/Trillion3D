import { EngineError, IDENTITY_MATRIX4 } from '../../../sdk-core/src/index.ts';
import { Color, type ColorInput } from '../../../sdk-core/src/world/math/color.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';
import { objectPieces, type GuidePiece } from './guideObject.ts';
import { packGuides, type GuideEntry } from './guidePack.ts';

/**
 * Most vertices the guides of one world hold together: two per segment, one per point. Declared,
 * not derived: it bounds the one instance buffer the pass uploads at 64 Ki × 32 bytes = 2 MiB,
 * whatever a page asks — a grid of 16 000 lines fits, a point cloud of a scanned city does not,
 * and belongs in the scene.
 */
export const GUIDE_VERTEX_CEILING = 65536;

/** One set of guides a page drew; each setter answers the handle. */
export interface GuideHandle {
  /** Whether it is drawn; `setVisible` writes it. */
  readonly visible: boolean;
  /** Shows or hides it, its vertices still counted against the ceiling. */
  setVisible(on: boolean): GuideHandle;
  /** Places it: sixteen column-major numbers, or a matrix — `node.matrixWorld` follows a node. */
  setTransform(matrix: ArrayLike<number> | { elements: ArrayLike<number> }): GuideHandle;
  /** Takes it out of the world, its vertices given back; a second call does nothing. */
  remove(): void;
}

/** Line segments to draw. */
export interface GuideLines {
  /** Two ends per segment, three numbers each. */
  positions: ArrayLike<number>;
  /** Their colour; white by default. */
  color?: ColorInput;
  /** Width on the screen, in pixels. @defaultValue 1 */
  width?: number;
}
/** Dots to draw. */
export interface GuidePoints {
  /** Three numbers per dot. */
  positions: ArrayLike<number>;
  /** Their colour; white by default. */
  color?: ColorInput;
  /** Side of each square dot on the screen, in pixels. @defaultValue 4 */
  size?: number;
}

/** The guides of one world, as a page draws them: `world.guides`. */
export interface Guides {
  /** Most vertices the guides hold together (`GUIDE_VERTEX_CEILING`). */
  readonly ceiling: number;
  /** Vertices held now, two per segment and one per dot, hidden guides included. */
  readonly vertexCount: number;
  /** Draws line segments, two ends each; refused above the ceiling (`GUIDE_CEILING`). */
  lines(lines: GuideLines): GuideHandle;
  /** Draws square dots, one position each; refused above the ceiling (`GUIDE_CEILING`). */
  points(points: GuidePoints): GuideHandle;
  /**
   * Draws the line and point meshes of `object` — every `helper` builds them —, in their material
   * colours, placed where the object stands now; its triangles are not guides and are skipped.
   * @param options - `width` of its lines and `size` of its dots, in pixels.
   */
  add(object: Object3D, options?: { width?: number; size?: number }): GuideHandle;
  /** Removes every guide. */
  clear(): void;
}

const hexOf = (color: ColorInput | undefined) => new Color(color ?? 0xffffff).getHex();

/**
 * The guides of one world: lines and points a page draws ABOUT its scene — an axis, a grid, a
 * box, a measured segment — outside the scene's clusters. Held by the world, read by whichever
 * session draws it; `onChange` asks the world for a frame. Nothing is packed, uploaded or drawn
 * while the set is empty: `revision` and `visibleInstances` are what a pass reads first.
 */
export function createGuideSet(onChange: () => void = () => {}) {
  const entries = new Set<GuideEntry>();
  let vertices = 0,
    revision = 0,
    packedAt = -1,
    packed = packGuides([]);
  const changed = () => {
    revision++;
    onChange();
  };
  const open = (pieces: GuidePiece[]): GuideHandle => {
    const count = pieces.reduce((sum, piece) => sum + piece.vertices, 0);
    if (vertices + count > GUIDE_VERTEX_CEILING)
      throw new EngineError(
        'GUIDE_CEILING',
        `Guides would hold ${vertices + count} vertices, above the ceiling of ${GUIDE_VERTEX_CEILING}`,
        { held: vertices, asked: count, ceiling: GUIDE_VERTEX_CEILING },
      );
    const entry: GuideEntry = {
      pieces,
      vertices: count,
      matrix: Float64Array.from(IDENTITY_MATRIX4),
      visible: true,
    };
    entries.add(entry);
    vertices += count;
    changed();
    const handle: GuideHandle = {
      get visible() {
        return entry.visible;
      },
      setVisible(on) {
        if (entry.visible === on || !entries.has(entry)) return handle;
        entry.visible = on;
        changed();
        return handle;
      },
      setTransform(matrix) {
        entry.matrix.set('elements' in matrix ? matrix.elements : matrix);
        if (entries.has(entry)) changed();
        return handle;
      },
      remove() {
        if (!entries.delete(entry)) return;
        vertices -= entry.vertices;
        changed();
      },
    };
    return handle;
  };
  return {
    ceiling: GUIDE_VERTEX_CEILING,
    get vertexCount() {
      return vertices;
    },
    /** Moves at every change: what a held frame compares. */
    get revision() {
      return revision;
    },
    lines({ positions, color, width = 1 }: GuideLines) {
      const ends = Float64Array.from(positions).subarray(
        0,
        positions.length - (positions.length % 6),
      );
      return open([{ ends, color: hexOf(color), width, vertices: ends.length / 3 }]);
    },
    points({ positions, color, size = 4 }: GuidePoints) {
      const n = Math.floor(positions.length / 3),
        ends = new Float64Array(n * 6);
      for (let i = 0; i < n; i++)
        for (let c = 0; c < 3; c++) ends[i * 6 + c] = ends[i * 6 + 3 + c] = positions[i * 3 + c];
      return open([{ ends, color: hexOf(color), width: size, vertices: n }]);
    },
    add(object: Object3D, options: { width?: number; size?: number } = {}) {
      object.updateWorldMatrix(true, true);
      const handle = open(objectPieces(object, options.width ?? 1, options.size ?? 4));
      return handle.setTransform(object.matrixWorld);
    },
    clear() {
      if (!entries.size) return;
      entries.clear();
      vertices = 0;
      changed();
    },
    /** Instances drawn now: zero when nothing is shown, and then no pass runs. */
    visibleInstances() {
      return this.pack().count;
    },
    /** The visible guides as instances (`packGuides`), packed again only when `revision` moved. */
    pack() {
      if (packedAt === revision) return packed;
      packedAt = revision;
      return (packed = packGuides(entries));
    },
  };
}

/** The guides of one world with what its passes read: the packing and its revision. */
export type GuideSet = ReturnType<typeof createGuideSet>;
