// Graphs of the global report: horizontal SVG bars, no library, readable in light and
// dark. One bar per value, one tint per series in a fixed order, a 2 px surface gap
// between neighbouring bars, the value at the end of the bar, and the table under the
// graph so each figure stays readable without colour.

const SERIES = ['var(--serie-1)', 'var(--serie-2)', 'var(--serie-3)', 'var(--serie-4)'];

/** A string safe inside HTML. */
export const html = (texte) =>
  String(texte ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

/** A number formatted in English, or “not measured”. */
export function nombre(valeur, decimales = 2, unite = '') {
  if (valeur === null || valeur === undefined || !Number.isFinite(valeur)) return 'not measured';
  const texte = valeur.toLocaleString('en-US', {
    minimumFractionDigits: decimales,
    maximumFractionDigits: decimales,
  });
  return unite ? `${texte}\u00a0${unite}` : texte;
}

/** Bytes as MB or GB. */
export function octets(valeur) {
  if (valeur === null || valeur === undefined) return 'not measured';
  return valeur >= 1e9 ? nombre(valeur / 1e9, 2, 'GB') : nombre(valeur / 1e6, 1, 'MB');
}

/** An image delta: differing pixels, share and max channel, or “—”. */
export const pixels = (e) =>
  e
    ? `${nombre(e.pixels, 0)} px (${nombre((100 * e.pixels) / e.total, 2)} %, max channel ${e.maxCanal})`
    : '—';

/** `a − b`, or `null` if either is missing. */
export const moins = (a, b) => (typeof a === 'number' && typeof b === 'number' ? a - b : null);

/** Milliseconds, one decimal by default. */
export const ms = (v, decimales = 1) => nombre(v, decimales, 'ms');

/** Milliseconds as seconds. */
export const secondes = (v) => nombre(typeof v === 'number' ? v / 1000 : null, 1, 's');

/** A signed delta, with its sign, or "—" if either is missing. */
export function delta(apres, avant, decimales = 2, unite = '') {
  const d = moins(apres, avant);
  return d === null ? '—' : `${d > 0 ? '+' : ''}${nombre(d, decimales, unite)}`;
}

/** Two blocks side by side (a single one takes the full width). */
export const deuxCols = (...blocs) => `<div class="deux-cols">${blocs.join('')}</div>`;

/**
 * Grouped horizontal bars. `lignes`: `[{ libelle, valeurs: [v1, v2, …] }]`; `series`: the name
 * of each value, in order. A null value draws "unmeasured" instead of the bar.
 */
export function barres({
  titre,
  sousTitre = '',
  unite,
  lignes,
  series,
  decimales = 2,
  id,
  gauche = 250,
  grand = false,
}) {
  const max = Math.max(
    1e-9,
    ...lignes.flatMap((l) => l.valeurs.filter((v) => typeof v === 'number')),
  );
  const largeur = grand ? 960 : 720;
  const droite = grand ? 120 : 90;
  const epaisseur = grand ? 26 : Math.min(18, Math.floor(72 / series.length));
  const hauteurGroupe = series.length * (epaisseur + (grand ? 4 : 2)) + (grand ? 18 : 10);
  const haut = 8;
  const hauteur = haut + lignes.length * hauteurGroupe + 24;
  const echelle = (largeur - gauche - droite) / max;
  const ticks = graduations(max);
  let svg = `<svg class="graphe${grand ? ' grand' : ''}" viewBox="0 0 ${largeur} ${hauteur}" role="img" aria-label="${html(titre)}">`;
  for (const t of ticks) {
    const x = gauche + t * echelle;
    svg += `<line class="grille" x1="${x}" x2="${x}" y1="${haut}" y2="${hauteur - 22}"/>`;
    svg += `<text class="axe" x="${x}" y="${hauteur - 6}" text-anchor="middle">${nombre(t, t < 10 ? 1 : 0)}</text>`;
  }
  svg += `<line class="base" x1="${gauche}" x2="${gauche}" y1="${haut}" y2="${hauteur - 22}"/>`;
  lignes.forEach((ligne, i) => {
    const y0 = haut + i * hauteurGroupe;
    const court = ligne.libelle.length > 38 ? `${ligne.libelle.slice(0, 36)}…` : ligne.libelle;
    svg += `<text class="libelle" x="${gauche - 8}" y="${y0 + hauteurGroupe / 2}" text-anchor="end" dominant-baseline="middle"><title>${html(ligne.libelle)}</title>${html(court)}</text>`;
    ligne.valeurs.forEach((v, j) => {
      const y = y0 + (grand ? 9 : 5) + j * (epaisseur + (grand ? 4 : 2));
      // An absent value or a word ("unpublished", "does not exist") is written instead of
      // the bar, in its series colour and under its name: the reader knows who is spoken of.
      if (typeof v !== 'number') {
        const mot = v ?? 'not measured';
        svg += `<text class="vide" x="${gauche + 6}" y="${y + epaisseur / 2}" dominant-baseline="middle" style="fill:${SERIES[j % SERIES.length]}">${html(`${series[j]} : ${mot}`)}</text>`;
        return;
      }
      const w = Math.max(1, v * echelle);
      svg += `<rect x="${gauche}" y="${y}" width="${w}" height="${epaisseur}" rx="4" fill="${SERIES[j % SERIES.length]}"><title>${html(`${ligne.libelle} · ${series[j]}: ${nombre(v, decimales, unite)}`)}</title></rect>`;
      svg += `<text class="valeur" x="${gauche + w + 6}" y="${y + epaisseur / 2}" dominant-baseline="middle">${nombre(v, decimales)}</text>`;
    });
  });
  svg += '</svg>';
  const legende =
    series.length > 1
      ? `<ul class="legende">${series.map((s, j) => `<li><i style="background:${SERIES[j % SERIES.length]}"></i>${html(s)}</li>`).join('')}</ul>`
      : '';
  return `<figure id="${id}"><figcaption>${titre === unite ? '' : `<strong>${html(titre)}</strong>${sousTitre ? ` — ${html(sousTitre)}` : ''} `}<span class="unite">(${html(unite)})</span></figcaption>${legende}${svg}<details><summary>The numbers</summary>${tableau(
    ['', ...series],
    lignes.map((l) => [
      l.libelle,
      ...l.valeurs.map((v) =>
        typeof v === 'number' ? nombre(v, decimales) : (v ?? 'not measured'),
      ),
    ]),
  )}</details></figure>`;
}

/** Round ticks under `max`. */
function graduations(max) {
  const pas = Math.pow(10, Math.floor(Math.log10(max)));
  const unite = max / pas >= 5 ? pas : max / pas >= 2 ? pas / 2 : pas / 5;
  const ticks = [];
  for (let t = 0; t <= max; t += unite) ticks.push(Number(t.toFixed(6)));
  return ticks;
}

/** An HTML table; cells are already formatted text. */
export function tableau(entete, lignes) {
  const th = entete.map((c) => `<th>${html(c)}</th>`).join('');
  const tr = lignes
    .map(
      (l) =>
        `<tr>${l.map((c, i) => (i === 0 ? `<th scope="row">${html(c)}</th>` : `<td>${html(c)}</td>`)).join('')}</tr>`,
    )
    .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`;
}

/** A tile: a large figure, its label, a note. */
export function tuile(libelle, valeur, note = '') {
  return `<div class="tuile"><span class="tuile-libelle">${html(libelle)}</span><span class="tuile-valeur">${html(valeur)}</span>${note ? `<span class="tuile-note">${html(note)}</span>` : ''}</div>`;
}
