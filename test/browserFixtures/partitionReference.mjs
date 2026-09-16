// La référence des rectangles d'écran et des bornes de profondeur : l'arithmétique en DOUBLE
// précision que le processeur faisait, ligne par ligne, avant que la partition ne passe sur la
// carte. Elle est transcrite ici terme pour terme depuis `projectCornersInto` (hizCorners.ts) et
// `hizNearestBound` (hizNearestBound.ts) : ces modules ne sont pas publics, et une transcription
// indépendante est de toute façon ce qu'une preuve demande — deux implémentations qui se comparent.
//
// Ce que la comparaison vérifie, cluster par cluster :
//   1. le rectangle de la carte CONTIENT celui de la référence (chaque borne est au moins aussi
//      large, jamais plus étroite d'un texel) ;
//   2. une boîte que la référence dit coupée par le plan proche porte le drapeau de coupe côté
//      carte, donc ne peut jamais être rejetée ;
//   3. la profondeur de la carte MINORE celle de la référence, biais de couche coplanaire compris.

const SHRINK = 1 - 2 ** -24;

/** `biasedDepthBits` : le biais de couche, retranché sur les bits mêmes de la simple précision. */
const scratch = new Float32Array(1),
  scratchWords = new Uint32Array(scratch.buffer);
function nearestBound(nearest, layer) {
  if (!(nearest > 0)) return nearest;
  const below = Math.fround(nearest * SHRINK);
  if (!layer) return below;
  scratch[0] = below;
  const units = Math.min(layer, 15) * 16;
  scratchWords[0] = Math.max(0, scratchWords[0] - units) >>> 0;
  return scratch[0];
}

/** Le rectangle d'écran et la borne de profondeur d'une boîte, en double précision. */
export function referenceBox(corners, from, view, viewProj, near, width, height, layer) {
  let lowX = Infinity,
    lowY = Infinity,
    highX = -Infinity,
    highY = -Infinity,
    lowZ = Infinity,
    clipsNear = false,
    projected = 0;
  const v = view,
    e = viewProj;
  for (let i = 0; i < 8; i++) {
    const at = from + i * 3,
      x = corners[at],
      y = corners[at + 1],
      z = corners[at + 2];
    const viewZ = v[2] * x + v[6] * y + v[10] * z + v[14];
    const vd = v[3] * x + v[7] * y + v[11] * z + v[15];
    if (-(vd === 1 ? viewZ : viewZ * (1 / vd)) <= near) {
      clipsNear = true;
      break;
    }
    const cw = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (cw <= 0 || !Number.isFinite(cw)) {
      clipsNear = true;
      break;
    }
    const ndcX = (e[0] * x + e[4] * y + e[8] * z + e[12]) / cw,
      ndcY = (e[1] * x + e[5] * y + e[9] * z + e[13]) / cw,
      ndcZ = (e[2] * x + e[6] * y + e[10] * z + e[14]) / cw;
    if (ndcX < lowX) lowX = ndcX;
    if (ndcX > highX) highX = ndcX;
    if (ndcY < lowY) lowY = ndcY;
    if (ndcY > highY) highY = ndcY;
    if (ndcZ < lowZ) lowZ = ndcZ;
    projected++;
  }
  if (!projected || clipsNear) return { clipsNear: true, rect: [0, 0, 0, 0], nearest: 0 };
  return {
    clipsNear: false,
    rect: [
      Math.floor((lowX * 0.5 + 0.5) * width),
      Math.floor((1 - (highY * 0.5 + 0.5)) * height),
      Math.ceil((highX * 0.5 + 0.5) * width),
      Math.ceil((1 - (lowY * 0.5 + 0.5)) * height),
    ],
    nearest: nearestBound(lowZ * 0.5 + 0.5, layer),
  };
}

/** Compare l'audit d'une image à la référence, ligne par ligne, et accumule dans `total`. */
export function compareAudit(audit, total) {
  const { rows, view, viewProj, near, width, height, corners, layers } = audit;
  for (let row = 0; row < rows; row++) {
    const ref = referenceBox(corners, row * 24, view, viewProj, near, width, height, layers[row]);
    total.clusters++;
    if (ref.clipsNear) {
      total.coupes++;
      // Règle 2 : une boîte que la référence dit coupée doit porter le drapeau côté carte.
      if (!audit.clips[row]) total.violations2++;
      continue;
    }
    // Une boîte que la carte dit coupée alors que la référence ne le dit pas n'est jamais rejetée :
    // c'est plus conservateur, jamais moins. On la compte, on ne la compare pas.
    if (audit.clips[row]) {
      total.coupesGpuSeules++;
      continue;
    }
    total.compares++;
    const [rx0, ry0, rx1, ry1] = ref.rect;
    const gx0 = audit.rect[row * 4],
      gy0 = audit.rect[row * 4 + 1],
      gx1 = audit.rect[row * 4 + 2],
      gy1 = audit.rect[row * 4 + 3];
    // Règle 1 : contenance. La marge est ce que la carte a ajouté de chaque côté, en texels.
    const marges = [rx0 - gx0, ry0 - gy0, gx1 - rx1, gy1 - ry1];
    for (const marge of marges) {
      if (marge < 0) total.violations1++;
      total.margeTexelsSomme += marge;
      if (marge > total.margeTexelsMax) total.margeTexelsMax = marge;
      total.margeTexelsCount++;
      // La moyenne d'une marge est écrasée par quelques boîtes rasantes : ce qui décrit vraiment la
      // perte de finesse du test est la répartition — combien de côtés n'ont pas bougé d'un texel.
      total.margeParPalier[marge <= 0 ? 0 : marge <= 1 ? 1 : marge <= 4 ? 2 : marge <= 16 ? 3 : 4]++;
    }
    // La largeur du rectangle de la carte, comparée au noyau de seize texels du test : au-delà, la
    // boîte répond depuis un mip plus grossier et rejette moins.
    const largeur = Math.max(gx1 - gx0, gy1 - gy0),
      largeurRef = Math.max(rx1 - rx0, ry1 - ry0);
    total.largeurParPalier[largeur < 16 ? 0 : largeur < 64 ? 1 : largeur < 256 ? 2 : 3]++;
    total.largeurRefParPalier[largeurRef < 16 ? 0 : largeurRef < 64 ? 1 : largeurRef < 256 ? 2 : 3]++;
    // Règle 3 : minoration. L'écart est ce que la carte a descendu sous la référence.
    const ecart = ref.nearest - audit.nearest[row];
    if (ecart < 0) total.violations3++;
    total.ecartProfondeurSomme += ecart;
    if (ecart > total.ecartProfondeurMax) total.ecartProfondeurMax = ecart;
  }
}

export function emptyTotals() {
  return {
    clusters: 0,
    compares: 0,
    coupes: 0,
    coupesGpuSeules: 0,
    violations1: 0,
    violations2: 0,
    violations3: 0,
    margeTexelsSomme: 0,
    margeTexelsMax: 0,
    margeTexelsCount: 0,
    /** Côtés de rectangle par palier de marge : 0, ≤ 1, ≤ 4, ≤ 16, au-delà. */
    margeParPalier: [0, 0, 0, 0, 0],
    /** Boîtes par palier de largeur écran, carte puis référence : < 16, < 64, < 256, au-delà. */
    largeurParPalier: [0, 0, 0, 0],
    largeurRefParPalier: [0, 0, 0, 0],
    ecartProfondeurSomme: 0,
    ecartProfondeurMax: 0,
  };
}
