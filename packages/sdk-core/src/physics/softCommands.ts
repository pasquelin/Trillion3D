import type { CommandWriter } from './commands.ts';
import { OP } from './layout.ts';
import type { SoftRecord, SoftSettings } from './soft.ts';
import { SOFT_VERTEX_WORDS } from './softLayout.ts';

/** A soft body as the SOFT command carries it (`softLayout.ts`). */
export interface SoftBodyRecord {
  /** The body's engine id: its slot and the slot's generation (`BODY_INDEX`). */
  id: number;
  position: ArrayLike<number>;
  quaternion: ArrayLike<number>;
  scale: readonly [number, number, number];
  friction: number;
  restitution: number;
  gravityScale: number;
  linearDamping: number;
  settings: SoftSettings;
  record: SoftRecord;
}

/** Makes a soft body (`softLayout.ts` SOFT). */
export function writeSoft(writer: CommandWriter, body: SoftBodyRecord) {
  const { settings: s, record } = body;
  const counts = [record.vertices.length / SOFT_VERTEX_WORDS, record.indices.length];
  writer.put(
    [OP.soft, body.id],
    [
      ...[...Array.from(body.position), ...Array.from(body.quaternion), ...body.scale],
      ...[body.friction, body.restitution, body.gravityScale, body.linearDamping],
      ...[s.stretch, s.bend, record.pressure],
    ],
  );
  writer.put(counts, record.vertices);
  writer.put(Array.from(record.indices), []);
}
