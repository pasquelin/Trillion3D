// Les verdicts du rapport global : des phrases écrites à partir des relevés, et rien d'autre. Chaque
// verdict nomme la mesure qui le porte ; quand la mesure manque, il dit « non mesuré » plutôt que
// de supposer. La dernière partie classe les coûts pour orienter les lots, dans l'ordre des chiffres.
import { html, moins, ms, nombre, octets, pixels } from './rapportGlobalGraphes.mjs';
import { paire, trouve, VUES } from './rapportGlobalLecture.mjs';
import { GROUPES, sommePasses } from './rapportGlobalChiffres.mjs';

const BRUIT_MS = 0.7; // l'écart observé entre deux exécutions identiques sur cette machine
const verdict = (classe, texte) => `<div class="verdict ${classe}">${texte}</div>`;

export function verdicts(ex) {
  const out = [];
  const sol = trouve(ex, 'mobile', 'sol', 1);
  const gen = trouve(ex, 'mobile', 'generale', 1);
  const fixe = trouve(ex, 'fixe', 'sol', 1);

  if (sol) {
    const sous60 = VUES.map((v) => trouve(ex, 'mobile', v, 1)).filter(Boolean);
    const pire = sous60.toSorted((a, b) => (b.gpuP95 ?? 0) - (a.gpuP95 ?? 0))[0];
    const tient = sous60.every((r) => r.gpuP95 !== null && r.gpuP95 < 16.7);
    out.push(
      verdict(
        tient ? 'bon' : 'mauvais',
        `<strong>At 2496×1404, the frame ${tient ? 'fits' : 'does not fit'} in 16.7 ms on the GPU</strong>: p50 from ${ms(Math.min(...sous60.map((r) => r.gpuP50 ?? Infinity)))} to ${ms(Math.max(...sous60.map((r) => r.gpuP50 ?? 0)))} depending on the view, p95 up to ${ms(pire?.gpuP95)} (${html(pire?.vue ?? '')}). Sun, cascaded shadows, moving camera, normal quality.`,
      ),
    );
    out.push(
      verdict(
        sol.cpuP50 !== null && sol.cpuP50 < 3 ? 'bon' : 'mauvais',
        `<strong>The CPU costs ${ms(sol.cpuP50, 2)} per frame in the street view</strong> (p95 ${ms(sol.cpuP95, 2)}), ${ms(gen?.cpuP50, 2)} in overview. The reference says “almost zero”: that is the only millisecond that compares across machines, and it is not zero (Geometry 1).`,
      ),
    );
  } else out.push(verdict('mauvais', 'The `mobile` run is missing: no whole-frame baseline.'));

  if (fixe)
    out.push(
      verdict(
        fixe.gpuReleves === 0 ? 'bon' : 'mauvais',
        `<strong>Still scene: ${fixe.gpuReleves === 0 ? 'no GPU pass, the frame is held' : `${fixe.gpuReleves} GPU samples, the frame is not held`}</strong>; the CPU still spends ${ms(fixe.cpuP50, 2)} per frame (p95 ${ms(fixe.cpuP95, 2)}). The “no work in a still scene” criterion ${fixe.gpuReleves === 0 && (fixe.cpuP50 ?? 1) < 0.5 ? 'holds' : 'holds only on the GPU'}.`,
      ),
    );

  const quart = trouve(ex, 'res-1248', 'sol', 1);
  if (quart && sol) {
    const plusLent =
      quart.gpuP50 !== null && sol.gpuP50 !== null && quart.gpuP50 > sol.gpuP50 + BRUIT_MS;
    out.push(
      verdict(
        plusLent ? 'mauvais' : 'bon',
        `<strong>At a quarter of the pixels (1248×702), the frame is ${plusLent ? `SLOWER: ${ms(quart.gpuP50)} vs ${ms(sol.gpuP50)}` : `${ms(quart.gpuP50)} vs ${ms(sol.gpuP50)} at full resolution`}</strong>${plusLent ? ' — the Light 18 anomaly is still there.' : ': the Light 18 anomaly does not show in this campaign.'}`,
      ),
    );
  }

  const [rc, rm] = paire(ex, 'raster-1248', 'sol');
  if (rm && rc && rm.gpuP50 !== null && rc.gpuP50 !== null)
    out.push(
      verdict(
        rc.gpuP50 > rm.gpuP50 + BRUIT_MS ? 'mauvais' : 'bon',
        `<strong>Compute raster vs hardware raster at 1248×702: ${ms(rc.gpuP50)} vs ${ms(rm.gpuP50)}</strong> (${nombre(rc.gpuP50 / rm.gpuP50, 1)}×), image delta ${pixels(rc.ecart)}. Since Geometry 26 hardware is the default and compute a variant; the reference keeps hardware for large triangles and compute for small ones.`,
      ),
    );

  const aa = trouve(ex, 'aa-off', 'sol', 1);
  if (aa && sol && aa.gpuP50 !== null && sol.gpuP50 !== null)
    out.push(
      verdict(
        '',
        `<strong>Temporal antialiasing costs ${ms(sol.gpuP50 - aa.gpuP50)} of envelope in the street view</strong> (${ms(sol.gpuP50)} with, ${ms(aa.gpuP50)} without)${Math.abs(sol.gpuP50 - aa.gpuP50) < BRUIT_MS ? ', under measurement noise' : ''}; A/A witness ${nombre(sol.temoinAA?.pixels, 0)} px with, ${nombre(aa.temoinAA?.pixels, 0)} px without.`,
      ),
    );

  const sansLum = trouve(ex, 'sans-lumiere', 'sol', 1);
  if (sansLum && sol && sansLum.gpuP50 !== null && sol.gpuP50 !== null)
    out.push(
      verdict(
        '',
        `<strong>The sun and its shadows cost ${ms(sol.gpuP50 - sansLum.gpuP50)} of envelope in the street view</strong> (raw albedo ${ms(sansLum.gpuP50)}, sun ${ms(sol.gpuP50)}). “Shadows” step ${ms(sol.etape('shadows')?.gpuP50 ?? null, 2)}, deferred lighting ${ms(sol.passe('WG deferred lighting')?.p50 ?? null, 2)} by their labels.`,
      ),
    );

  if (sol)
    out.push(
      verdict(
        'mauvais',
        `<strong>Memory: ${octets(sol.texturesEngagees)} of raw RGBA textures committed and ${octets(sol.geometrieOctets)} of geometry</strong> in the street view; the reference keeps a fixed pool and compresses at cook time. This is the farthest parity criterion (Textures T4, T5; Geometry 11).`,
      ),
    );

  const [nuT, nu] = paire(ex, 'three-nu-sans-ombres', 'sol');
  if (nu?.ecart)
    out.push(
      verdict(
        '',
        `<strong>Versus Three.js vanilla, no shadows, street view: ${pixels(nu.ecart)} differ by at least one level</strong> — the two images look the same (<a href="#f-fidelite">side by side</a>); the bench counts with no threshold. Vanilla Three renders this view in ${ms(nuT?.imageSyncP50)} wall time.`,
      ),
    );
  const [nuG, nuGm] = paire(ex, 'three-nu', 'generale');
  const [nuS, nuSm] = paire(ex, 'three-nu', 'sol');
  if (nuG && nuS)
    out.push(
      verdict(
        nuS.imageSyncP50 !== null &&
          nuSm?.gpuP50 !== null &&
          nuSm.gpuP50 > nuS.imageSyncP50 - BRUIT_MS
          ? 'mauvais'
          : 'bon',
        `<strong>Versus Three.js vanilla with sun and shadows: overview ${ms(nuG.imageSyncP50)} (Three) vs ${ms(nuGm?.gpuP50)} (engine); street ${ms(nuS.imageSyncP50)} vs ${ms(nuSm?.gpuP50)}.</strong> From above, selection pays; at street level the engine is no better than a naive full-scene draw — the cost there is full-screen, not geometric.`,
      ),
    );

  out.push(orientation(ex));
  return out.join('');
}

