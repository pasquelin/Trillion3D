/** Mot de résidence d'une couche dont la pleine résolution est là et les mips régénérés. */
const ATLAS_READY = 0xffffffff;

/** Les niveaux progressifs qu'une texture attend, du plus fin porté au 1×1. */
export type SlotPyramid = { first: number; last: number };

/**
 * Les tables de slots que les shaders lisent.
 *
 * Un slot est le rang qu'une texture porte dans la table des pages (`mapIndex`, `roughnessIndex`…)
 * et il ne bouge plus : la classe de taille et la couche où elle a été rangée vivent ici, dans un
 * mot par slot, si bien que le découpage de l'atlas en classes ne touche pas au format de la table
 * des pages. Pour la couleur, un second mot dit jusqu'où sa chaîne de mips est résidente —
 * `finest | coarsest<<8` pendant le chargement, `ATLAS_READY` une fois la pleine résolution
 * remipmappée, valeur à laquelle le shader reprend le chemin d'échantillonnage ordinaire.
 *
 * Un slot dont rien n'est encore arrivé vaut zéro : le shader y lit le niveau 0, c'est-à-dire le
 * remplissage de la couche, exactement comme avant que les niveaux progressifs existent.
 */
export type WebgpuAtlasSlots = {
  /** `array<vec2u>` : classe et couche, puis résidence. */
  color: GPUBuffer;
  /** `array<u32>` : classe et couche seules ; aucun niveau progressif côté données. */
  data: GPUBuffer;
  /** Un niveau progressif de plus est écrit ; la résidence n'avance que sur une suite sans trou. */
  markLevel(slot: number, level: number, pyramid: SlotPyramid): void;
  /** Les couches dont la pleine résolution est transférée et remipmappée passent au chemin ordinaire. */
  markReady(slots: readonly number[]): void;
  destroy(): void;
};

export function createWebgpuAtlasSlots(
  device: GPUDevice,
  colorWords: Uint32Array<ArrayBuffer>,
  dataWords: Uint32Array<ArrayBuffer>,
): WebgpuAtlasSlots {
  const count = colorWords.length;
  const words = new Uint32Array(count * 2);
  for (let slot = 0; slot < count; slot++) words[slot * 2] = colorWords[slot];
  // La couche 0 est le blanc définitif des matériaux sans texture : rien ne la transfère jamais,
  // et sa chaîne de mips est faite à la préparation, donc elle est prête d'emblée.
  words[1] = ATLAS_READY;
  const seen = new Uint32Array(count);
  const color = device.createBuffer({
    size: Math.max(16, words.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  const data = device.createBuffer({
    size: Math.max(16, dataWords.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(color, 0, words);
  device.queue.writeBuffer(data, 0, dataWords);
  const writeLod = (slot: number, value: number) => {
    if (words[slot * 2 + 1] === value) return;
    words[slot * 2 + 1] = value;
    device.queue.writeBuffer(color, slot * 8 + 4, words, slot * 2 + 1, 1);
  };
  const valid = (slot: number) => Number.isInteger(slot) && slot >= 1 && slot < count;
  return {
    color,
    data,
    markLevel(slot, level, pyramid) {
      if (!valid(slot) || words[slot * 2 + 1] === ATLAS_READY) return;
      seen[slot] |= 1 << level;
      // Échantillonner à un niveau plus fin que le plus fin écrit montrerait du remplissage : la
      // résidence ne descend donc qu'au bas d'une suite de niveaux tous écrits depuis le 1×1.
      let finest = pyramid.last + 1;
      for (let step = pyramid.last; step >= pyramid.first; step--) {
        if ((seen[slot] & (1 << step)) === 0) break;
        finest = step;
      }
      if (finest <= pyramid.last) writeLod(slot, finest | (pyramid.last << 8));
    },
    markReady(slots) {
      for (const slot of slots) if (valid(slot)) writeLod(slot, ATLAS_READY);
    },
    destroy() {
      color.destroy();
      data.destroy();
    },
  };
}
