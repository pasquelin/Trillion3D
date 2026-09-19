// The "performance" sections of the global report, second half: the resolution curve, GPU
// passes and CPU stages. Each graph reads the readings of
// `rapportGlobalLecture.mjs` and computes nothing else than p50 sums named as such.
import { barres, deuxCols, html, nombre, tableau } from './rapportGlobalGraphes.mjs';
import { TWO_VIEWS, LIBELLE, trouve } from './rapportGlobalLecture.mjs';
import { GROUPES, sommePasses } from './rapportGlobalChiffres.mjs';

export function sectionResolutions(ex) {
  const points = [
    ['res-624', '624×351'],
    ['res-1248', '1248×702'],
    ['res-1872', '1872×1053'],
    ['mobile', '2496×1404'],
  ];
  const lignes = (lire, seuil = 1) =>
    points.map(([run, libelle]) => ({
      libelle,
      valeurs: TWO_VIEWS.map((v) => lire(trouve(ex, run, v, seuil)) ?? null),
    }));
  const seuils = [
    ['res-1248-e0', 0, 'maximum quality (0 px error)'],
    ['res-1248', 1, 'normal quality (1 px error)'],
    ['res-1248-e2', 2, 'reduced quality (2 px error)'],
  ];
  return [
    '<p>Same scene, same path, same quality; only image size changes. A smaller image should cost less: the Light 18 measurement said the opposite, because compute raster only admits itself when memory allows.</p>',
    deuxCols(
      barres({
        id: 'g-res-gpu',
        titre: 'Whole frame, GPU, p50, by resolution',
        unite: 'ms',
        series: TWO_VIEWS.map((v) => LIBELLE[v]),
        lignes: lignes((r) => r?.gpuP50),
      }),
      barres({
        id: 'g-res-mat',
        titre: 'Materials pass (WG material surfaces v1), p50, by resolution',
        unite: 'ms',
        series: TWO_VIEWS.map((v) => LIBELLE[v]),
        lignes: lignes((r) => r?.passe('WG material surfaces v1')?.p50),
      }),
    ),
    deuxCols(
      barres({
        id: 'g-res-tri',
        titre: 'Selected triangles by resolution',
        sousTitre: 'at normal quality, selection does not coarsen clusters when the screen shrinks',
        unite: 'triangles',
        decimales: 0,
        series: TWO_VIEWS.map((v) => LIBELLE[v]),
        lignes: lignes((r) => r?.triangles),
      }),
      barres({
        id: 'g-res-seuils',
        titre: 'At 1248×702: whole frame by requested quality',
        unite: 'ms',
        series: TWO_VIEWS.map((v) => LIBELLE[v]),
        lignes: seuils.map(([run, seuil, libelle]) => ({
          libelle,
          valeurs: TWO_VIEWS.map((v) => trouve(ex, run, v, seuil)?.gpuP50 ?? null),
        })),
      }),
    ),
  ].join('');
}

/** GPU passes, one per bar, for a view. */
export function sectionPasses(ex) {
  const blocs = (r) => GROUPES.map(([libelle, garde]) => [libelle, sommePasses(r, garde)]);
  const out = [
    '<p>Each pass has its own duration; the groups below are p50 sums and are not the envelope. On apple metal-3, the last pass timestamp in a group absorbs those before it: an isolated label can lie; only an envelope difference between two runs decides.</p>',
  ];
  for (const vue of ['sol', 'generale']) {
    const r = trouve(ex, 'mobile', vue, 1);
    if (!r) continue;
    out.push(
      `<h3>${LIBELLE[vue]}, normal quality — envelope ${nombre(r.gpuP50, 2, 'ms')} p50 / ${nombre(r.gpuP95, 2, 'ms')} p95 (${r.gpuReleves} samples, ${html(r.gpuMethode ?? 'no method')})</h3>`,
    );
    const passes = r.passes.toSorted((a, b) => (b.p50 ?? 0) - (a.p50 ?? 0));
    out.push(
      deuxCols(
        barres({
          id: `g-blocs-${vue}`,
          titre: 'Pass groups, p50 sum',
          unite: 'ms',
          series: ['ms'],
          lignes: blocs(r).map(([libelle, v]) => ({ libelle, valeurs: [v] })),
        }),
        barres({
          id: `g-passes-${vue}`,
          titre: 'All passes, p50',
          unite: 'ms',
          decimales: 3,
          series: ['ms'],
          lignes: passes.map((p) => ({ libelle: p.name.replace(/^WG /, ''), valeurs: [p.p50] })),
        }),
      ),
    );
  }
  return out.join('');
}

/** CPU stages and their counters. */
export function sectionEtapes(ex) {
  const r = trouve(ex, 'mobile', 'sol', 1);
  if (!r) return '<p>No sample.</p>';
  return [
    '<p>What the CPU does for a frame, step by step (street view, normal quality). “not measured” is not zero: the step has no timer, and the reason is stated.</p>',
    deuxCols(
      barres({
        id: 'g-etapes',
        titre: 'CPU steps, p50 / p95',
        unite: 'ms',
        series: ['p50', 'p95'],
        lignes: r.etapes
          .filter((e) => e.cpuP50 !== null)
          .map((e) => ({ libelle: e.libelle, valeurs: [e.cpuP50, e.cpuP95] })),
      }),
      tableau(
        ['Step', 'CPU p50 / p95', 'GPU p50', 'Counters or reason'],
        r.etapes.map((e) => [
          e.libelle,
          e.cpuP50 === null
            ? (e.raisonCpu ?? 'not measured')
            : `${nombre(e.cpuP50, 2)} / ${nombre(e.cpuP95, 2)}`,
          e.gpuP50 === null ? (e.raisonGpu ?? 'not measured') : nombre(e.gpuP50, 3),
          e.compteurs
            ? Object.entries(e.compteurs)
                .map(([k, v]) => `${k} ${nombre(v, 0)}`)
                .join(', ')
            : '',
        ]),
      ),
    ),
  ].join('');
}
