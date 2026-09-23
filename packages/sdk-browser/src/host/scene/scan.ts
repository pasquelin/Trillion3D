import { copyElements, sameElements } from '../../math/matrixElements.ts';
import type { HostGraphNode, HostLightNode } from './graphNodes.ts';

/** What a watch reports of a read: nothing, a value moved, or the set of read objects changed. */
export type WatchVerdict = 0 | 'moved' | 'reshaped';

/** Numbers of a light the engines consume: colour, intensity, range, decay, cone, ground colour. */
const LIGHT_VALUES = 11;
const scratch = new Float64Array(LIGHT_VALUES);
const finite = (value: number | undefined) => (Number.isFinite(value) ? (value as number) : 0);

/**
 * What a watched node holds outside its hooked pose, as last read. These are the node's own
 * data fields — the reference writes them itself on its walk — so no hook may sit on them
 * without dropping the node into dictionary mode: they are compared per frame, a few values
 * per node, and a matrix set by hand is compared whole while the node is frozen.
 */
export interface NodeState {
  node: HostGraphNode;
  visible: boolean;
  parent: HostGraphNode | null;
  auto: boolean;
  matrix: Float64Array | null;
  light: LightState | null;
}

interface LightState {
  target: HostGraphNode | undefined;
  values: Float64Array;
}

function lightValues(light: HostLightNode, into: Float64Array) {
  const colour = light.color,
    ground = light.groundColor;
  into[0] = colour.r;
  into[1] = colour.g;
  into[2] = colour.b;
  into[3] = light.intensity;
  into[4] = finite(light.distance);
  into[5] = finite(light.decay);
  into[6] = finite(light.angle);
  into[7] = finite(light.penumbra);
  into[8] = ground ? ground.r : 0;
  into[9] = ground ? ground.g : 0;
  into[10] = ground ? ground.b : 0;
}

/** The node as it stands: the first read after it announces nothing. */
export function snapshot(node: HostGraphNode): NodeState {
  const light = node as HostLightNode;
  const lit: LightState | null = light.isLight
    ? { target: light.target, values: new Float64Array(LIGHT_VALUES) }
    : null;
  if (lit) lightValues(light, lit.values);
  return {
    node,
    visible: node.visible,
    parent: node.parent,
    auto: node.matrixAutoUpdate,
    matrix: node.matrixAutoUpdate ? null : Float64Array.from(node.matrix.elements),
    light: lit,
  };
}

function scanLight(light: HostLightNode, state: LightState): WatchVerdict {
  // A new target is another chain of ancestors to watch: the set is reshaped.
  const retargeted = light.target !== state.target;
  state.target = light.target;
  // A colour replaced as a whole is read through the new object: its numbers are what count.
  lightValues(light, scratch);
  const held = state.values;
  let moved = false;
  for (let k = 0; k < LIGHT_VALUES; k++)
    if (held[k] !== scratch[k]) {
      held[k] = scratch[k];
      moved = true;
    }
  return retargeted ? 'reshaped' : moved ? 'moved' : 0;
}

/** Compares the node to its state and takes what moved: what the reference's walk writes is
 *  read back as it stands, so a still scene reads the same values frame after frame. */
export function scan(state: NodeState): WatchVerdict {
  const node = state.node;
  // A reparented node changes its ancestor chain: the watched set is reshaped.
  const reparented = node.parent !== state.parent;
  state.parent = node.parent;
  let moved = node.visible !== state.visible;
  state.visible = node.visible;
  if (node.matrixAutoUpdate !== state.auto) {
    // Frozen from now on: the matrix it holds is the pose, whatever wrote it.
    state.auto = node.matrixAutoUpdate;
    state.matrix = state.auto ? null : Float64Array.from(node.matrix.elements);
    moved = true;
  } else if (state.matrix && !sameElements(state.matrix, node.matrix.elements)) {
    copyElements(state.matrix, node.matrix.elements);
    moved = true;
  }
  const light = state.light ? scanLight(node as HostLightNode, state.light) : 0;
  if (reparented || light === 'reshaped') return 'reshaped';
  return moved || light ? 'moved' : 0;
}
