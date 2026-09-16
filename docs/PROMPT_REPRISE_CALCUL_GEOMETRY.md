# Reprise — terminer les correctifs et vérifier les preuves

Reprends le travail à partir du `develop` actuel et de ton dernier compte rendu. Commence par relever le SHA et vérifier l'état réel du code : les résultats annoncés dans le compte rendu sont des éléments à contrôler, pas une validation du commit courant.

Ta conclusion « les dix défauts sont corrigés » contredit les deux défauts que tu déclares encore ouverts. Corrige ce bilan et termine ces deux points avant de demander au Validateur une validation finale puis un push. Le retard d'`origin/develop` ne suffit pas à justifier la publication.

## 1. Geometry — les transparents doivent suivre les transformations

Reproduis le déplacement d'un objet transparent par l'API publique sur WebGPU. Suis la transformation depuis le nœud source jusqu'aux matrices utilisées au dessin, aux bornes de sélection et d'occultation, puis à l'invalidation d'une image conservée.

Corrige la cause commune aux chemins concernés. Couvre les transparents paginés et non paginés, les transformations héritées d'un parent et les matrices avec cisaillement. Vérifie les déplacements dans le champ, hors champ puis de retour dans le champ, y compris après stabilisation du rendu.

La preuve doit passer par le moteur réel : un appel public, une transformation attendue et une image ou des données GPU observées. Un test d'une fonction isolée ne suffit pas à établir que le rendu suit le déplacement.

## 2. Calcul — établir un contrat cohérent pour la pose caméra

Remplace la correction site par site par un contrat explicite de lecture de la pose monde, ancêtres compris. Identifie les entrées publiques ou réellement appelables seules, puis partage la logique nécessaire entre elles.

Ne supprime pas les mises à jour dont les tests ont démontré la nécessité. Une centralisation doit préserver les appels autonomes, les captures secondaires et l'historique de vue. Vérifie que sélection, occultation, ombres, éclairage, transparents et seuil adaptatif lisent la pose attendue.

Ajoute des tests de comportement sur les frontières de ce contrat, avec une caméra sous parent déplacé et tourné. Inclus le cas d'une image déjà conservée et celui d'une fonction appelée seule. Vérifie aussi que les caches de rectangles/profondeurs projetés sont invalidés quand la vue change, même si les pages et la partition d'occultation restent identiques.

## 3. Rendre les preuves vérifiables

- Explique les **6 pixels restants** : 1 081 pixels différents au total moins 1 075 attribués au défaut 3. Attribue-les par reproduction ou laisse-les explicitement non expliqués ; ne les classe pas comme bruit si le témoin A/A vaut zéro.
- Clarifie l'état final du `String.replace` : ton compte rendu annonce sa disparition puis sa conservation. Donne le fichier et le mécanisme réellement utilisés. Le banc doit échouer explicitement si la substitution attendue ne se produit pas.
- Préserve un témoin indépendant qui reproduit effectivement le défaut ancien. Distingue les suppressions correctes des suppressions de faces visibles : les nombres « 560 avant, 54 après » seuls ne prouvent pas la justesse du résultat.
- Remplace les assertions de motifs textuels de `normalTransform.test.ts` par une vérification du comportement arithmétique, complétée par une exécution du shader réel pour les cas concernés. Conserve les contrôles de compilation utiles.
- Pour le million de matrices, distingue précisément les verdicts comparés et les cas singuliers : explique comment « 0 verdict différent » se rapporte aux désaccords que tu mentionnes. Ne dispense pas ces cas d'analyse au seul motif que la primitive est aplatie.

## 4. Validation et livraison

Respecte `AGENTS.md`, les frontières de packages et le partage des responsabilités avec le Validateur. Ne réduis ni la qualité ni les assertions pour obtenir des tests verts. N'élargis pas cette reprise à d'autres optimisations.

Après les corrections, exécute une passe finale des tests pertinents, `npm run test:gpu` et les contrôles requis. Fais effectuer la validation complète et la preuve navigateur par le Validateur sur le commit exact à publier.

Compare à entrée, caméra, résolution, DPR, seuil d'erreur et budget identiques. Contrôle la résidence et l'état du streaming avant toute comparaison de durées. Si ces conditions ne tiennent pas, déclare les durées non comparables. Vérifie l'absence de trous et explique les différences d'image par rapport au témoin A/A.

Livre un compte rendu court avec le SHA, les causes corrigées, les tests et preuves exécutés, leurs résultats et leurs limites. Reprends les cinq chantiers de ta mémoire pour indiquer lesquels restent ouverts, sans en inventer ni les présenter comme réalisés. Ne conclus « terminé » que pour le périmètre effectivement démontré.
