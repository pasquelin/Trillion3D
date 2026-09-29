// The words `check:english` counts (`scripts/check-english.ts`): French words met in the code's
// identifiers and comments, written without accents, lower case, each plural it takes listed
// beside it. None is an English word too: `matrices` or `copies` would count English code.

/** The French words counted, compared once their accents are dropped and their case lowered. */
export const FRENCH_WORDS = new Set(
  `adaptateur adressage adresse ajoute alloues ancienne anneau aplatie appareil appel appels
  apres arbre arret arrondi attendu attendue attente autre avant avec avertissement
  avertissements bati bilan boite boites calcul calme carre chaine chauffe chemin
  cible cisaillee cle cles colonne colonnes commande compte comptes compteur construire couleur
  demande demandee demandes deplacement dessin dessine dessinees dessins deux directionnelles
  donnees droite ecart ecarts echec echelle echelles eclairage empaquete empreinte enfant
  enfants entete entre erreur erreurs etape etapes etat etendue evenement evenements executer
  fentes fichier fixe froid generale geometrie graine grappe grappes groupe groupes haut hauteur
  hierarchiques hors hote identifiant indisponible intensite jeu jeux lampe lampes lancement
  lancements largeur libere limite lineaire liste longueur maille materiau materiaux matiere
  mediane mesure mesures metrique metriques miroir modele monde mondes moteur niveau niveaux
  noeud noeuds nombre normale normales norme noyau noyaux nulle objet objets obtenu oeil ombre
  ombres optimisee origine ouvrir pagine paire paires pilote pire pleine poids ponctuelles
  portee preuve preuves proche profil profondeur projecteurs projet racine racines raison rebond
  refus reglage rejet rejetees rejets rejette releve rendu rendue repli reseau ressources
  resultat resultats saine saturees serie seuil seulement soleil somme sommet sommets tangentes
  temoin temoins tenue texte totaux toute toutes tronque trop uniforme variante variantes
  vecteur vecteurs verifie verite vide vitre vivant vrai vraie vue vues`.split(/\s+/),
);

/** The French strings that must stay, not counted: each one names why it cannot be renamed. */
export const FRENCH_EXCEPTIONS: Record<string, string> = {
  '.mesure':
    'the measurement folder outside Git (`bench/core/paths.ts`, `.gitignore`, AGENTS.md rule 10): ' +
    'every machine and worktree keeps its bench assets there, which no script can fetch again',
  certifiee:
    'a value of the public engine API (`ScreenErrorVariant`, `packages/sdk-core/src/lod/' +
    'screenErrorVariant.ts`): hosts pass it by name, so renaming it breaks their code',
};
