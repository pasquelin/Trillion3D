// Justesse de l'erreur écran : l'erreur annoncée par `clusterErrorPixels` majore-t-elle le vrai
// déplacement, en pixels, de tout point de la sphère déplacé d'au plus ε, après projection
// perspective ?
//
// Chaque cas tire une vue (rotation, échelle non uniforme ou uniforme), une sphère objet dont le
// centre de vue va jusqu'aux bords du champ, une erreur ε, puis cherche le pire couple (point de la
// sphère, déplacement) : points extrêmes et tirés, direction de vue par famille ramenée en objet à
// la longueur ε, puis montée locale. Familles : déplacement perpendiculaire à l'axe de vue,
// en profondeur (vers la caméra et à l'opposé), oblique (quelconque, et la pire direction
// analytique), et sphère dont le point le plus proche frôle le plan proche. Le pire rapport
// réel/annoncé est donné pour l'ancienne formule (`ε·s·f / (|C| − r·s)`, recopiée ici) et pour le
// moteur ; la monotonie (distance le long du rayon, rayon croissant) est vérifiée sur le moteur.
//
// node --experimental-strip-types packages/sdk-browser/bench/justesse/erreur-ecran-borne.mjs [cas]
import assert from 'node:assert/strict';
import { clusterErrorPixels, maxStretch } from '../../../sdk-core/index.ts';

const CAS = Number(process.argv[2] ?? 20000);
let graine = 0x9e3779b9;
const hasard = () => {
  graine = (graine + 0x6d2b79f5) | 0;
  let t = Math.imul(graine ^ (graine >>> 15), 1 | graine);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const entre = (a, b) => a + (b - a) * hasard();
const log = (a, b) => a * (b / a) ** hasard();
const unitaire = () => {
  const z = entre(-1, 1),
    a = entre(0, 2 * Math.PI),
    r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), r * Math.sin(a), z];
};
const norme = (v) => Math.hypot(v[0], v[1], v[2]);
const applique = (m, v) => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);

/** L'ancienne formule, telle que le moteur l'appliquait avant la correction. */
function ancienne(error, stretch, c, radius, focal, near) {
  const distance = norme(c) - radius * stretch;
  return distance > near ? (error * stretch * focal) / distance : Infinity;
}

/** Une vue tirée : linéaire L = R·S, son inverse, étirement, focales et centre de vue imposé. */
function tirerCas(famille) {
  const q = unitaire(),
    angle = entre(0, Math.PI),
    [x, y, z] = q,
    c = Math.cos(angle),
    s1 = Math.sin(angle),
    u = 1 - c;
  const R = [
    [c + x * x * u, x * y * u - z * s1, x * z * u + y * s1],
    [y * x * u + z * s1, c + y * y * u, y * z * u - x * s1],
    [z * x * u - y * s1, z * y * u + x * s1, c + z * z * u],
  ];
  const uniforme = hasard() < 0.35;
  const S = uniforme ? Array(3).fill(log(0.2, 5)) : [log(0.2, 5), log(0.2, 5), log(0.2, 5)];
  const L = R.map((ligne) => ligne.map((v, j) => v * S[j]));
  const Linv = [0, 1, 2].map((i) => [0, 1, 2].map((j) => R[j][i] / S[i]));
  const elements = [L[0][0], L[1][0], L[2][0], 0, L[0][1], L[1][1], L[2][1], 0];
  elements.push(L[0][2], L[1][2], L[2][2], 0, 0, 0, 0, 1);
  const stretch = maxStretch(elements);
  const fov = entre(20, 120) * (Math.PI / 180),
    aspect = log(0.5, 2.5),
    near = log(0.01, 1);
  const p11 = 1 / Math.tan(fov / 2),
    p00 = p11 / aspect,
    hauteur = Math.round(entre(300, 2200));
  const fx = (Math.round(hauteur * aspect) * p00) / 2,
    fy = (hauteur * p11) / 2;
  const radius = log(1e-3, 3),
    rho = radius * stretch;
  const error = radius * log(1e-4, 0.5);
  const delta = error * stretch;
  const nearest = famille === 'planProche' ? near + delta + near * log(1e-6, 0.5) : 0;
  const depth = famille === 'planProche' ? nearest + rho : near + delta + rho + log(1e-3, 1e3);
  const centre = [(entre(-1, 1) * depth) / p00, (entre(-1, 1) * depth) / p11, -depth];
  return { L, Linv, stretch, fx, fy, near, radius, error, centre };
}

/** Déplacement écran réel du point de vue `p` déplacé de `d` (vue), en pixels. */
function reel(k, p, d) {
  const z0 = -p[2],
    z1 = -(p[2] + d[2]);
  if (!(z1 > 0) || !(z0 > 0)) return Infinity;
  const du = k.fx * ((p[0] + d[0]) / z1 - p[0] / z0),
    dv = k.fy * ((p[1] + d[1]) / z1 - p[1] / z0);
  return Math.hypot(du, dv);
}

