// The words `check:english` counts (`scripts/check-english.ts`): French words met in the code's
// identifiers and comments, written without accents, lower case, each plural it takes listed
// beside it. None is an English word too: `matrices` or `copies` would count English code.

/** The French words counted, compared once their accents are dropped and their case lowered. */
export const FRENCH_WORDS = new Set(
  `adaptateur adressage adresse ajoute ancienne anneau apres aplatie appareil appel appels arbre
  arret arrondi attendu attendue attente autre avant avec avertissement avertissements bati bilan
  boite boites calcul carre certifiee chaine chemin cible cisaillee cle cles colonne colonnes
  compte comptes compteur construire couleur deplacement demande demandee demandes dessin dessine
  dessinees dessins deux donnees droite eclairage ecart ecarts echec echelle echelles empaquete
  empreinte enfant enfants entete entre erreur erreurs etape etapes etat etendue evenement
  evenements executer fichier froid geometrie graine grappe grappes groupe groupes haut hauteur
  hierarchiques hors hote identifiant indisponible jeu jeux lampe lampes lancement lancements
  largeur libere limite lineaire liste longueur materiau materiaux matiere mediane mesure mesures
  metrique metriques miroir modele monde mondes moteur niveau niveaux noeud noeuds nombre norme
  normale normales noyau noyaux nulle objet objets obtenu oeil ombre ombres optimisee origine
  ouvrir pagine paire paires pilote pire pleine poids portee preuve preuves profil profondeur
  projet proche racine racines raison refus rejet rejetees rejets rejette releve rendu rendue repli
  resultat resultats ressources saine serie seuil somme sommet sommets tangentes temoin temoins
  tenue texte totaux toute toutes tronque trop uniforme variante variantes vecteur vecteurs verifie
  verite vide vitre vivant vrai vraie vue vues`.split(/\s+/),
);

const VARIANT = 'a diagnostic variant, `packages/sdk-browser/src/diagnostic/gpuVariant.ts`';

/** The French strings a program reads, not counted until renamed together with their readers:
 *  each one names where it is read. */
export const FRENCH_EXCEPTIONS: Record<string, string> = {
  '.mesure': 'the measurement folder, `bench/core/paths.ts` and `.gitignore`',
  ...Object.fromEntries(
    [
      'transparents-sommets',
      'transparents-sans-couleur',
      'presentation-hors-ecran',
      'geometrie-plat',
      'geometrie-sommets',
      'geometrie-une-passe',
      'raster-calcul',
    ].map((variant) => [variant, VARIANT]),
  ),
};
