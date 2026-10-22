/** The two lines' colours and the budget line's, shared by the sparkline, the legend and the stylesheet. */
export const GPU_COLOUR = '#60a5fa',
  CPU_COLOUR = '#e879f9',
  BUDGET_COLOUR = 'rgba(255,255,255,.45)'

/** The panel's stylesheet: inline, so the panel needs no file, font or framework of the page. */
export const STYLE = `
.t3s-frame{position:absolute;inset:0;container-type:size;pointer-events:none}
.t3s{--ok:#4ade80;--warn:#fb923c;--bad:#f87171;--gpu:${GPU_COLOUR};--cpu:${CPU_COLOUR};
  position:absolute;z-index:5;pointer-events:auto;box-sizing:border-box;
  --w1:clamp(9.5rem,27cqw,23rem);width:calc(var(--w1)*var(--cols,1));max-width:calc(100% - 1.5rem);min-width:min-content;display:flex;flex-direction:column;
  font:500 clamp(9px,calc(0.38cqw + 6.6px),12px)/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color:#e5e7eb;background:rgba(15,18,24,.74);-webkit-backdrop-filter:blur(10px) saturate(1.2);
  backdrop-filter:blur(10px) saturate(1.2);border:1px solid rgba(255,255,255,.1);border-radius:.6em;
  box-shadow:0 .4em 1.4em rgba(0,0,0,.28);font-variant-numeric:tabular-nums;user-select:none;
  text-shadow:0 1px 1px rgba(0,0,0,.35)}
.t3s[data-empty]{display:none}
.t3s[data-corner=bottom-left]{left:.75rem;bottom:.75rem}
.t3s[data-corner=top-left]{left:.75rem;top:.75rem}
.t3s[data-corner=bottom-right]{right:.75rem;bottom:.75rem}
.t3s[data-corner=top-right]{right:.75rem;top:.75rem}
.t3s[data-compact]{width:auto}
.t3s[data-compact] .t3s-body{display:none}
.t3s[data-dragging]{opacity:.85;cursor:grabbing}
.t3s-head{display:flex;align-items:baseline;gap:.55em;padding:.45em .7em;cursor:pointer;
  flex-wrap:wrap;row-gap:.1em;white-space:nowrap;touch-action:none;outline:none;
  max-width:var(--w1);box-sizing:border-box}
.t3s-head:focus-visible{box-shadow:inset 0 0 0 2px var(--gpu);border-radius:.6em}
.t3s-dot{width:.55em;height:.55em;border-radius:50%;background:currentColor;align-self:center;flex:none}
.t3s-big{font-size:1.25em;font-weight:700;min-width:2.2ch;text-align:end}
.t3s-u{opacity:.6;font-size:.85em}
.t3s-tag{font-size:.8em;opacity:.7;font-style:italic}
.t3s-cg{margin-inline-start:auto;opacity:.75;font-size:.9em}
.t3s-cg b{font-weight:600}
@container (max-width:600px){.t3s[data-compact] .t3s-cg{display:none}}
.t3s-ok{color:var(--ok)}.t3s-warn{color:var(--warn)}.t3s-bad{color:var(--bad)}
.t3s-body{padding:0 .7em .5em;border-top:1px solid rgba(255,255,255,.08);column-count:var(--cols,1);
  column-gap:1.4em}
.t3s-fixed{break-inside:avoid}
.t3s-spark{display:block;width:100%;height:3.6em;margin:.45em 0 .1em}
.t3s-legend{display:flex;gap:.9em;font-size:.8em;opacity:.7}
.t3s-legend i{display:inline-block;width:.9em;height:2px;vertical-align:middle;margin-inline-end:.35em}
.t3s-sum{margin-top:.35em;padding-bottom:.25em;border-bottom:1px solid rgba(255,255,255,.07)}
.t3s-line{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:.5em;padding:.04em 0}
.t3s-line[hidden]{display:none}
.t3s-line>span:first-child{opacity:.82}
.t3s-line>span:last-child{text-align:end;white-space:nowrap}
.t3s-tabs{display:flex;gap:.2em;margin-top:.4em;border-bottom:1px solid rgba(255,255,255,.07)}
.t3s-tab{all:unset;box-sizing:border-box;cursor:pointer;padding:.2em .55em;font-size:.82em;font-weight:700;
  letter-spacing:.04em;text-transform:uppercase;color:#94a3b8;border-bottom:2px solid transparent}
.t3s-tab[hidden]{display:none}
.t3s-tab[aria-selected=true]{color:#e5e7eb;border-bottom-color:var(--gpu)}
.t3s-tab:focus-visible{outline:1px solid var(--gpu)}
.t3s-sh{display:grid;grid-template-columns:minmax(0,1fr) auto 2.1em;column-gap:.5em;padding:.25em 0 .1em;
  font-weight:700;font-size:.82em;color:#cbd5e1}
.t3s-sh[hidden]{display:none}
.t3s-sh>span:nth-child(2){text-align:end}
.t3s-sh>span:nth-child(3){opacity:.6;font-weight:400}
.t3s-note{grid-column:1/-1;font-weight:400;font-style:italic;opacity:.65}
.t3s-note:empty{display:none}
.t3s-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto auto 2.1em;column-gap:.5em;
  padding:.06em 0 .16em .9em;break-inside:avoid}
.t3s-row>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.82}
.t3s-row>span:nth-child(2){text-align:end}
.t3s-row>span:nth-child(3){opacity:.45;font-size:.85em;align-self:end}
.t3s-row>span:nth-child(4){opacity:.55}
.t3s-row[data-fold]{cursor:pointer}
.t3s-row[data-fold]>span:first-child::before{content:'\\25B8';position:absolute;left:0;opacity:.6;transition:transform .12s}
.t3s-row[data-fold=open]>span:first-child::before{transform:rotate(90deg)}
.t3s-rem>span:first-child{font-style:italic}
.t3s-child{padding-left:1.8em;font-size:.92em}
.t3s-bar{position:absolute;left:.9em;right:0;bottom:0;height:2px;background:var(--gpu);opacity:.75;
  transform-origin:left;transform:scaleX(0)}
.t3s-row[data-sec=cpu] .t3s-bar{background:var(--cpu)}
.t3s-row[data-sec=shadows] .t3s-bar{background:#facc15}
.t3s-row[data-sec=memory] .t3s-bar,.t3s-row[data-sec=scene] .t3s-bar{background:var(--ok)}
`
