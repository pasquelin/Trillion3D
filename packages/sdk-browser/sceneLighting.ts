import * as THREE from 'three';

const MAX_LIGHTS = 256,
  STRIDE = 20;
/** Browser adapter: world-space light data, independent of material evaluation. */
function sceneLights(source: THREE.Object3D): THREE.Light[] {
  const lights: THREE.Light[] = [];
  source.traverse((object) => {
    if ((object as THREE.Light).isLight) lights.push(object as THREE.Light);
  });
  return lights;
}
function defaultLights(): THREE.Light[] {
  const hemi = new THREE.HemisphereLight(0xffffff, 0x495061, 2);
  const sun = new THREE.DirectionalLight(0xffffff, 2.5);
  sun.position.set(1, 3, 2);
  hemi.updateMatrixWorld();
  sun.updateMatrixWorld();
  return [hemi, sun];
}
const DEFAULT_LIGHTS = defaultLights();
function visible(light: THREE.Light) {
  let node: THREE.Object3D | null = light;
  while (node) {
    if (!node.visible) return false;
    node = node.parent;
  }
  return true;
}
export function installSceneLighting(
  scene: THREE.Scene,
  source: THREE.Object3D,
  clearColor: number,
) {
  scene.background = new THREE.Color(clearColor);
  let pairs: Array<{ original: THREE.Light; copy: THREE.Light; target?: THREE.Object3D }> = [];
  const update = () => {
    for (const { original, copy, target } of pairs) {
      original.updateWorldMatrix(true, false);
      copy.position.setFromMatrixPosition(original.matrixWorld);
      copy.quaternion.identity();
      copy.scale.set(1, 1, 1);
      copy.color.copy(original.color);
      copy.intensity = original.intensity;
      copy.visible = visible(original);
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
    const authored = sceneLights(source);
    for (const original of authored.length ? authored : DEFAULT_LIGHTS) {
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
  return { update, refresh };
}

export function packSceneLights(
  source: THREE.Object3D,
  out = new Float32Array(4 + MAX_LIGHTS * STRIDE),
  inventory = sceneLights(source),
) {
  const lights = inventory.length ? inventory.filter(visible) : DEFAULT_LIGHTS;
  if (lights.length > MAX_LIGHTS) throw new Error(`LIGHT_BUDGET: ${lights.length} > ${MAX_LIGHTS}`);
  out.fill(0);
  new Uint32Array(out.buffer, out.byteOffset, out.length)[0] = lights.length;
  const position = new THREE.Vector3(),
    direction = new THREE.Vector3(),
    target = new THREE.Vector3();
  for (let i = 0; i < lights.length; i++) {
    const light = lights[i],
      base = 4 + i * STRIDE;
    let kind = 0;
    light.updateWorldMatrix(true, false);
    position.setFromMatrixPosition(light.matrixWorld);
    direction.set(0, 1, 0);
    if (light instanceof THREE.DirectionalLight) {
      kind = 1;
      light.target.updateWorldMatrix(true, false);
      target.setFromMatrixPosition(light.target.matrixWorld);
      direction.subVectors(position, target).normalize();
    } else if (light instanceof THREE.PointLight) kind = 2;
    else if (light instanceof THREE.SpotLight) {
      kind = 3;
      light.target.updateWorldMatrix(true, false);
      target.setFromMatrixPosition(light.target.matrixWorld);
      direction.subVectors(position, target).normalize();
    } else if (light instanceof THREE.HemisphereLight) {
      kind = 4;
      direction.copy(position).normalize();
    } else if (!(light instanceof THREE.AmbientLight))
      throw new Error(`UNSUPPORTED_SCENE_LIGHT: ${light.type}`);
    out.set(
      [
        position.x,
        position.y,
        position.z,
        kind,
        light.color.r,
        light.color.g,
        light.color.b,
        light.intensity,
        direction.x,
        direction.y,
        direction.z,
        0,
        0,
        0,
        0,
        2,
        0,
        0,
        0,
        0,
      ],
      base,
    );
    if (light instanceof THREE.PointLight || light instanceof THREE.SpotLight) {
      out[base + 11] = light.distance;
      out[base + 15] = light.decay;
    }
    if (light instanceof THREE.HemisphereLight) {
      out.set([light.groundColor.r, light.groundColor.g, light.groundColor.b], base + 12);
    }
    if (light instanceof THREE.SpotLight) {
      out[base + 16] = Math.cos(light.angle);
      out[base + 17] = Math.cos(light.angle * (1 - light.penumbra));
    }
    if (!out.subarray(base, base + STRIDE).every(Number.isFinite))
      throw new Error('INVALID_SCENE_LIGHT');
  }
  return {
    data: out.subarray(0, 4 + lights.length * STRIDE),
    count: lights.length,
    types: lights.map((light) => light.type),
  };
}
export function createSceneLightBuffer(device: GPUDevice, source: THREE.Object3D) {
  const packed = new Float32Array(4 + MAX_LIGHTS * STRIDE);
  let inventory = sceneLights(source);
  const buffer = device.createBuffer({
    label: 'WG scene lights v1',
    size: packed.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  return {
    buffer,
    refresh() {
      inventory = sceneLights(source);
    },
    update() {
      const result = packSceneLights(source, packed, inventory);
      device.queue.writeBuffer(buffer, 0, result.data);
      return { count: result.count, types: result.types };
    },
    dispose() {
      buffer.destroy();
    },
  };
}
export { SCENE_LIGHTING_WGSL } from './sceneLightingShader.ts';
