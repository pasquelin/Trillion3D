import { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import type { XrFrame, XrInputSource, XrSpace, XrTransform } from './platform.ts';

/** A tracked controller's ray, grip and hand joints, ordinary nodes the scene can adopt. */
export interface XrInput {
  source: XrInputSource;
  ray: Object3D;
  grip: Object3D;
  joints: ReadonlyMap<string, Object3D>;
}
/** Tracking loss hides the node; regaining tracking restores its pose in reference coordinates. */
export function xrPose(node: Object3D, transform: XrTransform | undefined | null) {
  node.visible = !!transform;
  if (!transform) return;
  const { position: p, orientation: q } = transform;
  node.position.set(p.x, p.y, p.z);
  node.quaternion.set(q.x, q.y, q.z, q.w);
}

export function createXrInputs() {
  const inputs = new Map<XrInputSource, XrInput>();
  const detach = (input: XrInput) => {
    for (const node of [input.ray, input.grip, ...input.joints.values()]) {
      node.visible = false;
      node.parent?.remove(node);
    }
  };
  return {
    /** Stable records until the browser removes their source. */
    values: () => [...inputs.values()],
    sync(sources: readonly XrInputSource[]) {
      const current = new Set(sources);
      for (const [source, input] of inputs)
        if (!current.has(source)) {
          detach(input);
          inputs.delete(source);
        }
      for (const source of sources) {
        if (inputs.has(source)) continue;
        const ray = new Object3D(),
          grip = new Object3D();
        ray.visible = grip.visible = false;
        const joints = new Map<string, Object3D>();
        for (const name of source.hand?.keys() ?? []) {
          const joint = new Object3D();
          joint.name = name;
          joint.visible = false;
          joints.set(name, joint);
        }
        inputs.set(source, { source, ray, grip, joints });
      }
    },
    update(frame: XrFrame, reference: XrSpace) {
      for (const [source, input] of inputs) {
        xrPose(input.ray, frame.getPose(source.targetRaySpace, reference)?.transform);
        xrPose(
          input.grip,
          source.gripSpace && frame.getPose(source.gripSpace, reference)?.transform,
        );
        for (const [name, node] of input.joints) {
          const space = source.hand?.get(name);
          const pose = space && frame.getJointPose?.(space, reference);
          xrPose(node, pose?.transform);
          if (pose) node.userData.radius = pose.radius;
        }
      }
    },
    clear() {
      for (const input of inputs.values()) detach(input);
      inputs.clear();
    },
  };
}
