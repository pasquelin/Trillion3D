// Le comparateur d'images du rapport, deux colonnes de blocs, un bloc par vue : en grand, le
// curseur — les deux images l'une sur l'autre, le trait suit la souris et découvre Three.js à
// gauche, le moteur à droite — et, replié dessous, les deux images côte à côte.
import { html } from './rapportGlobalGraphes.mjs';
import { capture } from './rapportGlobalImages.mjs';

/** Le bloc HTML ; `paires` : `[{ libelle, a, b }]`, chemins de captures dans `dossier`. */
export function comparateur({ dossier, id, paires, nomA = 'Three.js', nomB = 'Notre moteur' }) {
  const blocs = paires
    .map((p) => ({ libelle: p.libelle, a: capture(dossier, p.a), b: capture(dossier, p.b) }))
    .filter((p) => p.a && p.b)
    .map(
      (p, i) => `<div class="cmp" id="${id}-${i}">
<h4 class="cmp-sous">${html(p.libelle)}</h4>
<div class="cmp-vue"><img loading="lazy" src="${p.a}" alt="${html(nomA)}"><img loading="lazy" class="cmp-dessus" src="${p.b}" alt="${html(nomB)}"><div class="cmp-trait"></div></div>
<p class="cmp-legende"><span>◀ ${html(nomA)}</span><span>le trait suit la souris</span><span>${html(nomB)} ▶</span></p>
<details class="cmp-details"><summary>Voir les deux images côte à côte</summary><div class="cmp-deux"><figure><img loading="lazy" src="${p.a}" alt="${html(nomA)}"><figcaption>${html(nomA)}</figcaption></figure><figure><img loading="lazy" src="${p.b}" alt="${html(nomB)}"><figcaption>${html(nomB)}</figcaption></figure></div></details></div>`,
    );
  return blocs.length ? `<div class="cmps">${blocs.join('')}</div>` : '<p>Captures absentes.</p>';
}

export const STYLE_COMPARATEUR = `
.cmps{display:grid;grid-template-columns:1fr 1fr;gap:20px}.cmp-sous{font-size:19px;margin:0 0 8px}
.cmp-vue{position:relative;width:100%;aspect-ratio:16/9;overflow:hidden;border-radius:8px;background:#000;cursor:crosshair;user-select:none}.cmp-vue img{position:absolute;inset:0;width:100%;height:100%;display:block;pointer-events:none}.cmp-dessus{clip-path:inset(0 0 0 50%)}
.cmp-trait{position:absolute;top:0;bottom:0;left:50%;width:2px;background:#fff;box-shadow:0 0 0 1px rgba(0,0,0,.6);pointer-events:none}.cmp-legende{display:flex;justify-content:space-between;font-size:15px;font-weight:600;margin:6px 0 0}.cmp-legende span:nth-child(2){font-weight:400;color:var(--encre-2)}
.cmp-details{margin-top:6px}.cmp-details summary{cursor:pointer;font-size:14px;color:var(--encre-2)}.cmp-deux{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px}.cmp-deux figure{margin:0;padding:0;border:0;background:none}.cmp-deux img{width:100%;height:auto;display:block;border-radius:6px}.cmp-deux figcaption{font-size:14px;font-weight:600;margin-top:4px;text-align:center}
@media (max-width:1100px){.cmps{grid-template-columns:1fr}}
`;

export const SCRIPT_COMPARATEUR = `
for (const vue of document.querySelectorAll('.cmp-vue')) {
  const dessus = vue.querySelector('.cmp-dessus'), trait = vue.querySelector('.cmp-trait');
  vue.addEventListener('mousemove', (e) => {
    const r = vue.getBoundingClientRect(), v = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    trait.style.left = v + '%'; dessus.style.clipPath = 'inset(0 0 0 ' + v + '%)';
  });
}
`;
