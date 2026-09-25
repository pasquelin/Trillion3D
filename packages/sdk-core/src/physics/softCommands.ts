import type { CommandWriter } from './commands.ts';
import { OP } from './layout.ts';
import type { SoftRecord, SoftSettings } from './soft.ts';
import { SOFT_VERTEX_WORDS } from './softLayout.ts';

/** A soft body the compiler cooked (`physics.json`): its `SoftBodySharedSettings` in Jolt's binary
 *  state, scaled and holding its compliances, and its gas's pressure at rest (Pa, 0 without). */
interface CookedSoftRecord {
  cooked: Uint8Array;
  pressure: number;
}

/** A soft body as the SOFT command carries it (`softLayout.ts`). */
export interface SoftBodyRecord {
  /** The body's engine id: its slot and the slot's generation (`BODY_INDEX`). */
  id: number;
  position: ArrayLike<number>;
  quaternion: ArrayLike<number>;
  /** The scale its vertices are simulated at: a cooked body's settings are already. */
  scale: readonly [number, number, number];
  friction: number;
  restitution: number;
  gravityScale: number;
  linearDamping: number;
  /** Its compliances; a cooked body's are its settings' own. */
  settings: Pick<SoftSettings, 'stretch' | 'bend'>;
  record: SoftRecord | CookedSoftRecord;
}

/** Makes a soft body (`softLayout.ts` SOFT). */
export function writeSoft(writer: CommandWriter, body: SoftBodyRecord) {
  const { settings: s, record } = body;
  const { vertices, indices, cooked } =
    'cooked' in record ? { vertices: [], indices: [], cooked: record.cooked } : { ...record, cooked: undefined };
  const counts = [vertices.length / SOFT_VERTEX_WORDS, indices.length, cooked?.length ?? 0];
  writer.put(
    [OP.soft, body.id],
    [
      ...[...Array.from(body.position), ...Array.from(body.quaternion), ...body.scale],
      ...[body.friction, body.restitution, body.gravityScale, body.linearDamping],
      ...[s.stretch, s.bend, record.pressure],
    ],
  );
  writer.put(counts, vertices);
  writer.put(indices, [], cooked);
}
