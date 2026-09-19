// Le comparateur d'images du rapport, deux colonnes de blocs, un bloc par vue : en grand, le
// curseur — les deux images l'une sur l'autre, le trait suit la souris et découvre le témoin à
// gauche, notre moteur à droite — et, replié dessous, les deux images côte à côte. Quand les paires
// viennent de plusieurs témoins, un choix en tête montre un témoin à la fois, nommé par son moteur.
import { html } from './rapportGlobalGraphes.mjs';
import { capture } from './rapportGlobalImages.mjs';

/** Un bloc : le curseur, sa légende nommant les deux moteurs, les deux images repliées dessous. */
const bloc = (id, { libelle, a, b, temoin }, notre) => {
  const nom = html(temoin);
  return `<div class="cmp" id="${id}">
<h4 class="cmp-sous">${html(libelle)}</h4>
<div class="cmp-vue"><img loading="lazy" src="${a}" alt="${nom}"><img loading="lazy" class="cmp-dessus" src="${b}" alt="${notre}"><div class="cmp-trait"></div></div>
<p class="cmp-legende"><span>◀ ${nom}</span><span>the slider follows the mouse</span><span>${notre} ▶</span></p>
<details class="cmp-details"><summary>See both images side by side</summary><div class="cmp-deux"><figure><img loading="lazy" src="${a}" alt="${nom}"><figcaption>${nom}</figcaption></figure><figure><img loading="lazy" src="${b}" alt="${notre}"><figcaption>${notre}</figcaption></figure></div></details></div>`;
};

/**
 * Le bloc HTML ; `paires` : `[{ temoin, libelle, a, b }]`, chemins de captures dans `dossier`,
 * `temoin` le nom du moteur à gauche, `notre` celui de droite. Les paires sans les deux images
 * sont tues.
 */
export function comparateur({ dossier, id, paires, notre }) {
  const groupes = Map.groupBy(
    paires
      .map((p) => ({ ...p, a: capture(dossier, p.a), b: capture(dossier, p.b) }))
      .filter((p) => p.a && p.b),
    (p) => p.temoin,
  );
  if (!groupes.size) return '<p>No captures.</p>';
  const noms = [...groupes.keys()];
  const choix =
    noms.length > 1
      ? `<p class="cmp-choix">${noms.map((nom, i) => `<button type="button" data-cible="${id}-${i}"${i ? '' : ' class="actif"'}>${html(nom)}</button>`).join('')}</p>`
      : '';
  const grilles = noms
    .map(
      (nom, i) =>
        `<div class="cmps" id="${id}-${i}"${i ? ' hidden' : ''}>${groupes
          .get(nom)
          .map((p, j) => bloc(`${id}-${i}-${j}`, p, html(notre)))
          .join('')}</div>`,
    )
    .join('');
  return choix + grilles;
}

export const STYLE_COMPARATEUR = `
.cmps{display:grid;grid-template-columns:1fr 1fr;gap:20px}.cmps[hidden]{display:none}.cmp-sous{font-size:19px;margin:0 0 8px}
.cmp-choix{display:flex;gap:8px;margin:0 0 14px}.cmp-choix button{font:inherit;font-size:16px;font-weight:600;padding:8px 16px;border-radius:999px;border:1px solid var(--bord);background:var(--surface);color:var(--encre);cursor:pointer}.cmp-choix button.actif{background:var(--serie-3);border-color:var(--serie-3);color:#fff}
.cmp-vue{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:8px;background:#000;cursor:crosshair;user-select:none}.cmp-vue img{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}.cmp-dessus{clip-path:inset(0 0 0 50%)}
.cmp-trait{position:absolute;top:0;bottom:0;left:50%;width:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.6);pointer-events:none}.cmp-legende{display:flex;justify-content:space-between;font-size:15px;font-weight:600;margin:6px 0 0}.cmp-legende span:nth-child(2){font-weight:400;color:var(--encre-2)}
.cmp-details{margin-top:6px}.cmp-details summary{cursor:pointer;font-size:14px;color:var(--encre-2)}.cmp-deux{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}.cmp-deux figure{margin:0;padding:0;border:0;background:none}.cmp-deux img{width:100%;height:auto;display:block;border-radius:6px}.cmp-deux figcaption{font-size:14px;font-weight:600;margin-top:4px;text-align:center}
@media (max-width:1100px){.cmps{grid-template-columns:1fr}}
`;

export const SCRIPT_COMPARATEUR = `
for (const choix of document.querySelectorAll('.cmp-choix')) {
  const boutons = [...choix.querySelectorAll('button')];
  for (const b of boutons) b.addEventListener('click', () => {
    for (const autre of boutons) { autre.classList.toggle('actif', autre === b); document.getElementById(autre.dataset.cible).hidden = autre !== b; }
  });
}
for (const vue of document.querySelectorAll('.cmp-vue')) {
  const dessus = vue.querySelector('.cmp-dessus'), trait = vue.querySelector('.cmp-trait');
  vue.addEventListener('mousemove', (e) => {
    const r = vue.getBoundingClientRect(), v = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    trait.style.left = v + '%'; dessus.style.clipPath = 'inset(0 0 0 ' + v + '%)';
  });
}
`;
