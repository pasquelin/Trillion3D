/**
 * The small glTF tables of a world file: materials deduplicated by surface name, and
 * `KHR_lights_punctual` lamps — one light definition per distinct lamp kind, one node per lamp.
 */
import type { Instance, LampLight, Surface, Vec3 } from '../plan/contract.ts';
import { assertSameSurface, isDoubleSided } from '../props/surfaces.ts';

export type GltfNode = {
  name?: string;
  mesh?: number;
  translation?: Vec3;
  rotation?: readonly [number, number, number, number];
  scale?: Vec3;
  extensions?: { KHR_lights_punctual: { light: number } };
  extras?: { night: boolean };
};

/** glTF's CLAMP_TO_EDGE, LINEAR and LINEAR_MIPMAP_LINEAR. */
const CLAMP = { wrapS: 33071, wrapT: 33071, magFilter: 9729, minFilter: 9987 };

/**
 * Materials in first-use order, one per surface name; a name reused with other values throws.
 * Base colour images are deduplicated by file, one texture each, all on one clamped sampler.
 */
export function materialTable() {
  const index = new Map<string, number>(),
    seen: Surface[] = [],
    files = new Map<string, number>();
  const texture = (file: string) => {
    const known = files.get(file);
    if (known !== undefined) return known;
    files.set(file, files.size);
    return files.size - 1;
  };
  return {
    materials: () => seen.map((surface) => material(surface, texture)),
    /** Image files in texture order, read after `materials()`. */
    images: () => [...files.keys()],
    /** The image, texture and sampler tables, none when no surface has an image. */
    textures: () =>
      files.size
        ? {
            images: [...files.keys()].map((uri) => ({ uri })),
            textures: [...files.values()].map((source) => ({ source, sampler: 0 })),
            samplers: [CLAMP],
          }
        : {},
    usesEmissiveStrength: () => seen.some(strong),
    of(surface: Surface) {
      const known = index.get(surface.name);
      if (known === undefined) {
        index.set(surface.name, seen.push(surface) - 1);
        return seen.length - 1;
      }
      assertSameSurface(seen[known], surface);
      return known;
    },
  };
}

const strong = (surface: Surface) => (surface.emissiveStrength ?? 1) !== 1 && !!surface.emissive;

function material(surface: Surface, texture: (file: string) => number) {
  const alpha = surface.alpha ?? 'opaque';
  return {
    name: surface.name,
    // Only cards (leaves, sails, fronds) are seen from both sides; closed props are culled.
    doubleSided: isDoubleSided(surface),
    pbrMetallicRoughness: {
      baseColorFactor: surface.color,
      ...(surface.texture ? { baseColorTexture: { index: texture(surface.texture) } } : {}),
      metallicFactor: surface.metalness,
      roughnessFactor: surface.roughness,
    },
    ...(surface.emissive ? { emissiveFactor: surface.emissive } : {}),
    ...(strong(surface)
      ? {
          extensions: {
            KHR_materials_emissive_strength: { emissiveStrength: surface.emissiveStrength },
          },
        }
      : {}),
    ...(alpha === 'opaque' ? {} : { alphaMode: alpha.toUpperCase() }),
    ...(alpha === 'mask' ? { alphaCutoff: 0.5 } : {}),
  };
}

/** The node that places one instance of mesh `mesh`. */
export function instanceNode(instance: Instance, mesh: number): GltfNode {
  const { yaw, scale = 1 } = instance,
    node: GltfNode = { mesh, translation: instance.position };
  if (instance.name) node.name = instance.name;
  if (yaw) node.rotation = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const scaled: Vec3 = typeof scale === 'number' ? [scale, scale, scale] : scale;
  if (scaled.some((s) => s !== 1)) node.scale = scaled;
  return node;
}

/** The rotation taking a light's forward axis (-Z) onto `direction`. */
function aim(direction: Vec3): [number, number, number, number] {
  const length = Math.hypot(...direction) || 1,
    [x, y, z] = direction.map((v) => v / length),
    w = 1 - z; // 1 + dot(-Z, d)
  if (w < 1e-9) return [0, 1, 0, 0];
  // cross(-Z, d) = (y, -x, 0)
  const norm = Math.hypot(y, x, w);
  return [y / norm, -x / norm, 0, w / norm];
}

/** Light definitions shared by every lamp of the same kind, and one node per lamp. */
export function lightTable() {
  const index = new Map<string, number>(),
    lights: object[] = [];
  return {
    lights,
    node(lamp: LampLight): GltfNode {
      const definition = {
        type: lamp.type,
        color: lamp.color,
        intensity: lamp.intensity,
        range: lamp.range,
        ...(lamp.type === 'spot'
          ? { spot: { innerConeAngle: 0, outerConeAngle: lamp.cone ?? Math.PI / 4 } }
          : {}),
      };
      const key = JSON.stringify(definition);
      let light = index.get(key);
      if (light === undefined) index.set(key, (light = lights.push(definition) - 1));
      return {
        name: lamp.name,
        translation: lamp.position,
        ...(lamp.type === 'spot' && lamp.direction ? { rotation: aim(lamp.direction) } : {}),
        extensions: { KHR_lights_punctual: { light } },
        extras: { night: lamp.night },
      };
    },
  };
}
