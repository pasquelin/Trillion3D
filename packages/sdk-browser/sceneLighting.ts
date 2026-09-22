import type { HostColour, HostNode, HostPlaced, HostTraversable } from './hostResources.ts';

/**
 * Browser boundary: the lights a source graph declares, placed in the graph an engine publishes.
 *
 * Nothing here names a rendering library. A light is read through the shape below — the flags
 * the host writes on its own objects say its kind, the copy it makes of itself is its own — so
 * the placement is the engine's and the objects stay the host's.
 */

/**
 * A host light, and the copy of it a display graph holds. The kind is read from the flags the
 * host sets on its own objects rather than from a class: a hemisphere carries a ground colour,
 * a point and a spot a range and a decay, a spot a cone, and a light that aims carries a target.
 */
export type HostLight = HostPlaced & {
  readonly isLight: true;
  readonly isHemisphereLight?: boolean;
  readonly isPointLight?: boolean;
  readonly isSpotLight?: boolean;
  color: HostColour;
  intensity: number;
  groundColor?: HostColour;
  distance?: number;
  decay?: number;
  angle?: number;
  penumbra?: number;
  /** Aim of a directional or a spot: the point it looks at, a node of the same graph. */
  target?: HostPlaced;
  /** A copy of this light, made by the host that owns it. */
  clone(): HostLight;
};

/** The two writes this boundary makes on the display graph it lights. */
export type HostLightScene = { add(node: unknown): void; remove(node: unknown): void };

function sceneLights(source: HostTraversable): HostLight[] {
  const lights: HostLight[] = [];
  source.traverse((object: HostNode) => {
    if ((object as Partial<HostLight>).isLight) lights.push(object as unknown as HostLight);
  });
  return lights;
}
function visible(light: HostLight) {
  let node: HostPlaced | null = light;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}
/** World position of a placed object: the translation column of its resolved world matrix. */
function placeAt(into: HostPlaced, from: HostPlaced) {
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
  aimNode: () => HostPlaced,
) {
  let pairs: Array<{ original: HostLight; copy: HostLight; target?: HostPlaced }> = [];
  // Source-graph lights are cleared when another lighting contract takes over: two
  // stacked light sets would be nobody's lighting.
  let enabled = true;
  const update = () => {
    for (const { original, copy, target } of pairs) {
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
      if (target) {
        const sourceTarget = original.target!;
        sourceTarget.updateWorldMatrix(true, false);
        placeAt(target, sourceTarget);
      }
      if (original.isHemisphereLight) {
        copy.groundColor!.r = original.groundColor!.r;
        copy.groundColor!.g = original.groundColor!.g;
        copy.groundColor!.b = original.groundColor!.b;
      }
      if (original.isPointLight || original.isSpotLight) {
        copy.distance = original.distance;
        copy.decay = original.decay;
      }
      if (original.isSpotLight) {
        copy.angle = original.angle;
        copy.penumbra = original.penumbra;
      }
    }
  };
  const refresh = () => {
    for (const { copy, target } of pairs) {
      scene.remove(copy);
      if (target) scene.remove(target);
    }
    pairs = [];
    for (const original of sceneLights(source)) {
      const copy = original.clone();
      let target: HostPlaced | undefined;
      // A light that aims gets an aim of this graph: the copy is posed here, and the source's
      // own target stays in the graph its owner walks and resolves.
      if (copy.target) {
        target = aimNode();
        copy.target = target;
        scene.add(target);
      }
      scene.add(copy);
      pairs.push({ original, copy, target });
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
