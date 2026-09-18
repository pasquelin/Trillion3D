// Ce que les deux pages de mesure (`pageEclairage.mjs`, `pageThreeNu.mjs`) font pareil : la lampe
// mobile sur son petit cercle, la capture envoyée à Node, les octets passés sur le réseau. Servi à
// la page sous `/mesure/` et importé par URL, sans rien du SDK.

/** La position de la lampe mobile à l'image `frame` : un petit cercle parcouru en `period` images. */
export function positionLampeMobile(moving, frame) {
  const angle = (frame / moving.period) * Math.PI * 2;
  return [
    moving.origin[0] + Math.cos(angle) * moving.radius,
    moving.origin[1],
    moving.origin[2] + Math.sin(angle) * moving.radius,
  ];
}

/** La capture RGBA, lignes du bas vers le haut, envoyée telle quelle à Node qui l'encode en PNG. */
export function posterCapture(file, rgba, w, h) {
  const body = rgba.buffer.slice(rgba.byteOffset, rgba.byteOffset + rgba.byteLength);
  return fetch(`/capture?file=${encodeURIComponent(file)}&w=${w}&h=${h}`, { method: 'POST', body });
}

/** Les octets passés sur le réseau depuis l'entrée `depuis`, par sorte de fichier. */
export function reseauDepuis(depuis) {
  const network = {};
  for (const entry of performance.getEntriesByType('resource').slice(depuis)) {
    const extension = entry.name.split('?')[0].match(/\.([a-z0-9]+)$/i);
    const kind = (extension ? extension[1] : 'autre').toLowerCase();
    network[kind] = (network[kind] ?? 0) + (entry.transferSize || entry.encodedBodySize || 0);
  }
  return network;
}
