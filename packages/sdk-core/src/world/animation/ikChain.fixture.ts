import { Object3D } from '../object/object3d.ts';

/** A two-bone Y chain whose independent links can be posed by each scenario. */
export function ikChain(first = 1, second = 1) {
  const root = new Object3D(),
    mid = new Object3D(),
    end = new Object3D();
  root.add(mid);
  mid.add(end);
  mid.position.set(0, first, 0);
  end.position.set(0, second, 0);
  return { root, mid, end };
}
