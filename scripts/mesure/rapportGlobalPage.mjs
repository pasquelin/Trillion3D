// The global report page: a light and dark stylesheet, and the skeleton. Everything lives in a
// single HTML file, with no network.
import { html } from './rapportGlobalGraphes.mjs';
import { SCRIPT_COMPARATEUR, STYLE_COMPARATEUR } from './rapportGlobalComparateur.mjs';
import { STYLE_BILAN } from './rapportGlobalBilan.mjs';

const STYLE = `
:root{color-scheme:light;--fond:#f9f9f7;--surface:#fcfcfb;--encre:#0b0b0b;--encre-2:#52514e;--muet:#898781;--grille:#e1e0d9;--base:#c3c2b7;--bord:rgba(11,11,11,.10);--serie-1:#2a78d6;--serie-2:#eb6834;--serie-3:#1baf7a;--serie-4:#eda100;--bon:#006300;--mauvais:#d03b3b}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){color-scheme:dark;--fond:#0d0d0d;--surface:#1a1a19;--encre:#fff;--encre-2:#c3c2b7;--muet:#898781;--grille:#2c2c2a;--base:#383835;--bord:rgba(255,255,255,.10);--serie-1:#3987e5;--serie-2:#d95926;--serie-3:#199e70;--serie-4:#c98500;--bon:#0ca30c;--mauvais:#e66767}}
:root[data-theme=dark]{color-scheme:dark;--fond:#0d0d0d;--surface:#1a1a19;--encre:#fff;--encre-2:#c3c2b7;--muet:#898781;--grille:#2c2c2a;--base:#383835;--bord:rgba(255,255,255,.10);--serie-1:#3987e5;--serie-2:#d95926;--serie-3:#199e70;--serie-4:#c98500;--bon:#0ca30c;--mauvais:#e66767}
*{box-sizing:border-box}body{margin:0;background:var(--fond);color:var(--encre);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{margin:0 auto;max-width:1800px;padding:32px clamp(24px,4vw,80px) 64px}h1{font-size:28px;margin:0 0 4px}h2{font-size:21px;margin:40px 0 8px;padding-top:16px;border-top:1px solid var(--grille)}h3{font-size:16px;margin:20px 0 6px}
.sous{color:var(--encre-2);margin:0 0 16px}nav ol{columns:2;padding-left:20px;font-size:14px}
.tuiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin:16px 0}.tuile{background:var(--surface);border:1px solid var(--bord);border-radius:8px;padding:12px 14px;display:flex;flex-direction:column}.tuile-libelle{font-size:13px;color:var(--encre-2)}.tuile-valeur{font-size:26px;font-weight:600;margin:2px 0}.tuile-note{font-size:12px;color:var(--muet)}
.deux-cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start}.deux-cols>figure{width:100%;margin:0}.deux-cols>table{margin:0}figure{margin:20px 0;background:var(--surface);border:1px solid var(--bord);border-radius:8px;padding:12px 14px}figcaption{margin-bottom:6px}.unite{color:var(--muet)}
.graphe{width:100%;height:auto;display:block}.graphe .grille{stroke:var(--grille);stroke-width:1}.graphe .base{stroke:var(--base);stroke-width:1}.graphe text{font:12px system-ui,sans-serif;fill:var(--encre-2)}.graphe .axe{fill:var(--muet);font-variant-numeric:tabular-nums}.graphe .valeur{fill:var(--encre);font-variant-numeric:tabular-nums}.graphe .vide{font-weight:600;font-size:13px}
.legende{list-style:none;padding:0;margin:0 0 8px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:var(--encre-2)}.legende i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:6px;vertical-align:-1px}
table{border-collapse:collapse;width:100%;font-size:13.5px;margin:8px 0 16px;background:var(--surface)}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grille);vertical-align:top}th{color:var(--encre-2);font-weight:600}tbody th{font-weight:500;color:var(--encre)}td{font-variant-numeric:tabular-nums}
details summary{cursor:pointer;color:var(--encre-2);font-size:13px}.verdict{border-left:4px solid var(--serie-1);padding:8px 12px;margin:10px 0;background:var(--surface)}.verdict.mauvais{border-color:var(--mauvais)}.verdict.bon{border-color:var(--bon)}
.scenes-cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start}.scenes-cols .fiches{grid-template-columns:1fr}.scenes-cols .graphe{width:100%;height:auto}h3.scene{font-size:22px;margin:8px 0 12px}
.fiches{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.fiche{display:grid;grid-template-columns:1fr;gap:12px;align-content:start;background:var(--surface);border:1px solid var(--bord);border-radius:12px;padding:24px 28px}.fiche.large{grid-column:1/-1}.fiche h3{margin:0 0 10px;font-size:23px;line-height:1.25;text-wrap:balance}.fiche figure{margin:0;border:0;padding:0;background:none}.fiche-verdict{margin:0 0 12px;font-size:17px;font-weight:600}.fiche-explication{font-size:17px;line-height:1.5;color:var(--encre-2);margin:0}.fiche .legende{font-size:15px}.graphe.grand text{font-size:15px}.graphe.grand .valeur{font-size:16px;font-weight:600}.pastille{display:inline-block;width:12px;height:12px;border-radius:50%;margin-right:8px;vertical-align:-1px}.pastille.bon{background:var(--bon)}.pastille.mauvais{background:var(--mauvais)}.pastille.moyen{background:#eda100}.pastille.neutre{background:var(--muet)}.trois li{margin:4px 0}
@media (max-width:1100px){.fiches{grid-template-columns:1fr}.deux-cols{grid-template-columns:1fr}.scenes-cols{grid-template-columns:1fr}}
code{font-size:.92em}.lacune{color:var(--encre-2)}.portail{font-size:14px;margin:0 0 12px}.portail a{color:var(--serie-1);text-decoration:none}.portail a:hover{text-decoration:underline}
@media (max-width:640px){nav ol{columns:1}h1{font-size:22px}}
`;

/** Link back to the documentation portal published next to this report (`docs/index.html`). */
const PORTAIL = '<p class="portail"><a href="./">← Documentation</a></p>';

/** The whole page. `sections`: `[{ id, titre, corps }]`. */
export function page({ titre, sousTitre, sections }) {
  const sommaire = sections.map((s) => `<li><a href="#${s.id}">${html(s.titre)}</a></li>`).join('');
  const corps = sections
    .map((s) => `<section id="${s.id}"><h2>${html(s.titre)}</h2>${s.corps}</section>`)
    .join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(titre)}</title><style>${STYLE}${STYLE_COMPARATEUR}${STYLE_BILAN}</style></head><body><main>${PORTAIL}<h1>${html(titre)}</h1><p class="sous">${html(sousTitre)}</p><nav><ol>${sommaire}</ol></nav>${corps}</main><script>${SCRIPT_COMPARATEUR}</script></body></html>`;
}
