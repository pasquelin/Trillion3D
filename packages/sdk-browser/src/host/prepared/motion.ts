/**
 * What moves in the prepared scene (#357), built from the scene tables alone
 * (`sdk-core/src/scene/core/tableMotion.ts`): each skinned mesh's skeleton — its joints are the
 * scene's own nodes — and the file's clips, whose tracks name the nodes they move, so a mixer
 * on the model plays them (`animation.createMixer(model)`).
 */
import type { PreparedSceneTables } from '../../../../sdk-core/src/scene/core/tableContracts.ts';
import type { TableChannel } from '../../../../sdk-core/src/scene/core/tableMotion.ts';
import type { Clip, Track, TrackKind } from '../../../../sdk-core/src/world/animation/index.ts';
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { Skeleton } from '../../../../sdk-core/src/world/animation/skeleton.ts';
import type { Mesh } from '../../../../sdk-core/src/world/object/mesh.ts';
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts';
import { isDrawnNode } from '../graph/kinds.ts';

/** The node ranks a clip moves or a skin bends by: what the loader names when the file did not. */
export function movedNodes(tables: Pick<PreparedSceneTables, 'skins' | 'animations'>) {
  const moved = new Set<number>();
  for (const skin of tables.skins) for (const joint of skin.joints) moved.add(joint);
  for (const clip of tables.animations)
    for (const channel of clip.channels) moved.add(channel.node);
  return moved;
}

/** Sets each skinned node's skeleton on the meshes it draws; its joints are `nodes` by rank. */
export function bindSkins(tables: PreparedSceneTables, nodes: readonly Object3D[]) {
  const skeletons = tables.skins.map(
    (skin) =>
      new Skeleton(
        skin.joints.map((joint) => nodes[joint]),
        skin.inverseBindMatrices ?? skin.joints.flatMap(() => new Matrix4().toArray()),
      ),
  );
  tables.nodes.forEach((declared, id) => {
    if (declared.skin === null || !nodes[id]) return;
    nodes[id].traverse((part) => {
      if (isDrawnNode(part)) (part as unknown as Mesh).skeleton = skeletons[declared.skin!];
    });
  });
}

const KINDS: Record<TableChannel['path'], [string, TrackKind]> = {
  translation: ['position', 'vector'],
  rotation: ['quaternion', 'quaternion'],
  scale: ['scale', 'vector'],
  weights: ['morphTargetInfluences', 'weights'],
};
const INTERPOLATION = { LINEAR: 'linear', STEP: 'step', CUBICSPLINE: 'cubic' } as const;

/** The file's clips, each channel a track on the node it moves — a morph channel one track on
 *  each mesh the node draws, since each holds its own weights. */
export function clipsOf(tables: PreparedSceneTables, nodes: readonly Object3D[]): Clip[] {
  return tables.animations.map((declared, rank) => {
    const tracks: Track[] = [];
    let duration = 0;
    for (const channel of declared.channels) {
      const node = nodes[channel.node];
      if (!node) continue;
      const [field, kind] = KINDS[channel.path];
      const drawn: Object3D[] = [];
      if (channel.path === 'weights')
        node.traverse((part) => isDrawnNode(part) && drawn.push(part));
      const targets = channel.path === 'weights' ? drawn : [node];
      for (const target of targets)
        tracks.push({
          name: `${target.name}.${field}`,
          kind,
          times: new Float32Array(channel.times),
          values: new Float32Array(channel.values),
          interpolation: INTERPOLATION[channel.interpolation],
        });
      duration = Math.max(duration, channel.times[channel.times.length - 1] ?? 0);
    }
    return { name: declared.name || `animation_${rank}`, duration, tracks };
  });
}
