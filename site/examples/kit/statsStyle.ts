/** The two lines' colours, shared by the sparkline and the CSS. */
export const GPU_COLOUR = '#60a5fa',
  CPU_COLOUR = '#e879f9'

/** The panel's stylesheet. */
export const STYLE = `
.t3s-frame{position:absolute;inset:0;container-type:size;pointer-events:none}
.t3s{--ok:#4ade80;--warn:#fb923c;--bad:#f87171;--gpu:${GPU_COLOUR};--cpu:${CPU_COLOUR};
  position:absolute;z-index:5;pointer-events:auto;box-sizing:border-box;
  width:clamp(9.5rem,27cqw,23rem);max-height:calc(100% - 1.5rem);display:flex;flex-direction:column;
  font:500 clamp(9px,calc(0.38cqw + 6.6px),12px)/1.45 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
  color:#e5e7eb;background:rgba(15,18,24,.74);-webkit-backdrop-filter:blur(10px) saturate(1.2);
  backdrop-filter:blur(10px) saturate(1.2);border:1px solid rgba(255,255,255,.1);border-radius:.6em;
  box-shadow:0 .4em 1.4em rgba(0,0,0,.28);font-variant-numeric:tabular-nums;user-select:none;
  text-shadow:0 1px 1px rgba(0,0,0,.35)}
.t3s[hidden],.t3s[data-empty]{display:none}
.t3s[data-corner=bottom-left]{left:.75rem;bottom:.75rem}
.t3s[data-corner=top-left]{left:.75rem;top:.75rem}
.t3s[data-corner=bottom-right]{right:.75rem;bottom:.75rem}
.t3s[data-corner=top-right]{right:.75rem;top:.75rem}
.t3s[data-compact]{width:auto}
.t3s[data-compact] .t3s-body{display:none}
.t3s[data-dragging]{opacity:.85;cursor:grabbing}
.t3s-head{display:flex;align-items:baseline;gap:.55em;padding:.45em .7em;cursor:pointer;
  flex-wrap:wrap;row-gap:.1em;white-space:nowrap;touch-action:none;outline:none}
.t3s-head:focus-visible{box-shadow:inset 0 0 0 2px var(--gpu);border-radius:.6em}
.t3s-dot{width:.55em;height:.55em;border-radius:50%;background:currentColor;align-self:center;flex:none}
.t3s-big{font-size:1.25em;font-weight:700;min-width:2.2ch;text-align:end}
.t3s-u{opacity:.6;font-size:.85em}
.t3s-tag{font-size:.8em;opacity:.7;font-style:italic}
.t3s-cg{margin-inline-start:auto;opacity:.75;font-size:.9em}
.t3s-cg b{font-weight:600}
@container (max-width:600px){.t3s[data-compact] .t3s-cg{display:none}}
.t3s-ok{color:var(--ok)}.t3s-warn{color:var(--warn)}.t3s-bad{color:var(--bad)}
.t3s-body{overflow:auto;scrollbar-width:thin;padding:0 .7em .5em;border-top:1px solid rgba(255,255,255,.08)}
.t3s-spark{display:block;width:100%;height:3.6em;margin:.45em 0 .1em}
.t3s-legend{display:flex;gap:.9em;font-size:.8em;opacity:.7}
.t3s-legend i{display:inline-block;width:.9em;height:2px;vertical-align:middle;margin-inline-end:.35em}
.t3s-sec{margin-top:.35em}
.t3s-sh{all:unset;box-sizing:border-box;display:grid;grid-template-columns:.9em minmax(0,1fr) auto 2.1em;
  width:100%;cursor:pointer;padding:.2em 0;font-weight:700;letter-spacing:.04em;text-transform:uppercase;
  font-size:.82em;color:#cbd5e1;border-bottom:1px solid rgba(255,255,255,.07)}
.t3s-sh:focus-visible{outline:1px solid var(--gpu)}
.t3s-sh::before{content:'\\25B8';opacity:.6;transition:transform .12s}
.t3s-sh[aria-expanded=true]::before{transform:rotate(90deg)}
.t3s-sh span:nth-child(2),.t3s-sh span:nth-child(3){text-align:end;text-transform:none;font-weight:600}
.t3s-sh span:nth-child(3){opacity:.6;font-weight:400;padding-inline-start:.35em;text-align:start}
.t3s-rows[hidden]{display:none}
.t3s-row{position:relative;display:grid;grid-template-columns:minmax(0,1fr) auto 2.1em;column-gap:.5em;
  padding:.06em 0 .16em .9em}
.t3s-row>span:first-child{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.82}
.t3s-row>span:nth-child(2){text-align:end}
.t3s-row>span:nth-child(3){opacity:.55}
.t3s-bar{position:absolute;left:.9em;right:0;bottom:0;height:2px;background:var(--gpu);opacity:.75;
  transform-origin:left;transform:scaleX(0)}
.t3s-row[data-sec=cpu] .t3s-bar{background:var(--cpu)}
.t3s-row[data-sec=shadows] .t3s-bar{background:#facc15}
.t3s-row[data-sec=cadence] .t3s-bar{background:var(--ok)}
`
