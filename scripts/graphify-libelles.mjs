/**
 * Rend aux communautés du graphe graphify les noms métier qu'un reclustering efface.
 *
 * `graphify update .` renumérote les communautés à chaque passage et réécrit
 * `.graphify_labels.json` avec le nom du nœud le plus connecté de chaque groupe. Les noms
 * écrits à la main tombent. Ce script les rattache non plus à un numéro — qui ne survit à
 * rien — mais au contenu : `graphify-communautes.json` garde douze témoins par communauté
 * nommée, et le nom retourne au groupe qui en contient le plus.
 *
 * Les communautés sans correspondance prennent `dossier · nœud dominant`, lisible à défaut
 * d'être métier. Le rapport ne voit ses noms que dans ses titres `### Community N` ; ce sont
 * donc les seuls à réécrire.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, dirname, relative, isAbsolute } from 'node:path';

export const SEUIL_RECOUVREMENT = 0.4;
const EXTENSIONS = /\.(ts|tsx|js|mjs|rs|py|md|txt|wgsl|json)$/;

/** Regroupe les identifiants de nœuds par communauté, et compte les liens de chacun. */
export function grouper(graphe) {
  const degre = new Map();
  for (const lien of graphe.links)
    for (const bout of [lien.source, lien.target]) degre.set(bout, (degre.get(bout) ?? 0) + 1);
  const groupes = new Map();
  for (const nœud of graphe.nodes) {
    if (!groupes.has(nœud.community)) groupes.set(nœud.community, []);
    groupes.get(nœud.community).push(nœud.id);
  }
  return { groupes, degre };
}

/** Nom de repli : le dossier dominant du groupe, puis son nœud le plus connecté. */
export function nomDerive(ids, contexte) {
  const { degre, etiquettes, sources, racine } = contexte;
  const tete = ids.reduce((a, b) => ((degre.get(b) ?? 0) >= (degre.get(a) ?? 0) ? a : b));
  const nom = (etiquettes.get(tete) ?? tete).replace(EXTENSIONS, '').replace(/\(\)$/, '').trim();
  const dossiers = new Map();
  for (const id of ids) {
    const chemin = sources.get(id);
    if (!chemin) continue;
    const relatif = isAbsolute(chemin) ? relative(racine, chemin) : chemin;
    const dossier = basename(dirname(relatif)) || 'racine';
    dossiers.set(dossier, (dossiers.get(dossier) ?? 0) + 1);
  }
  const dominant = [...dossiers].sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
  if (dominant && !nom.toLowerCase().includes(dominant.toLowerCase()))
    return `${dominant} · ${nom}`;
  return nom || 'Communauté sans nom';
}

/**
 * Attribue chaque nom curé à la communauté qui en contient le plus de témoins. Les
 * appariements les plus francs passent d'abord : un nom ne se pose qu'une fois, et une
 * communauté déjà nommée ne se laisse pas reprendre par un candidat plus faible.
 */
export function apparier(groupes, temoins) {
  const scores = [];
  for (const [nom, references] of Object.entries(temoins)) {
    for (const [cid, ids] of groupes) {
      const membres = new Set(ids);
      const communs = references.filter((id) => membres.has(id)).length;
      const part = communs / references.length;
      if (part >= SEUIL_RECOUVREMENT) scores.push({ nom, cid, part });
    }
  }
  scores.sort((a, b) => b.part - a.part);
  const parCommunaute = new Map();
  const nomsPris = new Set();
  for (const { nom, cid } of scores) {
    if (parCommunaute.has(cid) || nomsPris.has(nom)) continue;
    parCommunaute.set(cid, nom);
    nomsPris.add(nom);
  }
  return parCommunaute;
}

/** Deux communautés scindées peuvent viser le même nom : on les numérote pour les distinguer. */
function distinguer(libelles) {
  const vus = new Map();
  for (const cid of [...libelles.keys()].sort((a, b) => a - b)) {
    const nom = libelles.get(cid);
    const rang = (vus.get(nom) ?? 0) + 1;
    vus.set(nom, rang);
    if (rang > 1) libelles.set(cid, `${nom} (${rang})`);
  }
  return libelles;
}

/** Réécrit les titres `### Community N - "…"` du rapport avec les noms retrouvés. */
export function reecrireRapport(rapport, libelles) {
  return rapport.replace(/^### Community (\d+) - ".*"$/gm, (ligne, numero) => {
    const nom = libelles.get(Number(numero));
    return nom ? `### Community ${numero} - "${nom}"` : ligne;
  });
}

export function rendreLesNoms(graphe, temoins, racine) {
  const { groupes, degre } = grouper(graphe);
  const contexte = {
    degre,
    racine,
    etiquettes: new Map(graphe.nodes.map((n) => [n.id, n.label ?? n.id])),
    sources: new Map(graphe.nodes.map((n) => [n.id, n.source_file ?? ''])),
  };
  const apparies = apparier(groupes, temoins);
  const libelles = new Map();
  for (const [cid, ids] of groupes)
    libelles.set(cid, apparies.get(cid) ?? nomDerive(ids, contexte));
  return { libelles: distinguer(libelles), repris: apparies.size, total: groupes.size };
}

function principal() {
  const racine = process.cwd();
  const cheminGraphe = 'graphify-out/graph.json';
  if (!existsSync(cheminGraphe)) {
    console.log('[graphify] aucun graphe : rien à renommer.');
    return;
  }
  const graphe = JSON.parse(readFileSync(cheminGraphe, 'utf8'));
  const temoins = JSON.parse(readFileSync('scripts/graphify-communautes.json', 'utf8'));
  const { libelles, repris, total } = rendreLesNoms(graphe, temoins, racine);

  const parNumero = Object.fromEntries([...libelles].map(([cid, nom]) => [String(cid), nom]));
  writeFileSync('graphify-out/.graphify_labels.json', JSON.stringify(parNumero));
  const rapport = 'graphify-out/GRAPH_REPORT.md';
  if (existsSync(rapport))
    writeFileSync(rapport, reecrireRapport(readFileSync(rapport, 'utf8'), libelles));
  console.log(`[graphify] ${repris}/${total} communautés ont retrouvé leur nom métier.`);
}

if (import.meta.url === `file://${process.argv[1]}`) principal();
