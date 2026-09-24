import type { SkyEngine } from './engine.ts';

/** The engine's families as plain records: enough to build and move the sky's objects. */
export function fakeEngine(): SkyEngine {
  const vector = () => ({
    x: 0,
    y: 0,
    z: 0,
    set(x: number, y: number, z: number) {
      Object.assign(this, { x, y, z });
    },
  });
  const node = () => ({
    position: vector(),
    rotation: vector(),
    scale: vector(),
    visible: true,
    children: [] as unknown[],
    add(...children: unknown[]) {
      this.children.push(...children);
    },
    remove(...children: unknown[]) {
      this.children = this.children.filter((child) => !children.includes(child));
    },
  });
  const colour = () => ({ ...vector(), setRGB: vector().set });
  const material = (parameters: object = {}) => ({ ...parameters, color: colour() });
  const light = () => ({ ...node(), color: colour(), groundColor: colour(), target: node() });
  const float32 = (values: ArrayLike<number>) => ({ array: Float32Array.from(values) });
  const withGeometry = (geometry: unknown) => ({ ...node(), geometry });
  return {
    geometry: { sphere: () => ({}), cone: () => ({}), createBuffer: (a: object) => a },
    buffer: { float32, uint32: float32 },
    material: { meshBasic: material, meshStandard: material, points: material, line: material },
    object: { mesh: withGeometry, points: withGeometry, lineSegments: withGeometry, group: node },
    light: { directional: light, hemisphere: light },
    math: { color: colour },
    texture: { data: () => ({}) },
    blending: { normal: 'normal', additive: 'additive' },
    side: { back: 'back', double: 'double' },
  } as unknown as SkyEngine;
}
