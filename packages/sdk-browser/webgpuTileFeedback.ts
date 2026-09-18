/**
 * Le retour d'image des textures virtuelles : ce que les pixels ont DEMANDÉ, tuile par tuile.
 *
 * Chaque pixel pose dans la cible de retour le rang de la tuile qu'il demande, et une passe de calcul
 * (`webgpuTileReduce.ts`) en compte un sur seize. À la fin de l'image, les compteurs sont copiés dans un tampon de
 * lecture et remis à zéro ; la lecture est asynchrone et revient une image plus tard, sans jamais
 * bloquer l'image en cours. Deux tampons de lecture se relaient : l'un se mappe pendant que l'autre
 * reçoit la copie suivante.
 *
 * La phase avance d'une image à l'autre pour que les seize pixels d'un carré aient tous parlé en
 * seize images ; une barrière qui doit converger demande tous les pixels d'un coup.
 */
/** Le mot de phase : le bit `FEEDBACK_EVERY` demande tous les pixels ; sinon les deux bits bas
 *  donnent la colonne et les deux suivants la ligne du pixel parlant dans chaque carré de
 *  `FEEDBACK_STRIDE`, donc `FEEDBACK_EVERY` phases avant d'avoir entendu tout le carré. */
export const FEEDBACK_STRIDE = 4;
export const FEEDBACK_EVERY = FEEDBACK_STRIDE * FEEDBACK_STRIDE;

export type WebgpuTileFeedback = {
  readonly buffer: GPUBuffer;
  readonly entries: number;
  /** Le mot que l'uniforme porte : la phase, ou « tous les pixels » pendant une convergence. */
  phaseWord(every: boolean): number;
  /** Copie les compteurs vers un tampon de lecture libre et les remet à zéro, dans l'image. */
  encode(encoder: GPUCommandEncoder): void;
  /** L'image est soumise : la copie qu'elle portait se mappe ; la phase avance. */
  submitted(): void;
  /** Les derniers compteurs revenus, une fois ; `undefined` tant qu'aucun n'est revenu. */
  take(): Uint32Array | undefined;
  /** Tenue quand toute lecture en vol est revenue. */
  settled(): Promise<void>;
  destroy(): void;
};

type Device = Pick<GPUDevice, 'createBuffer'>;

export function createWebgpuTileFeedback(device: Device, entries: number): WebgpuTileFeedback {
  const bytes = Math.max(16, entries * 4);
  const buffer = device.createBuffer({
    label: 'WG texture feedback',
    size: bytes,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
  });
  const staging = [0, 1].map((rank) =>
    device.createBuffer({
      label: `WG texture feedback readback ${rank}`,
      size: bytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    }),
  );
  // Par tampon de lecture : une copie encodée mais pas soumise, ou un mappage en vol.
  const copied = [false, false],
    busy = [false, false];
  const inFlight = new Set<Promise<void>>();
  // Les compteurs revenus, un tableau par tampon de lecture : rien n'est alloué par image.
  const held = [0, 1].map(() => new Uint32Array(entries));
  let next = 0,
    phase = 0,
    latest: Uint32Array | undefined;
  return {
    buffer,
    entries,
    phaseWord: (every) => (every ? FEEDBACK_EVERY : 0) | phase,
    encode(encoder) {
      if (busy[next] || copied[next]) return;
      encoder.copyBufferToBuffer(buffer, 0, staging[next], 0, bytes);
      encoder.clearBuffer(buffer);
      copied[next] = true;
    },
    submitted() {
      phase = (phase + 1) % FEEDBACK_EVERY;
      if (!copied[next]) return;
      const rank = next;
      copied[rank] = false;
      busy[rank] = true;
      const target = staging[rank];
      const read = target
        .mapAsync(GPUMapMode.READ)
        .then(() => {
          held[rank].set(new Uint32Array(target.getMappedRange(), 0, entries));
          target.unmap();
          latest = held[rank];
        })
        .catch(() => undefined)
        .finally(() => {
          busy[rank] = false;
          inFlight.delete(read);
        });
      inFlight.add(read);
      next ^= 1;
    },
    take() {
      const counts = latest;
      latest = undefined;
      return counts;
    },
    settled: () => Promise.all(inFlight).then(() => undefined),
    destroy() {
      buffer.destroy();
      for (const target of staging) target.destroy();
    },
  };
}
