import { copyElements, sameElements } from '../../math/matrixElements.ts';
import { isLightNode } from '../graph/kinds.ts';
import type { Light } from '../../../../sdk-core/src/world/light/light.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';

/** What a watch reports of a read: nothing, a value moved, or the set of read objects changed. */
export type WatchVerdict = 0 | 'moved' | 'reshaped';

/** Numbers of a light the engines consume: colour, intensity, range, decay, cone, ground colour. */
const LIGHT_VALUES = 11;
const scratch = new Float64Array(LIGHT_VALUES);
const finite = (value: number) => (Number.isFinite(value) ? value : 0);

/**
 * What a watched node holds outside its hooked pose, as last read. These are the node's own
 * data fields — the reference writes them itself on its walk — so no hook may sit on them
 * without dropping the node into dictionary mode: they are compared per frame, a few values
 * per node, and a matrix set by hand is compared whole while the node is frozen.
 */
export interface NodeState {
  node: Object3D;
  visible: boolean;
  castShadow: boolean;
  parent: Object3D | null;
  auto: boolean;
  matrix: Float64Array | null;
  /** A light's numbers as last read; its target, read-only on the core's `Light`, never changes. */
  light: Float64Array | null;
}

function lightValues(light: Light, into: Float64Array) {
  const colour = light.color;
  into[0] = colour.r;
  into[1] = colour.g;
  into[2] = colour.b;
  into[3] = light.intensity;
  into[4] = finite(light.distance);
  into[5] = finite(light.decay);
  into[6] = finite(light.angle);
  into[7] = finite(light.penumbra);
  into[8] = light.groundColor.r;
  into[9] = light.groundColor.g;
  into[10] = light.groundColor.b;
}

/** A light's numbers as they stand. */
function lightState(light: Light) {
  const values = new Float64Array(LIGHT_VALUES);
  lightValues(light, values);
  return values;
}

/** The node as it stands: the first read after it announces nothing. */
export function snapshot(node: Object3D): NodeState {
  const lit = isLightNode(node) ? lightState(node) : null;
  return {
    node,
    visible: node.visible,
    castShadow: node.castShadow,
    parent: node.parent,
    auto: node.matrixAutoUpdate,
    matrix: node.matrixAutoUpdate ? null : Float64Array.from(node.matrix.elements),
    light: lit,
  };
}

function scanLight(light: Light, held: Float64Array): boolean {
  // A colour replaced as a whole is read through the new object: its numbers are what count.
  lightValues(light, scratch);
  let moved = false;
  for (let k = 0; k < LIGHT_VALUES; k++)
    if (held[k] !== scratch[k]) {
      held[k] = scratch[k];
      moved = true;
    }
  return moved;
}

/** Compares the node to its state and takes what moved: what the reference's walk writes is
 *  read back as it stands, so a still scene reads the same values frame after frame. */
export function scan(state: NodeState): WatchVerdict {
  const node = state.node,
    // One read each, into a local: `parent` and `visible` are getters that check the node is
    // still alive, and this walk runs on every watched node, twice in an image where the GPU cut
    // walks back into the CPU one.
    parent = node.parent,
    visible = node.visible,
    castShadow = node.castShadow,
    auto = node.matrixAutoUpdate;
  // A reparented node changes its ancestor chain: the watched set is reshaped.
  const reparented = parent !== state.parent;
  state.parent = parent;
  let moved = visible !== state.visible || castShadow !== state.castShadow;
  state.visible = visible;
  state.castShadow = castShadow;
  if (auto !== state.auto) {
    // Frozen from now on: the matrix it holds is the pose, whatever wrote it.
    state.auto = auto;
    state.matrix = auto ? null : Float64Array.from(node.matrix.elements);
    moved = true;
  } else if (state.matrix && !sameElements(state.matrix, node.matrix.elements)) {
    copyElements(state.matrix, node.matrix.elements);
    moved = true;
  }
  if (state.light && isLightNode(node) && scanLight(node, state.light)) moved = true;
  if (reparented) return 'reshaped';
  return moved ? 'moved' : 0;
}
