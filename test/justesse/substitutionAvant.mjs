// Remettre, dans un nuanceur livré, le bloc WGSL d'avant un lot — sans que la substitution puisse
// réussir à moitié ni échouer en silence.
//
// Ce qu'un `texte.replace(livre, avant)` nu ne dit pas, et qu'un banc de reproduction doit savoir :
//   — `String.prototype.replace` sur un motif CHAÎNE ne remplace que la PREMIÈRE occurrence : si le
//     bloc livré apparaît deux fois, la seconde reste corrigée et le « shader d'avant » est un
//     assemblage des deux versions, qui reproduit autre chose que le défaut ;
//   — le remplacement interprète `$&`, `` $` ``, `$'`, `$$` et `$<nom>` : un bloc d'avant qui
//     porterait un `$` se recollerait de travers ;
//   — si le bloc livré n'est plus trouvé, `replace` rend le texte inchangé : la reproduction
//     rejouerait alors le texte CORRIGÉ en croyant rejouer le défaut, et le banc conclurait « le
//     défaut ne se reproduit plus » sur un shader qui n'a jamais été modifié.
// `assert.notEqual(resultat, texte)` n'attrape que le dernier de ces trois cas, et encore : il dit
// seulement que quelque chose a bougé, pas que c'est le bloc attendu qui a bougé.
//
// Cette fonction établit la substitution au lieu de l'espérer : occurrences comptées avant et après,
// remplacement par FONCTION — `replace(livre, () => avant)`, la seule forme où aucun `$` du
// remplacement n'est interprété — et aller-retour exact : resubstituer le bloc livré au bloc d'avant
// doit rendre le texte d'origine, au caractère près. Elle exige en plus que le bloc d'avant porte le
// marqueur qui FAIT la reproduction (le seuil, la formule, ce que le lot a changé) et que le bloc
// livré ne le porte plus : une reproduction qui ne reproduit plus rassure à tort.
import assert from 'node:assert/strict';

/** Le nombre d'occurrences de `bloc` dans `texte`, sans chevauchement. */
function occurrences(texte, bloc) {
  let compte = 0;
  for (let i = texte.indexOf(bloc); i >= 0; i = texte.indexOf(bloc, i + bloc.length)) compte++;
  return compte;
}

/**
 * Rend `texte` avec `livre` remplacé par `avant`, ou échoue en nommant précisément ce qui manque.
 * `nom` désigne le texte traité et `origine` le fichier où vivent les deux blocs, pour que le
 * message dise où aller quand le noyau a bougé. `marqueur` est le fragment qui distingue la forme
 * d'avant de la forme livrée.
 */
export function substitueFormeAvant({ texte, livre, avant, nom, origine, marqueur }) {
  const ou = `${nom} : les deux formes viennent de ${origine}`;
  assert.notEqual(
    livre,
    avant,
    `${ou} — les deux blocs sont le même texte, il n'y a rien à rejouer`,
  );
  assert.ok(avant.includes(marqueur), `${ou} — la forme d'avant ne porte plus « ${marqueur} »`);
  assert.ok(!livre.includes(marqueur), `${ou} — la forme livrée porte encore « ${marqueur} »`);
  assert.equal(
    occurrences(texte, livre),
    1,
    `${ou} — le bloc livré apparaît ${occurrences(texte, livre)} fois dans ${nom} au lieu d'une ` +
      `seule : substituer n'en remplacerait que la première et le « shader d'avant » serait un ` +
      `mélange des deux versions`,
  );
  assert.equal(
    occurrences(texte, avant),
    0,
    `${ou} — la forme d'avant est DÉJÀ dans ${nom} : ce n'est plus une reproduction`,
  );
  const resultat = texte.replace(livre, () => avant);
  assert.equal(occurrences(resultat, avant), 1, `${ou} — la forme d'avant n'a pas été insérée`);
  assert.equal(occurrences(resultat, livre), 0, `${ou} — la forme livrée est restée en place`);
  assert.equal(
    resultat.replace(avant, () => livre),
    texte,
    `${ou} — l'aller-retour ne rend pas le texte d'origine : la substitution a touché autre chose ` +
      `que le bloc attendu`,
  );
  return resultat;
}
