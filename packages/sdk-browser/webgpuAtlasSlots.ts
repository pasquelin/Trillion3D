/** Mot de résidence d'une couche dont la chaîne entière est là, niveau 0 compris. */
const ATLAS_READY = 0xffffffff;

/** Les niveaux qu'une couche attend, du plus fin — 0 quand la chaîne est cuite — au 1×1. */
export type SlotPyramid = { first: number; last: number };

type AtlasKind = 'color' | 'data';

/**
 * Les tables de slots que les shaders lisent, une par atlas.
 *
 * Un slot est le rang qu'une texture porte dans la table des pages (`mapIndex`, `roughnessIndex`…)
 * et il ne bouge plus : la classe de taille et la couche où elle a été rangée vivent ici, dans un
 * mot par slot, si bien que le découpage de l'atlas en classes ne touche pas au format de la table
 * des pages. Un second mot dit jusqu'où sa chaîne de mips est résidente — `finest | coarsest<<8`
 * pendant le chargement, `ATLAS_READY` une fois la chaîne entière écrite, valeur à laquelle le
 * shader reprend le chemin d'échantillonnage ordinaire, à dérivées, sur la vraie texture.
 *
 * Les deux atlas portent ce second mot : depuis que les niveaux des cartes de données sont cuits et
 * arrivent un à un, une carte de normales dont seul le 128 px est là ne doit pas être lue à sa
 * pleine finesse — elle y montrerait le remplissage plat de sa couche.
 *
 * Un slot dont rien n'est encore arrivé vaut zéro : le shader y lit le niveau 0, c'est-à-dire le
 * remplissage de la couche, exactement comme avant que les niveaux progressifs existent.
 */
export type WebgpuAtlasSlots = {
  /** `array<vec2u>` : classe et couche, puis résidence. */
  color: GPUBuffer;
  /** `array<vec2u>` : de même pour les données. */
  data: GPUBuffer;
  /** Un niveau de plus est écrit ; la résidence n'avance que sur une suite sans trou, et la couche
   *  passe à « prêt » d'elle-même quand cette suite atteint le niveau 0. */
  markLevel(kind: AtlasKind, slot: number, level: number, pyramid: SlotPyramid): void;
  /** Les couches dont la pleine résolution est transférée et remipmappée passent au chemin ordinaire. */
  markReady(kind: AtlasKind, slots: readonly number[]): void;
  destroy(): void;
};

/** La table d'un atlas : ses mots, son tampon, et ce qu'elle a déjà vu de chaque slot. */
function table(device: GPUDevice, classWords: Uint32Array<ArrayBuffer>) {
  const count = classWords.length;
  const words = new Uint32Array(count * 2);
  for (let slot = 0; slot < count; slot++) words[slot * 2] = classWords[slot];
  // La couche 0 est le remplissage définitif des matériaux sans texture : rien ne la transfère
  // jamais, et sa chaîne de mips est faite à la préparation, donc elle est prête d'emblée.
  words[1] = ATLAS_READY;
  const seen = new Uint32Array(count);
  const buffer = device.createBuffer({
    size: Math.max(16, words.byteLength),
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(buffer, 0, words);
  const writeLod = (slot: number, value: number) => {
    if (words[slot * 2 + 1] === value) return;
    words[slot * 2 + 1] = value;
    device.queue.writeBuffer(buffer, slot * 8 + 4, words, slot * 2 + 1, 1);
  };
  const valid = (slot: number) => Number.isInteger(slot) && slot >= 1 && slot < count;
  return {
    buffer,
    markLevel(slot: number, level: number, pyramid: SlotPyramid) {
      if (!valid(slot) || words[slot * 2 + 1] === ATLAS_READY) return;
      seen[slot] |= 1 << level;
      // Échantillonner à un niveau plus fin que le plus fin écrit montrerait du remplissage : la
      // résidence ne descend donc qu'au bas d'une suite de niveaux tous écrits depuis le 1×1.
      let finest = pyramid.last + 1;
      for (let step = pyramid.last; step >= pyramid.first; step--) {
        if ((seen[slot] & (1 << step)) === 0) break;
        finest = step;
      }
      if (finest === 0) writeLod(slot, ATLAS_READY);
      else if (finest <= pyramid.last) writeLod(slot, finest | (pyramid.last << 8));
    },
    markReady(slots: readonly number[]) {
      for (const slot of slots) if (valid(slot)) writeLod(slot, ATLAS_READY);
    },
  };
}

export function createWebgpuAtlasSlots(
  device: GPUDevice,
  colorWords: Uint32Array<ArrayBuffer>,
  dataWords: Uint32Array<ArrayBuffer>,
): WebgpuAtlasSlots {
  const tables = { color: table(device, colorWords), data: table(device, dataWords) };
  return {
    color: tables.color.buffer,
    data: tables.data.buffer,
    markLevel(kind, slot, level, pyramid) {
      tables[kind].markLevel(slot, level, pyramid);
    },
    markReady(kind, slots) {
      tables[kind].markReady(slots);
    },
    destroy() {
      tables.color.buffer.destroy();
      tables.data.buffer.destroy();
    },
  };
}