/** Direction de vue de la famille, ramenée à un déplacement objet de longueur ε puis en vue. */
function deplacement(k, famille, p, graineDir) {
  let d;
  if (famille === 'perpendiculaire') {
    const a = graineDir[0] * Math.PI;
    d = [Math.cos(a), Math.sin(a), 0];
  } else if (famille === 'profondeur') d = [0, 0, graineDir[0] < 0 ? -1 : 1];
  else if (graineDir[1] > 0.5) {
    const qx = p[0] / -p[2],
      qy = p[1] / -p[2],
      q2 = qx * qx + qy * qy;
    d = [qx, qy, q2 * Math.sign(graineDir[0] || 1)];
  } else d = graineDir.slice(2, 5);
  const objet = applique(k.Linv, d),
    n = norme(objet);
  return applique(
    k.L,
    objet.map((v) => (v / n) * k.error),
  );
}

function pireDuCas(k, famille) {
  const vue = (u, t) => {
    const r = k.radius * t;
    return applique(k.L, [u[0] * r, u[1] * r, u[2] * r]).map((v, i) => v + k.centre[i]);
  };
  const essai = (u, t, g) => {
    const p = vue(u, t);
    return reel(k, p, deplacement(k, famille, p, g));
  };
  let meilleur = { v: -1 };
  for (let i = 0; i < 24; i++) {
    const u = unitaire(),
      t = i < 16 ? 1 : hasard();
    const g = [entre(-1, 1), hasard(), ...unitaire()];
    const v = essai(u, t, g);
    if (v > meilleur.v) meilleur = { v, u, t, g };
  }
  for (let pas = 0.5; pas > 1e-3; pas *= 0.7) {
    const u = meilleur.u.map((x) => x + pas * entre(-1, 1)),
      n = norme(u);
    const g = meilleur.g.map((x, i) => (i === 1 ? x : x + pas * entre(-1, 1)));
    const v = essai(
      u.map((x) => x / n),
      Math.min(1, meilleur.t + pas * entre(-0.2, 0.2)),
      g,
    );
    if (v > meilleur.v) meilleur = { v, u: u.map((x) => x / n), t: meilleur.t, g };
  }
  return meilleur.v;
}

const familles = ['perpendiculaire', 'profondeur', 'oblique', 'planProche'];
const rapport = { cas: CAS, familles: {} };
let violationsMoteur = 0,
  monotonie = 0;
/** Pire rapport réel/annoncé, rapport médian et violations d'une série. */
const serie = () => ({ rapports: [], violations: 0 });
const ajoute = (s, vrai, annonce) => {
  if (!Number.isFinite(annonce)) return;
  s.rapports.push(vrai / annonce);
  if (vrai > annonce) s.violations++;
};
const resume = (s) => {
  const r = s.rapports.sort((a, b) => a - b),
    arrondi = (v) => Number((v ?? 0).toFixed(4));
  return {
    pire: arrondi(r[r.length - 1]),
    median: arrondi(r[r.length >> 1]),
    violations: s.violations,
  };
};
for (const famille of familles) {
  const series = { ancienne: serie(), moteur: serie(), ancienneSpherePetite: serie() };
  series.moteurSpherePetite = serie();
  for (let i = 0; i < CAS; i++) {
    const k = tirerCas(famille);
    const focal = Math.max(k.fx, k.fy),
      [cx, cy, cz] = k.centre;
    const moteur = (m, r) =>
      clusterErrorPixels(k.error, k.stretch, cx * m, cy * m, cz * m, r, focal, k.near);
    const annonce = moteur(1, k.radius);
    const avant = ancienne(k.error, k.stretch, k.centre, k.radius, focal, k.near);
    const vrai = pireDuCas(k, famille);
    ajoute(series.ancienne, vrai, avant);
    ajoute(series.moteur, vrai, annonce);
    // Régime courant : la sphère étirée tient dans 2 % de sa profondeur.
    if (k.radius * k.stretch < -cz * 0.02) {
      ajoute(series.ancienneSpherePetite, vrai, avant);
      ajoute(series.moteurSpherePetite, vrai, annonce);
    }
    const loin = moteur(2, k.radius),
      grand = moteur(1, k.radius * 1.5);
    if (!(loin <= annonce) || !(grand >= annonce)) monotonie++;
  }
  violationsMoteur += series.moteur.violations;
  rapport.familles[famille] = Object.fromEntries(
    Object.entries(series).map(([nom, s]) => [nom, resume(s)]),
  );
}
rapport.violationsMoteur = violationsMoteur;
rapport.monotonieRompue = monotonie;
console.log(JSON.stringify(rapport, null, 2));
assert.equal(monotonie, 0, 'monotonie rompue : distance le long du rayon ou rayon croissant');
assert.equal(violationsMoteur, 0, 'le moteur annonce moins que le déplacement écran réel');
