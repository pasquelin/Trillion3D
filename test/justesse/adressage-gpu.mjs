// Defect 4, GPU side: the engine addressing WGSL run in Chromium WebGPU, on
// a real texture with distinct texels, beside the real sampler set as Three sets
// its own (map mode → `addressMode`). Two filterings: nearest (the chosen texel) and
// linear (the engine sampler's actual filtering, compared bit for bit).
//   node --experimental-strip-types \
//     test/justesse/adressage-gpu.mjs [sortie.json]
// Blocking: any nearest gap off a boundary; any bit-for-bit linear gap off a seam;
// and, on a period seam, any read that leaves the exact rule by more than half a
// level in 255 — the blend the engine writes itself cannot recover, bit for bit, the
// weight the sampler quantises, but it must return the same colour to that level.
// For the record only: nearest on an exact boundary, the texel depends on the 32-bit
// rounding of u·size.
import { writeFileSync } from 'node:fs';
import { wrapNibble } from '../../packages/sdk-browser/visibilityWrapModes.ts';
import {
  ADRESSE,
  bilan,
  cas,
  lineaireThree,
  melange,
  octetsTexture,
  somme,
  TAILLES,
  TOLERANCE,
} from './adressageCas.mjs';
import { executerDansChromium, MELANGE, NUANCEUR_PRISES } from './adressageGpuPage.mjs';

/** The addressing nibble of a map, the one `webgpuPageRow.ts` and `webgpuBlendPrepare.ts`
 *  store in the page word, by the same function. */
const drapeaux = (c) => wrapNibble({ wrapS: c.wrapS, wrapT: c.wrapT });

const tous = cas();
const lots = [];
for (const filtre of ['nearest', 'linear'])
  TAILLES.forEach(([largeur, hauteur], texture) => {
    for (const [wrapS, adresseS] of ADRESSE)
      for (const [wrapT, adresseT] of ADRESSE) {
        const membres = tous.filter(
          (c) =>
            c.largeur === largeur &&
            c.hauteur === hauteur &&
            c.wrapS === wrapS &&
            c.wrapT === wrapT,
        );
        const uv = membres.flatMap((c) => [c.u, c.v]);
        lots.push({
          filtre,
          texture,
          membres,
          adresseS,
          adresseT,
          uv,
          flags: membres.map((c) => drapeaux(c) | (filtre === 'linear' ? MELANGE : 0)),
        });
      }
  });

const sorties = await executerDansChromium({
  shader: NUANCEUR_PRISES,
  textures: TAILLES.map(([largeur, hauteur]) => ({
    largeur,
    hauteur,
    octets: Array.from(octetsTexture(largeur, hauteur)),
  })),
  lots: lots.map(({ filtre, texture, adresseS, adresseT, uv, flags }) => ({
    filtre,
    texture,
    adresseS,
    adresseT,
    uv,
    flags,
  })),
});

/** Each case finds its read-back row, nearest then linear (same lot order). */
const lecture = { nearest: new Map(), linear: new Map() };
lots.forEach((lot, l) =>
  lot.membres.forEach((c, i) => lecture[lot.filtre].set(c, { ...sorties[l], i })),
);
const exemple = (c, a, b) =>
  `${c.largeur}x${c.hauteur} S=${c.nomS} T=${c.nomT} uv=(${c.u}, ${c.v}) ${a} ≠ ${b}`;
const texel = (cote) => (c, k) => {
  const { i, [cote]: valeurs } = lecture.nearest.get(c);
  const lu = [0, 1].map((j) => Math.round((valeurs[i * 4 + j] * 255 - 20) / 40));
  return lu[k] === c.attendu[k] ? null : exemple(c, `Three=${c.attendu}`, `lu=${lu}`);
};
const lineaire = (c, k) => {
  const { i, moteur, three } = lecture.linear.get(c);
  const a = moteur[i * 4 + k],
    b = three[i * 4 + k];
  return Object.is(a, b) ? null : exemple(c, `moteur=${a * 255}`, `Three=${b * 255}`);
};
/** The exact colour of the rule: the two texels of axis `k`, blended in double precision. */
const regle = (c, k) =>
  melange(lineaireThree(k ? c.v : c.u, k ? c.hauteur : c.largeur, k ? c.wrapT : c.wrapS));
/** Gap of one side to the exact rule, in levels of 255; `null` under the tolerance. */
const contreRegle = (cote) => (c, k) => {
  const { i, [cote]: valeurs } = lecture.linear.get(c);
  const lu = valeurs[i * 4 + k] * 255,
    attendu = regle(c, k);
  return Math.abs(lu - attendu) <= TOLERANCE ? null : exemple(c, `lu=${lu}`, `rule=${attendu}`);
};
/** Worst gap of one side to the rule, every component exercised: the filtering's own noise. */
const pire = (cote) =>
  tous.reduce((m, c) => {
    const { i, [cote]: valeurs } = lecture.linear.get(c);
    const k = c.axe === 'u' ? 0 : 1;
    return Math.max(m, Math.abs(valeurs[i * 4 + k] * 255 - regle(c, k)));
  }, 0);

const n = tous.length;
bilan(`Three sampler nearest against the reference rule (${n} cases)`, tous, texel('three'));
const proches = bilan(`Engine WGSL nearest against Three (${n} cases)`, tous, texel('moteur'));
const lineaires = bilan(
  `Engine WGSL linear against Three, bit for bit (${n} cases)`,
  tous,
  lineaire,
);
bilan(
  `Three sampler linear against the exact rule, ±${TOLERANCE}/255 (${n} cases)`,
  tous,
  contreRegle('three'),
);
const exacts = bilan(
  `Engine WGSL linear against the exact rule, ±${TOLERANCE}/255 (${n} cases)`,
  tous,
  contreRegle('moteur'),
);
console.log(
  `\nWorst gap to the exact rule: engine ${pire('moteur').toFixed(4)}/255,` +
    ` Three sampler ${pire('three').toFixed(4)}/255`,
);
const bloquants =
  somme(proches, (cle) => !cle.includes('frontiere')) +
  somme(lineaires, (cle) => !cle.includes('couture')) +
  somme(exacts);
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(sorties.map((s) => s.moteur)));
console.log(`\nGPU: ${bloquants} blocking gaps`);
process.exitCode = bloquants ? 1 : 0;
