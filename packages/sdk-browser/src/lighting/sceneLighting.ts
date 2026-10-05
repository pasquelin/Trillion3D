import type { HostColour } from '../host/resources.ts';
import { aimOf, isLightNode } from '../host/graph/kinds.ts';
import { numbered } from '../host/graph/serial.ts';
import type { Light } from '../../../sdk-core/src/world/light/light.ts';
import { lampCastsShadow } from '../../../sdk-core/src/world/light/lightRecord.ts';
import { shownChain } from '../placement/hidden.ts';
import type { Object3D } from '../../../sdk-core/src/world/object/object3d.ts';

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
  /** Aim of a directional or a spot: its own node, posed and added beside it by the placement. */
  target?: AimNode;
};

/** The node of the display graph a copied light aims at, posed by the placement. */
type AimNode = { position: CopyVector };

/** The two writes this boundary makes on the display graph it lights. */
export type HostLightScene = { add(node: unknown): void; remove(node: unknown): void };

/** What a copied light aims at: `from`, the source's target read each update; `to`, the copy's. */
type Aim = { from: Object3D; to: AimNode };

function sceneLights(source: Object3D): Light[] {
  const lights: Light[] = [];
  source.traverse((object) => {
    if (isLightNode(object)) lights.push(object);
  });
  return lights;
}
/** World position of a placed object: the translation column of its resolved world matrix. */
function placeAt(into: AimNode, from: Object3D) {
  const elements = from.matrixWorld.elements;
  into.position.x = elements[12];
  into.position.y = elements[13];
  into.position.z = elements[14];
}
/**
 * Copy into the render scene the lights the source graph declares, and nothing else.
 *
 * No light without a declared source: a source that carries none yields a scene without
 * a light, not an invented hemisphere and sun. Same rule as the contract path,
 * on every engine that draws a display graph.
 */
export function installSceneLighting(
  scene: HostLightScene,
  source: Object3D,
  /** The copy of a source light the display graph holds, made by the host that draws it,
   *  numbered as the engine numbers what it builds. A copy that aims holds its own target, which
   *  the engine poses; the source's own target stays in the source graph. */
  copyOf: (light: Light) => HostLight = (light) => numbered(light.clone()),
) {
  /** One entry per copied light; `aim` only where the source's light aims. `casts` when the last
   *  placement found it shown and asking to cast (`lampCastsShadow`), named by `name`. */
  let pairs: Array<{ original: Light; copy: HostLight; aim?: Aim; name: string; casts?: boolean }> =
    [];
  // Off while another lighting contract governs: two stacked light sets light nobody's way.
  let enabled = true;
  // The shown lamps asking to cast (`ContractShadows`), a new list at each copy and each time one
  // starts or stops: shown or hidden, its `castShadow` set or cleared.
  let casting: readonly string[] = [];
  const recount = () => {
    casting = pairs.flatMap(({ name, casts }) => (casts ? [name] : []));
    lighting.castingChanged?.();
  };
  /** Places the copies; true when a lamp started or stopped casting since. */
  const place = () => {
    let moved = false;
    for (const pair of pairs) {
      const { original, copy, aim } = pair;
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
      const shown = shownChain(original);
      copy.visible = enabled && shown;
      const casts = shown && lampCastsShadow(original);
      if (casts !== pair.casts) moved = true;
      pair.casts = casts;
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
    return moved;
  };
  const update = () => {
    if (place()) recount();
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
      // A light that aims aims its copy at the copy's own target, posed here: the source's own
      // target stays in the graph its owner walks and resolves.
      const from = aimOf(original);
      if (from && copy.target) {
        aim = { from, to: copy.target };
        scene.add(aim.to);
      }
      scene.add(copy);
      pairs.push({ original, copy, aim, name: original.name || `light_${pairs.length}` });
    }
    place();
    recount();
  };
  const lighting = {
    update,
    refresh,
    /** Turn source-graph lights off or on, without removing or recopying them. */
    setEnabled(next: boolean) {
      if (enabled === next) return;
      enabled = next;
      update();
    },
    /** The names of the shown source lights asking to cast. */
    get casting(): readonly string[] {
      return casting;
    },
    /** Hears each new `casting`: a copy, or a lamp that starts or stops casting. */
    castingChanged: undefined as (() => void) | undefined,
    /** True as soon as a source-graph light is installed: the only signal of a lit view. */
    get lit() {
      return enabled && pairs.length > 0;
    },
    /** Whether the source graph declares a light at all, switched off by the contract or not. */
    get declared() {
      return pairs.length > 0;
    },
  };
  refresh();
  return lighting;
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