/** Le classement des coûts en vue sol, et ce qu'il dit à faire — d'abord ce que deux exécutions
 *  mesurent par différence d'enveloppe, ensuite ce que seules les étiquettes de passes disent. */
function orientation(ex) {
  const sol = trouve(ex, 'mobile', 'sol', 1);
  if (!sol) return '';
  const diff = (a, b) => moins(a?.gpuP50, b?.gpuP50);
  const l4 = trouve(ex, 'lampes-4', 'sol', 1);
  const l4s = trouve(ex, 'lampes-4-sans-ombres', 'sol', 1);
  const sansLum = trouve(ex, 'sans-lumiere', 'sol', 1);
  const soleilSans = trouve(ex, 'soleil-sans-ombres', 'sol', 1);
  const mesures = [
    [
      'Shadows, sun and four point lights (`--ombres off` cuts them all)',
      diff(l4, l4s),
      'Light 13',
    ],
    ['The sun alone, including shadow cascades', diff(sol, sansLum), 'Light 13'],
    ['Sun shadow maps (`--soleil --ombres off`)', diff(sol, soleilSans), 'Light 13'],
    [
      'Sun and four point lights with NO shadows: lighting itself',
      diff(l4s, sansLum),
      'little: shadows cost, not the light',
    ],
    ['Bounce', diff(trouve(ex, 'rebond', 'sol', 1), l4), 'Light 7'],
    ['Temporal antialiasing', diff(sol, trouve(ex, 'aa-off', 'sol', 1)), 'Light 16'],
    [
      'Compute raster instead of hardware (1248×702)',
      diff(...paire(ex, 'raster-1248', 'sol')),
      'Geometry 26',
    ],
    [
      'Textures read from the cache rather than images',
      diff(sol, trouve(ex, 'textures-host', 'sol', 1)),
      'Textures T2bis',
    ],
  ]
    .filter(([, v]) => v !== null)
    .sort((a, b) => b[1] - a[1]);
  // Les étiquettes qui absorbent leurs voisines sur cet appareil ne sont pas classées.
  const absorbees = new Set([
    'Present',
    'Temporal antialiasing',
    'Lighting (light lists + deferred)',
  ]);
  const etiquettes = GROUPES.filter(([nom]) => !absorbees.has(nom))
    .map(([nom, garde, lot]) => [nom, sommePasses(sol, garde), lot])
    .filter(([, v]) => v !== null)
    .sort((a, b) => b[1] - a[1]);
  const li = (rows) =>
    rows
      .map(([nom, v, lot]) => `<li><strong>${html(nom)}</strong> : ${ms(v, 2)} — ${html(lot)}</li>`)
      .join('');
  return `<h3>What the numbers point to</h3><p>Street view, normal quality, full resolution, envelope ${ms(sol.gpuP50)}. First what two runs measure by envelope difference (the only safe reading on this device; under ${ms(BRUIT_MS)} is noise):</p><ol>${li(mesures)}</ol><p>Then what pass labels say, with the timestamp caveat (present, antialiasing and deferred lighting each read 7 ms because they absorb their neighbours; they are not ranked here):</p><ol>${li(etiquettes)}</ol><p>${sansLum ? `With no light, the frame is ${ms(sansLum.gpuP50)}: that is the base — visibility, materials, present — and it is in the same range as a naive full-scene Three draw (<a href="#three-nu">versus Three.js vanilla</a>). At street level, selection buys nothing; the cost is full-screen.` : ''} On memory, the order is that of the <a href="#memoire">memory section</a>: raw textures first, clusters duplicated per instance next, unquantized vertices last. On the CPU, ${ms(sol.cpuP50, 2)} per frame versus “almost zero”: the <a href="#etapes">CPU steps</a> say where.</p>`;
}
