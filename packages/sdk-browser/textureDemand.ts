/**
 * Ce que l'écran demande de chaque couche d'atlas, et le niveau de mip qui en découle.
 *
 * Une couche ne vaut pas par le nombre de triangles qui la lisent mais par la place qu'elle prend à
 * l'écran : une façade de deux triangles qui occupe la moitié de l'image passe avant un feuillage de
 * cent mille triangles large de trois pixels. L'empreinte écran d'un cluster et l'étendue uv de sa
 * géométrie donnent ensemble le rapport texel/pixel, donc le niveau de mip réellement utile —
 * `log2(texels / pixels)` arrondi, borné à la pyramide. Hors champ, une couche ne demande que sa
 * queue résidente, celle des aperçus, jamais un niveau fin.
 *
 * Tout tient dans des tableaux typés réécrits sur place : une image n'alloue rien ici, et les
 * tableaux ne grandissent qu'à la première image d'une scène, quand le nombre de couches se révèle.
 */

/** Niveau « queue résidente seule » : tout ce qui est hors champ le demande. */
export const TAIL_LEVEL = 15;
/** Images consécutives durant lesquelles un niveau doit être demandé avant d'être publié. */
const STABLE_FRAMES = 3;
/** Un niveau plus grossier ne devient le niveau publié qu'au-delà de cette marge : sans elle, un
 *  pas de caméra d'un pixel ferait battre la couche entre deux niveaux, image après image. */
const COARSER_SLACK = 2;

type DemandCounters = {
  /** Couches visibles dont le niveau voulu est résident. */
  atWanted: number;
  /** Couches visibles, celles dont une surface demandée lit l'atlas. */
  visible: number;
  /** Niveaux manquants en moyenne sur ces couches. */
  missingAverage: number;
};

function grown(values: Float64Array, layer: number) {
  let size = values.length || 8;
  while (size <= layer) size *= 2;
  const bigger = new Float64Array(size);
  bigger.set(values);
  return bigger;
}

export function createTextureDemand() {
  let area = new Float64Array(0),
    span = new Float64Array(0),
    uv = new Float64Array(0);
  /** Niveau résident le plus fin déjà écrit ; `TAIL_LEVEL + 1` tant que rien n'est arrivé. */
  let finest = new Float64Array(0);
  let wanted = new Float64Array(0),
    raw = new Float64Array(0),
    stable = new Float64Array(0),
    known = new Float64Array(0);
  let count = 0;
  const counters: DemandCounters = { atWanted: 0, visible: 0, missingAverage: 0 };
  const ensure = (layer: number) => {
    if (layer < area.length) return;
    area = grown(area, layer);
    span = grown(span, layer);
    uv = grown(uv, layer);
    const grownFinest = grown(finest, layer);
    grownFinest.fill(TAIL_LEVEL + 1, finest.length);
    finest = grownFinest;
    const grownWanted = grown(wanted, layer);
    grownWanted.fill(TAIL_LEVEL, wanted.length);
    wanted = grownWanted;
    raw = grown(raw, layer);
    stable = grown(stable, layer);
    known = grown(known, layer);
  };
  return {
    /** Vide les empreintes de l'image précédente ; la résidence et les niveaux publiés restent. */
    reset() {
      area.fill(0);
      span.fill(0);
      uv.fill(0);
      count = 0;
    },
    /** Une surface demandée lit ces couches : elle y dépose son empreinte et son étendue uv. */
    add(layers: readonly number[], pixels: number, areaPixels: number, uvSpan: number) {
      for (const layer of layers) {
        ensure(layer);
        area[layer] += areaPixels;
        if (pixels > span[layer]) {
          span[layer] = pixels;
          uv[layer] = uvSpan;
        }
      }
    },
    /** Un niveau de plus est écrit sur ce slot : la résidence ne descend jamais d'elle-même. */
    markLevel(slot: number, level: number) {
      ensure(slot);
      if (level < finest[slot]) finest[slot] = level;
    },
    /** Tout est de nouveau à transférer : une scène rechargée repart de la queue. */
    clearResidency() {
      finest.fill(TAIL_LEVEL + 1);
      wanted.fill(TAIL_LEVEL);
      stable.fill(0);
      known.fill(0);
    },
    /**
     * Arrête les niveaux voulus de l'image à partir des empreintes déposées et de la largeur en
     * texels de chaque couche, puis compte ce que l'hôte affiche. Un niveau ne devient le niveau
     * publié qu'après `STABLE_FRAMES` images identiques, et un niveau plus grossier doit en plus
     * dépasser la marge : c'est l'hystérésis qui empêche une couche de battre.
     */
    settle(texels: Float64Array | undefined) {
      let atWanted = 0,
        visible = 0,
        missing = 0;
      for (let slot = 1; slot < area.length; slot++) {
        const pixels = span[slot];
        const width = texels?.[slot] ?? 0;
        const target =
          pixels > 0 && width > 0
            ? Math.min(
                TAIL_LEVEL,
                Math.max(0, Math.round(Math.log2((width * Math.max(uv[slot], 1e-6)) / pixels))),
              )
            : TAIL_LEVEL;
        if (target === raw[slot]) stable[slot]++;
        else {
          raw[slot] = target;
          stable[slot] = 1;
        }
        // La toute première demande est publiée d'emblée : l'hystérésis empêche une couche de
        // battre, elle ne doit pas retarder de trois images la première image nette.
        if (!known[slot]) {
          known[slot] = 1;
          wanted[slot] = target;
        }
        const held = wanted[slot];
        const far = target < held || target >= held + COARSER_SLACK;
        if (far && stable[slot] >= STABLE_FRAMES) wanted[slot] = target;
        if (pixels <= 0) continue;
        visible++;
        const gap = Math.max(0, finest[slot] - wanted[slot]);
        if (gap === 0) atWanted++;
        missing += gap;
      }
      count = area.length > 1 ? area.length - 1 : 0;
      counters.atWanted = atWanted;
      counters.visible = visible;
      counters.missingAverage = visible ? missing / visible : 0;
    },
    /** Écart entre ce qui est résident et ce que l'écran demande, en niveaux de mip. */
    gapOf: (slot: number) =>
      slot < wanted.length ? Math.max(0, finest[slot] - wanted[slot]) : TAIL_LEVEL,
    wantedOf: (slot: number) => (slot < wanted.length ? wanted[slot] : TAIL_LEVEL),
    areaOf: (slot: number) => (slot < area.length ? area[slot] : 0),
    counters,
    /** Couches connues de la scène, aperçu de repli exclu. */
    get layers() {
      return count;
    },
  };
}
