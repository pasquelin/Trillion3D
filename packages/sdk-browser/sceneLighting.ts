import * as THREE from 'three';

/** Browser adapter: world-space light data, independent of material evaluation. */
function sceneLights(source: THREE.Object3D): THREE.Light[] {
  const lights: THREE.Light[] = [];
  source.traverse((object) => {
    if ((object as THREE.Light).isLight) lights.push(object as THREE.Light);
  });
  return lights;
}
function visible(light: THREE.Light) {
  let node: THREE.Object3D | null = light;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}
/**
 * Copy into the render scene the lights the source graph declares, and nothing else.
 *
 * No light without a declared source (P6): a source that carries none yields a scene without
 * a light, not an invented hemisphere and sun. Same rule as the contract path,
 * on the adapters that render through Three.
 */
export function installSceneLighting(
  scene: THREE.Scene,
  source: THREE.Object3D,
  clearColor: number,
) {
  scene.background = new THREE.Color(clearColor);
  let pairs: Array<{ original: THREE.Light; copy: THREE.Light; target?: THREE.Object3D }> = [];
  // Source-graph lights are cleared when another lighting contract takes over: two
  // stacked light sets would be nobody's lighting.
  let enabled = true;
  const update = () => {
    for (const { original, copy, target } of pairs) {
      original.updateWorldMatrix(true, false);
      copy.position.setFromMatrixPosition(original.matrixWorld);
      copy.quaternion.identity();
      copy.scale.set(1, 1, 1);
      copy.color.copy(original.color);
      copy.intensity = original.intensity;
      copy.visible = enabled && visible(original);
      if (target) {
        const sourceTarget = (original as THREE.DirectionalLight).target;
        sourceTarget.updateWorldMatrix(true, false);
        target.position.setFromMatrixPosition(sourceTarget.matrixWorld);
      }
      if (original instanceof THREE.HemisphereLight)
        (copy as THREE.HemisphereLight).groundColor.copy(original.groundColor);
      if (original instanceof THREE.PointLight || original instanceof THREE.SpotLight) {
        (copy as THREE.PointLight).distance = original.distance;
        (copy as THREE.PointLight).decay = original.decay;
      }
      if (original instanceof THREE.SpotLight) {
        (copy as THREE.SpotLight).angle = original.angle;
        (copy as THREE.SpotLight).penumbra = original.penumbra;
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
      let target: THREE.Object3D | undefined;
      if ('target' in original) {
        target = new THREE.Object3D();
        (copy as THREE.DirectionalLight).target = target;
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
 * What a Three-rendered engine publishes of its lighting: enough to refresh it, and the view it
 * renders. With no light installed, the host composites by identity rather than exposure and ACES.
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
