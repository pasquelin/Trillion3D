import type { HostColour, HostPlaced, HostTraversable } from '../host/resources.ts';
import { isLightNode, isPlacedLight, type GraphAnyLight } from '../host/graph/kinds.ts';

/**
 * Browser boundary: the lights a source graph declares, placed in the graph an engine publishes.
 *
 * The source is the engine's own graph, its lights told apart by their `kind`. The copy a
 * display graph holds is made by the host that draws it, and is read through the shape below:
 * the placement is the engine's, the copied objects stay the host's.
 */

/** Where a copy stands: the three numbers of a pose, written one by one. */
type CopyVector = { x: number; y: number; z: number };

/** The copy of a source light a host display graph holds, written through this shape. */
export type HostLight = {
  visible: boolean;
  position: CopyVector;
  quaternion: CopyVector & { w: number };
  scale: CopyVector;
  color: HostColour;
  intensity: number;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  /** Aim of a directional or a spot: the node of the display graph it looks at. */
  target?: unknown;
};

/** An empty node of the display graph a copied light aims at, posed by the placement. */
type AimNode = { position: CopyVector };

/** The two writes this boundary makes on the display graph it lights. */
export type HostLightScene = { add(node: unknown): void; remove(node: unknown): void };

/** What a copied light aims at: `from` is the target the source declared, read every update;
 *  `to` is the node of the display graph the copy points at in its place. */
type Aim = { from: HostPlaced; to: AimNode };

function sceneLights(source: HostTraversable): GraphAnyLight[] {
  const lights: GraphAnyLight[] = [];
  source.traverse((object) => {
    if (isLightNode(object)) lights.push(object);
  });
  return lights;
}
function visible(light: GraphAnyLight) {
  let node: HostPlaced | null = light;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}
/** World position of a placed object: the translation column of its resolved world matrix. */
function placeAt(into: AimNode, from: HostPlaced) {
  const elements = from.matrixWorld.elements;
  into.position.x = elements[12];
  into.position.y = elements[13];
  into.position.z = elements[14];
}
/**
 * Copy into the render scene the lights the source graph declares, and nothing else.
 *
 * No light without a declared source (P6): a source that carries none yields a scene without
 * a light, not an invented hemisphere and sun. Same rule as the contract path,
 * on every engine that draws a display graph.
 */
export function installSceneLighting(
  scene: HostLightScene,
  source: HostTraversable,
  /** An empty node of that graph: what a copied light aims at. The engine poses it, the host
   *  makes it — the source's own target belongs to the source graph and stays there. */
  aimNode: () => AimNode,
  /** The copy of a source light the display graph holds, made by the host that draws it: a
   *  light of the source graph's own library copies itself. */
  copyOf: (light: GraphAnyLight) => HostLight = (light) => light.clone(),
) {
  /** One entry per copied light; `aim` only where the source declared a target. */
  let pairs: Array<{ original: GraphAnyLight; copy: HostLight; aim?: Aim }> = [];
  // Source-graph lights are cleared when another lighting contract takes over: two
  // stacked light sets would be nobody's lighting.
  let enabled = true;
  const update = () => {
    for (const { original, copy, aim } of pairs) {
      original.updateWorldMatrix(true, false);
      placeAt(copy, original);
      copy.quaternion.x = 0;
      copy.quaternion.y = 0;
      copy.quaternion.z = 0;
      copy.quaternion.w = 1;
      copy.scale.x = 1;
      copy.scale.y = 1;
      copy.scale.z = 1;
      copy.color.r = original.color.r;
      copy.color.g = original.color.g;
      copy.color.b = original.color.b;
      copy.intensity = original.intensity;
      copy.visible = enabled && visible(original);
      if (aim) {
        aim.from.updateWorldMatrix(true, false);
        placeAt(aim.to, aim.from);
      }
      if (original.kind === 'point' || original.kind === 'spot') {
        copy.distance = original.distance;
        copy.decay = original.decay;
      }
      if (original.kind === 'spot') {
        copy.angle = original.angle;
        copy.penumbra = original.penumbra;
      }
    }
  };
  const refresh = () => {
    for (const { copy, aim } of pairs) {
      scene.remove(copy);
      if (aim) scene.remove(aim.to);
    }
    pairs = [];
    for (const original of sceneLights(source)) {
      const copy = copyOf(original);
      let aim: Aim | undefined;
      // A light that aims gets an aim of this graph: the copy is posed here, and the source's
      // own target stays in the graph its owner walks and resolves. The question is asked of
      // the original — a host whose `clone()` drops the target would otherwise lose the aim.
      if (isPlacedLight(original) && original.target) {
        aim = { from: original.target, to: aimNode() };
        copy.target = aim.to;
        scene.add(aim.to);
      }
      scene.add(copy);
      pairs.push({ original, copy, aim });
    }
    update();
  };
  refresh();
  return {
    update,
    refresh,
    /** Turn source-graph lights off or on, without removing or recopying them. */
    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      update();
    },
    /** True as soon as a source-graph light is installed: the only signal of a lit view. */
    get lit() {
      return enabled && pairs.length > 0;
    },
  };
}

/**
 * What an engine drawing a display graph publishes of its lighting: enough to refresh it, and
 * the view it renders. With no light installed, the host composites by identity rather than
 * exposure and ACES.
 *
 * `sceneLit` is a function, not a getter: engines spread this object into theirs, and a getter
 * would be read once, at construction. A light placed afterwards — the case of every contract
 * host — must relight the display chain on the next frame.
 */
export function sceneLightingApi(
  lighting: ReturnType<typeof installSceneLighting>,
  /** Notified when source-graph lights change: this is a scene write. An engine that
   *  rewalks the scene every frame has nothing to do with it and says so with an empty call. */
  sceneChanged: () => void,
) {
  return {
    refreshSceneLighting: () => {
      lighting.refresh();
      sceneChanged();
    },
    sceneLit: () => lighting.lit,
  };
}
