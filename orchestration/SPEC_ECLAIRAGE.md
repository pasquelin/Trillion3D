# Spécification — Éclairage dynamique WebGeometry

Version 2, 15 septembre 2026 ; remplace la version 1 du 15 septembre 2026. Complète `SPEC_MOTEUR_SANS_THREE.md`, qui reste la référence pour la géométrie. Chaque exigence est numérotée et vérifiable ; une exigence sans mesure associée n'existe pas. Les valeurs marquées « réglage » sont des choix de produit : on part avec, on mesure, on resserre.

## Principe directeur

Le moteur est générique : il y aura des milliards de scènes. Emerald, la maison de test et tout autre banc ne sont que des jeux de mesure, jamais une destination. Aucune exigence de cette spécification ne se code par type d'objet (« miroir », « eau », « arbre ») ni par nom de scène : tout se code par propriété de matériau et de lampe déclarée dans les données importées. Une règle prouvée sur un banc doit valoir pour n'importe quelle scène portant les mêmes propriétés.

## État livré au 15 septembre 2026

Résumé court ; le détail chiffré vit dans `orchestration/JOURNAL.md`, jamais recopié ici.

- **Profil par étape** (LB4) : `packages/sdk-core/stageProfile.ts`, exposé par `explorer.stageProfile()`, CPU et GPU jamais additionnés.
- **Ombres avec cache** (LR3) : une carte n'est redessinée que si sa lampe ou un objet dans sa portée a bougé ; rejet des clusters hors portée et hors face avant la passe de profondeur ; découpe réelle des matériaux à masque, partagée avec le tampon de visibilité. Scène et caméra immobiles : zéro lampe redessinée, zéro appel de dessin.
- **Aucune lumière sans source déclarée** (P6), **les deux chemins** : plus d'ambiance ni de ciel implicite ; vue `unlit` par défaut tant qu'aucune lampe n'est déclarée, `lit` dès qu'il y en a une ; soleil directionnel en **quatre cascades** suivant la caméra, mêmes règles de cache que les lampes ponctuelles. Depuis le lot « transparents sans ambiance », la passe de mélange lit le même magasin `SceneLight`, les mêmes ombres, la même exposition et la même grille de sondes que la résolution opaque, par les mêmes fonctions WGSL ; sa boucle de lampes est, depuis le lot « deux tranches de lampes par tuile », celle de la tranche de mélange de sa tuile — du plan proche au fond opaque —, exacte et plus courte que la boucle bornée par `maxLights` qu'elle remplace.
- **Rebond** (LR4, LC1, LC5) : proxy résident (coupe du DAG bornée par son plancher, puis simplification propre au proxy par grille de fusion/redécoupe), BVH à quatre enfants et boîtes quantifiées, cache de surfaces sur les triangles du proxy, sondes clairsemées (mailles touchant de la géométrie plus une couronne), oracle Rust à triangles sources. **Éteint par défaut.**
- **Chiffres de référence (Emerald, huit lampes dont une mobile)** : étape Rebond **2,3 ms** GPU (p50, trois vues) ; écart moyen à l'oracle sur la pièce de contrôle **12,6 %** (cible 10 %, non tenue) ; retard de convergence **117 ms** (cible 100 ms, limite 250 ms, tenue).

## 0. Besoin, principe, non-objectifs

Besoin : un éclairage global dynamique, propre, qui respecte les lois de la lumière, sans faire chuter la cadence. Lampes colorées mobiles que l'on allume, éteint, recolore ; une porte qui coupe réellement l'échange lumineux entre deux pièces ; un mur rouge qui colore l'indirect ; des miroirs qui montrent le hors-champ ; une caméra mobile sans dépendance incorrecte à l'écran courant.

**Principe fondateur : la cadence ne bouge jamais, c'est la lumière qui converge.** Chaque composant reçoit un budget fixe par image, en millisecondes. Le travail non fait attend l'image suivante. L'image à l'état stable est la même sur toutes les machines ; seul le temps pour l'atteindre varie, et il est borné.

Non-objectifs de cette version : caustiques, milieux participants, transmission colorée par les vitrages, réfraction avec absorption en profondeur (eau), miroirs courbes, réflexions imbriquées, rendu sans aucun GPU. Ils sont hors périmètre et nommés comme tels dans le diagnostic.

Règles transverses : celles de `AGENTS.md` (fidélité avant vitesse, aucune baisse de résolution, mesures honnêtes, CPU et GPU jamais additionnés, mots interdits). Aucune illumination figée comme destination du produit : les données cuites à la compilation sont géométriques, jamais lumineuses. Une approximation non déclarée est un défaut.

**Fidélité pour l'éclairage, différente de la géométrie.** La géométrie se prouve au bit près (`tri = selected`, E8). L'éclairage ne le peut pas : les techniques temporelles et stochastiques (sondes tracées et interpolées, hystérésis adaptative, cascades suivant la caméra, oracle Monte-Carlo) ne rendent jamais deux fois exactement la même image, sur une machine ni entre deux machines. La règle d'`AGENTS.md` s'applique donc telle quelle, pas une exception : un écart s'explique au niveau du bruit A/A (deux exécutions du même côté), mesuré et consigné dans `orchestration/JOURNAL.md`, comme l'ont fait les lots ombres, sans-source et rebond 1/2. Pour le rebond, s'y ajoute l'erreur face à l'oracle du contrat E (section 5) : un lot qui resserre le bruit A/A sans resserrer l'erreur à l'oracle n'a rien prouvé sur la physique.

## 1. Architecture cible

```
[1] Compilateur natif Rust (le même binaire)
    proxy résident : niveau grossier du DAG à erreur certifiée + BVH, ou SDF par objet
    cartes de surfaces par objet : projections, atlas, couverture — géométrie et matériaux, aucune lumière
    oracle : path tracer CPU convergé sur les triangles sources, incertitude mesurée
        │
        ▼
[2] Runtime (TypeScript, WGSL, GLSL)
    ordonnanceur de lumière : file de travaux classés par résidu et influence, vidée jusqu'au budget
      ├─ direct : shadow maps par lampe, exact à chaque image
      ├─ indirect diffus : sondes d'irradiance tracées contre le proxy + cache de surfaces sur les cartes
      ├─ spéculaire : vue réfléchie pour toute surface réfléchissante, cache de surfaces pour le hors-champ
      └─ rassemblement final dans l'éclairage différé (R6) ou la passe forward WebGL2 (R7)
        │
        ▼
[3] Banc 16 : scénarios, contrat d'erreur face à l'oracle, coûts séparés, rapports archivés
```

## 2. Physique (P)

P1. **Unités et BRDF uniques** : radiance et irradiance en unités radiométriques linéaires ; Lambert et GGX conservant l'énergie, une seule implémentation de référence partagée par l'oracle, le WGSL et le GLSL (générés depuis la même source, comme R7). Critère : furnace blanc GGX et Lambert à 1 ± 10⁻³ par canal, valeur analytique publiée pour la rugosité maximale.
P2. **Réciprocité et non-négativité** : le transport échantillonné est non négatif ; la réciprocité est contrôlée sur le proxy par test. Critère : test de symétrie sur la fixture des deux pièces.
P3. **Pas de double comptage** : émission, direct, indirect et spéculaire sont partitionnés ; une surface émissive peut aussi réfléchir. Critère : somme des composantes égale à l'oracle au contrat E.
P4. **Tone mapping dernier** : tout mélange, accumulation ou interpolation se fait en radiance linéaire avant ACES et sRGB. Critère : revue de code et test de linéarité (deux lampes = somme des deux images linéaires).
P5. **Approximations nommées** : sondes (interpolation), cartes (projection), amortissement (retard), proxy (erreur géométrique certifiée). Chaque approximation a un champ dans le diagnostic et une borne dans le contrat E.
P6. **Aucune lumière sans source déclarée** : ni ambiance fixe, ni « mode nuit » ; le jour est une lampe soleil ou ciel déclarée dans la scène, qui n'entre que par les ouvertures et projette des ombres — un couloir sans fenêtre reste noir en plein jour, sauf rebond indirect. Vaut pour tous les matériaux, transparents et feuillages compris, et c'est le cas des deux côtés depuis le lot « transparents sans ambiance » : les arbres d'Emerald s'éteignent la nuit et suivent les lampes déclarées. Reste : les adaptateurs Three ne lisent pas le magasin `SceneLight`, donc le moteur de référence WebGL rend sans éclairage tant que l'hôte ne pose pas de lumière Three (lot « import des lampes »). Critère : scénario couloir sans fenêtre, radiance nulle hors rebond indirect.

## 3. Compilateur (LC)

LC1. **Proxy résident** : représentation de toute la scène, indépendante de la caméra, toujours en mémoire (R4 la garantit pour les racines) : niveau grossier du DAG dont l'erreur certifiée est ≤ un seuil de scène (réglage : 5 cm), avec BVH propre, ou SDF par objet si la mesure E0 le justifie. Aucun rayon de lumière ne trace la coupe fine visible. Critère : Emerald, mémoire du proxy et temps de construction publiés ; erreur géométrique max ≤ seuil.
LC2. **Cartes de surfaces** : projections par objet (six directions, découpe en cartes), atlas et table ; géométrie, normales, matériaux ; aucune lumière. Métrique de couverture (fraction de l'aire des surfaces représentée), objets concaves compris. Critère : couverture ≥ 95 % sur les scènes du banc, taille d'atlas et budget en octets publiés.
LC3. **Instances** : les cartes sont partagées entre instances ; l'état lumineux ne l'est jamais (voir LR6).
LC4. **Formats** : `formatVersion` montée à chaque nouvelle colonne, formats inconnus refusés, provenance à octets identiques (C10).
LC5. **Oracle** : path tracer CPU dans le binaire, triangles sources, mêmes matériaux, lampes, caméra et empreintes de pixels que le runtime, chemins spéculaires inclus, intersections d'ombre indépendantes des shadow maps, plusieurs exécutions indépendantes et convergence vérifiée. Critère : incertitude publiée par pixel ; sous le seuil du contrat E, sinon verdict indéterminé.

## 4. Runtime (LR)

LR1. **Budgets par composant** (GPU, machine de référence Apple M2 Max, 1280 × 720, réglages) :

| Composant | Budget GPU par image |
|---|---:|
| Direct et ombres (shadow maps, PCSS) | 0,8 ms |
| Sondes d'irradiance (rayons contre le proxy) | 0,8 ms |
| Cache de surfaces (texels mis à jour) | 0,4 ms |
| Vue réfléchie (si une surface réfléchissante est visible) | 0,5 ms |
| Rassemblement final | inclus dans R6 |

Critère : chaque budget mesuré par passe GPU (WebGPU) ; la somme tient dans l'image de 8,33 ms avec la géométrie à son budget R6. Sur GPU intégré, budgets divisés par le rapport de puissance mesuré, jamais la résolution.

LR2. **Ordonnanceur de lumière** : une file de travaux (sondes, texels de cartes, faces de vue réfléchie) avec une priorité = résidu × influence sur l'image (adjoint approché), vidée jusqu'au budget puis suspendue ; zéro allocation par image ; dernière consigne remplaçable, réponses portant une révision. Critère : temps par image constant à ± 10 % pendant une porte qui claque ; aucune réponse obsolète appliquée à une autre géométrie.
LR3. **Direct** : shadow maps par lampe (cascades pour les lampes à grande portée), ombres douces PCSS ; une carte n'est redessinée que si sa lampe ou un objet dans sa portée a bougé, mise en cache sinon ; elle ne reçoit que ce qui peut projeter une ombre, dans sa portée et sa face, sans réduction de résolution ni de détail. Feuillages et grilles projettent l'ombre de leur découpe réelle (masque du matériau), jamais convertis en pleins ni en masqués : un `alphaMode: MASK` est rangé en `exact-clusters`, reçoit une ligne de visibilité et sa découpe est appliquée dans la passe de profondeur. Un matériau de mélange (`alphaMode: BLEND`) ne projette encore rien : un cluster transparent n'obtient pas de ligne de visibilité, donc n'entre pas dans la table des lignes dessinées des cartes d'ombre. Ombres atténuées et colorées des semi-transparents (verre, eau) : lot ultérieur, hors périmètre. Critère : contrat E composante « direct » ; retard nul.
LR4. **Indirect diffus** : grille de sondes éparses avec visibilité (moments de distance) pour éviter les fuites ; rayons tracés contre le proxy ; les rayons relisent le cache de surfaces pour le multi-rebond et la coloration ; hystérésis adaptative (détection de changement par sonde et par texel) ; occulteurs dynamiques (porte) testés aussi comme boîtes analytiques dans l'interpolation des sondes. Critère : contrat E composantes « indirect » et retard.
LR5. **Cache de surfaces** : lumière par texel de carte, mise à jour par budget, invalidation par région lors d'un mouvement. Critère : couverture LC2, contrat E.
LR6. **État lumineux par instance** : deux instances du même objet dans deux éclairages ont deux états ; déplacement d'une instance = invalidation de son état. Critère : scénario « déplacement d'instance ».
LR7. **Reflet pour toute surface réfléchissante** : le mécanisme de vue réfléchie est piloté par la propriété réfléchissante du matériau, pas par un objet « miroir » nommé ; toute surface qui déclare cette propriété en bénéficie, l'eau comprise. Vue réfléchie bornée à l'emprise écran de la surface, niveau de détail choisi par la même erreur d'écran que la vue principale ; le hors-champ vient de cette vue, jamais de l'espace écran seul. Critère : scénario « miroir hors champ », rejouable sur toute surface réfléchissante déclarée.
LR8. **WebGL2** : mêmes composants, sondes mises à jour par passes de fragments (BVH et proxy en textures), budgets propres ; parité jugée à l'état stable (B2, ≤ 2 par canal), retard jugé par sa propre limite. Critère : campagne parité.
LR9. **Métriques honnêtes** : par composant, CPU par étape, GPU par passe ou `null`, travaux en file, travaux traités, retard courant estimé, mémoire ; `null` pour ce qui n'est pas mesuré.

## 5. Contrat d'erreur (E)

E1. **Composantes séparées** : direct, indirect diffus, reflet, comparées à l'oracle en radiance linéaire RGB, par pixel.
E2. **Erreur normalisée** : `e = |L − L*| / (ε_abs + ε_rel · |L*|)`, conforme si `e ≤ 1`. Réglages initiaux : ε_rel = 2 %, ε_abs = 0,1 % de la radiance de référence de la scène, à confirmer par la première campagne.
E3. **Statistiques publiées** : maximum, p95, p99, fraction de pixels avec `e > 1`, par composante et par scénario.
E4. **Régions ciblées** : pièce derrière la porte fermée, mur recevant la coloration, contenu du miroir, contact entre objets, fente étroite.
E5. **Retard de réponse** après événement, mesuré comme le temps pour que l'erreur de la composante indirecte retombe sous le seuil E2 par rapport à l'état stable final : **cible 100 ms sur la machine de référence, limite 250 ms partout, 500 ms sur GPU intégré** (réglages, choisis sur les vidéos du banc 16 du 14 septembre). Au-delà de la limite : échec.
E6. **Variations temporelles** : erreur de `(L_t − L_{t−1})` face à l'oracle sur caméra fixe, pour détecter scintillement et traînées.
E7. **Oracle** : incertitude sous le seuil E2, sinon verdict indéterminé, jamais conforme.
E8. **Fidélité géométrique inchangée** : les composantes n'altèrent ni silhouettes ni ordre de dessin ; `tri = selected`, trous 0.

## 6. Plateformes (LP)

LP1. L'OS n'importe pas : le navigateur porte tout. Les matrices de test couvrent macOS, Windows, Linux par le même navigateur.
LP2. WebGPU est la voie principale (compute, sondes, proxy). WebGL2 est un repli complet à l'état stable, plus lent à converger.
LP3. GPU intégré : mêmes composants, budgets réduits, limite de retard E5 propre, jamais de baisse de résolution.
LP4. Sans aucun GPU utilisable : hors périmètre, déclaré comme capacité manquante.

## 7. Banc et preuve (LB)

LB1. Le banc 16 héberge et mesure ; les algorithmes vivent dans le SDK. Protocole : `16-lighting-transport/docs/protocole-eclairage.md` du Lab.
LB2. Scénarios : démarrage à froid, porte qui claque, porte qui s'ouvre, lampe mobile à vitesse fixe, interrupteur, fente étroite avec petite source intense, miroir voyant un objet hors champ, déplacement d'instance.
LB3. Provenance : résolution, DPR, fréquence, matériel, charge machine, commits SDK, Lab et compilateur, empreintes des caches.
LB4. **Profil par étape** : contrat `packages/sdk-core/stageProfile.ts`, exposé par `explorer.stageProfile()`, mesuré par le harnais `scripts/mesure` ; CPU et GPU jamais additionnés, `null` pour ce qui n'est pas mesuré.
LB5. **Chiffres de référence du 15 septembre 2026** (WebGPU) : Emerald de nuit — image entière 55 ms, géométrie 62 ms, ombres 32 ms (passes distinctes, non additionnées) ; maison à 4 lampes — image entière 1,9 ms.

## 8. Phases et critères de sortie

Ordre d'exécution des lots, décidé le 15 septembre 2026 — prime sur l'ordre implicite du tableau de phases ci-dessous, qui reste la référence pour les critères de sortie mesurés : ombres (en cours, LR3) → aucune lumière sans source déclarée (P6), opaques puis transparents, les deux livrés → reflet pour toute surface (LR7) → lumière qui rebondit (LR4, multi-rebond) → reflets flous (spéculaire rugueux) → optimisation mesurée.

| Phase | Contenu | Sortie mesurée |
|---|---|---|
| E0 | Quatre nombres : shadow maps dans le vrai pipeline ; proxy résident sur Emerald (mémoire, construction, erreur) ; vue réfléchie ; incertitude de l'oracle | Les quatre valeurs publiées, banc 16 |
| E1 | Direct : LR3 dans l'éclairage différé WebGPU | Budget LR1 tenu, E1–E3 direct conformes, pixels inchangés hors lumière |
| E2 | Proxy et sondes : LC1, LR4 sans cache de surfaces (un rebond) | E5 sous la limite sur la porte, budget tenu |
| E3 | Cartes et cache de surfaces : LC2, LR5, LR6, multi-rebond et coloration | Couverture ≥ 95 %, E4 régions conformes |
| E4 | Reflet pour toute surface : LR7 | Scénario miroir conforme, budget tenu |
| E5 | Ordonnanceur et budgets : LR2, hystérésis adaptative, GPU intégré | Cadence constante ± 10 %, E5 sur GPU intégré |
| E6 | WebGL2 : LR8 | Parité état stable, retard sous sa limite |

La phase E0 peut s'intercaler quand un créneau d'agent est libre ; les phases E1 à E6 ne commencent pas avant la fin des phases 1 à 3 de la spec géométrie (performance, DAG multi-matériaux, première image), sauf décision explicite.

## 9. Décisions prises et rejets

- Cadence fixe, convergence variable, même image finale : accepté le 14 septembre 2026.
- Retard : cible 100 ms, limite 250 ms, 500 ms sur GPU intégré ; réglages révisables après mesure.
- Illumination figée refusée comme destination ; les cartes ne contiennent aucune lumière.
- Rayons contre la coupe visible : refusé (dépend de la caméra, feuilles trop grosses) ; proxy résident obligatoire.
- Amortissement comme seul levier : refusé ; hystérésis adaptative et priorité par résidu et influence obligatoires.
- SSR et cubemap seuls pour les miroirs : refusés, ne donnent pas le hors-champ net.
- Bases par lampe (linéarité) : réservées aux scènes à nombreuses lampes fixes ; non prioritaires.
- Le prototype à rectangles et son solveur dense servent d'oracle de discrétisation et de scénario de retard ; aucune fonction de rendu ne s'y ajoute.
- Aucune lumière sans source déclarée : suppression de l'ambiance fixe et du « mode nuit » ; décidé le 15 septembre 2026, livré sur les deux chemins. L'exception des arbres d'Emerald est levée.
- Reflet pour toute surface : le lot « miroir » livre un mécanisme piloté par la propriété réfléchissante du matériau, réutilisable par toute surface, pas un objet miroir nommé ; décidé le 15 septembre 2026.
- Eau : pas de lot dédié ; matériau réfléchissant, transparent, à relief animé, déjà couvert par les règles existantes (LR7, transparence). Seule la réfraction avec absorption en profondeur reste une propriété à ajouter plus tard. Scène de test avec de l'eau à fournir par l'utilisateur.

## 10. Exécution des calculs et bornes (X)

X1. **Trois familles, trois lieux** : à la compilation dans le binaire Rust (proxy, cartes, BVH, oracle) ; à chaque image sur le GPU (ombres, rayons des sondes, texels du cache, vue réfléchie, rassemblement) ; sur le CPU seulement l'ordonnanceur (changements, priorités, file), quelques centaines de microsecondes, déplacé dans un Worker si la mesure dépasse 1 ms. Aucun solveur dense au runtime : le solveur du prototype reste l'oracle de discrétisation hors ligne.
X2. **Toute boucle est bornée par une constante connue avant l'image** : traversée du BVH bornée par la profondeur de l'arbre du proxy ; PCSS à nombre de prises fixe (réglage : 16) ; interpolation à huit sondes par pixel ; rayons par sonde et texels par lot fixes. Aucune boucle par pixel sur les lampes, les surfaces ou les échantillons de source : le direct vient des shadow maps, l'indirect des sondes. Critère : revue des shaders, bornes publiées dans le diagnostic.
X3. **La seule itération ouverte, la convergence, s'étale sur les images** : chaque mise à jour de sonde relit le cache de surfaces qui porte la lumière de l'image précédente ; les rebonds successifs apparaissent aux mises à jour successives. Coût par image nul ; retard borné par E5.
X4. **Budget tenu par lots** : le travail est découpé en lots de taille fixe ; l'ordonnanceur choisit le nombre de lots de l'image d'après le temps GPU des images précédentes (requêtes d'horodatage WebGPU) et s'arrête sous le budget LR1. WebGL2 : nombre de lots calibré au démarrage. Critère : LR2.
X5. **Lampes à ombre plafonnées** : au plus N lampes à ombre mises à jour par image (réglage : 4, les plus influentes) ; les autres gardent leur shadow map en cache, rafraîchie à tour de rôle ; une lampe immobile dans une scène immobile ne coûte rien. Critère : coût du direct indépendant du nombre total de lampes.
X6. **Priorités calculées sur le GPU, relues en asynchrone** : résidu (écart entre deux mises à jour) et influence (visible, distance, vu dans un miroir) par sonde et par région de carte ; relecture avec une image de retard, jamais synchrone.
X7. **Risques de coût réels, mesurés en E0** : bande passante mémoire (atlas du cache, textures de sondes) plus qu'arithmétique ; divergence de la traversée sur GPU intégré ; seconde passe de géométrie de la vue réfléchie. Si un lot dépasse, sa taille diminue ; l'image ne ralentit pas, la convergence s'allonge.
X8. **Worker et WebAssembly, règle d'emploi** : un Worker quand un travail CPU mesuré dépasse 1 ms par image ou dure plusieurs images (compilation d'un objet, invalidation massive), pour garder le fil principal libre ; il n'accélère rien. Le code Rust compilé en WebAssembly quand un noyau CPU mesuré domine, ou quand la même math doit être partagée avec le compilateur (BVH, proxy, erreur d'écran, picking) ; SIMD si disponible. Ni l'un ni l'autre ne soulage le GPU : jamais comme réponse à un dessin trop cher. Candidat à mesurer en E6 : mise à jour des sondes en WebAssembly dans des Workers comme repli WebGL2, face aux passes de fragments.

## 11. Repères du moteur de référence du marché, vocabulaire neutre (RX)

Repères externes publics (version 2026), en vocabulaire neutre, chacun avec ce qu'il change chez nous. Aucun ne se copie tel quel : chaque repère se rejoue sur nos propres scènes et son propre budget avant d'entrer dans le code.

RX1. **Champs d'irradiance + occlusion par sondes comme mode « léger »**, publiés environ deux fois plus rapides qu'un rebond tracé haute qualité. C'est déjà notre direction (LR4, LC5) : les sondes clairsemées et le cache de surfaces du lot rebond 2 sont ce mode léger, pas une étape intermédiaire vers autre chose. Priorité : resserrer ce chemin (base d'ordre 2, budget en millisecondes du lot rebond 3) plutôt que d'ajouter un rebond tracé par pixel séparé.
RX2. **Éclairage stochastique par pixel** (un rayon d'ombre par pixel, accumulation temporelle, rejet des lampes hors portée), publié pour porter des centaines de lampes ombrées sans une carte d'ombre par lampe. **Le rejet des lampes hors portée est livré le 15 septembre 2026** : les listes par tuile portent deux tranches de profondeur, celle des opaques inchangée et celle du mélange qui va du plan proche au fond opaque, si bien que la passe de mélange boucle sur les seules lampes qui atteignent sa tranche — exactement, sans rien tirer au sort. **Le tirage et l'accumulation temporelle sont mesurés et non retenus** (branche `essai/stochastique-accumulation`, jamais fusionnée) : écrire l'historique depuis le nuanceur de fragments prive le tuileur de son élimination des surfaces cachées — étape Transparents de 2,4 à 32,7 ms sur une vue d'Emerald sans aucun transparent visible — et l'historique par pixel n'accumule rien sous surdessin transparent, 99,7 % des clés étant rejetées. Lot futur : l'historique porté par une cible de rendu supplémentaire, en ping-pong, que le tuileur traite sans perdre son élimination ; et le plafond X5 remplacé par un budget en millisecondes.
RX3. **Ombres virtualisées** : un cache d'ombre à budget d'invalidation différée, qui ne recalcule que les faces effectivement touchées par un changement. C'est déjà notre règle (LR3, lot ombres du 15 septembre 2026 : rejet par portée et par face, résidence, zéro travail en scène immobile). À étendre : le budget est aujourd'hui un plafond de lampes (X5), pas un budget en millisecondes par image ; en faire un budget temporel, comme X4 le demande pour le rebond, est le même levier appliqué au direct.
RX4. **Résolution minimale des cartes du cache de surfaces abaissée** (repère externe : 4 → 2, sur l'axe le plus fin d'une carte). Chez nous, LC2 fixe une couverture (≥ 95 %) mais ne borne pas la résolution minimale d'une carte de projection. Paramètre à ajouter à LC2, à exposer côté compilateur, et à mesurer sur Emerald (octets d'atlas, couverture, écart à l'oracle) avant tout changement de défaut.

## 12. Restes et ordre des lots

Ordre proposé, prime sur l'ordre implicite de la section 8 : rebond 3 → ombres lointaines du soleil contre le proxy → reflet pour toute surface (LR7) → reflets flous → éclairage stochastique par pixel, historique en cible de rendu (RX2, reste) → optimisation mesurée.

- **Rebond 3** (`lot/rebond-3`, non fusionné dans `develop` au 15 septembre 2026) : cascades de sondes autour de la caméra, budget en millisecondes plutôt qu'en nombre de mailles et de rayons (X4, LR1), base d'harmoniques sphériques d'ordre 2 (pour resserrer les 12,6 % d'écart vers la cible de 10 %), activation par défaut une fois le budget tenu.
- **Ombres des matériaux de mélange** : un cluster transparent n'obtient pas de ligne de visibilité (`webgpuRowSync.ts`), donc il n'entre pas dans la table des lignes dessinées des cartes d'ombre et ne projette rien. Sur Emerald, ce sont 29 primitives `clustered-blend` et 1,73 M triangles de feuillage. Les masques, eux, projettent déjà leur découpe réelle par le chemin opaque. L'ombre atténuée et colorée d'un semi-transparent reste un lot à part entière.
- **Ombres lointaines du soleil contre le proxy** : au-delà de `sunShadowFarFraction` (0,2 du lointain), une surface est éclairée sans test d'ombre — approximation nommée, publiée dans le diagnostic `direct-lighting`, mais pas encore couverte par une ombre contre le proxy résident.
- **Reflet pour toute surface** (LR7) : décidé en section 9, non livré — un prototype expérimental hors dépôt existe (`codex/light-transport-experiment`), aucune ligne dans `develop`. Reste le premier lot spéculaire.
- **Import des lampes depuis les fichiers** (glTF, FBX) : **livré le 16 septembre 2026**. Le compilateur lit `KHR_lights_punctual` (le FBX y passe par ufbx), convertit en unités radiométriques par une constante publiée, et écrit les lampes en espace monde dans un produit de cache à part, `lights.json`, sans toucher à la version de manifeste ; le SDK les déclare à l'ouverture et `explorer.importedLights()` les rend à l'hôte. Détail dans `docs/SDK.md` et `orchestration/JOURNAL.md`.
- **Reflets flous** (spéculaire rugueux) : hors périmètre de LR7 tel que livré, qui vise la réflexion nette.
- **Éclairage stochastique par pixel** (RX2, reste) : le rejet par tuile est livré, le tirage ne l'est pas. Deux choses à faire avant de le reprendre. **L'historique doit passer par une cible de rendu supplémentaire**, en ping-pong, et non par un tampon de stockage : mesuré, une écriture depuis le nuanceur de fragments coûte 30 ms d'étape Transparents sur Emerald, parce que le tuileur cesse d'éliminer les surfaces cachées et ombre tout le feuillage caché. **Et il faut un banc où le tirage puisse gagner** : sur Emerald à huit lampes, la boucle sur les lampes déclarées ne testait déjà qu'une lampe par pixel — les ponctuelles sont hors de portée des feuillages et sortaient par le fenêtrage de portée avant toute lecture d'atlas —, si bien que le tirage n'avait rien à retirer. Le gain de RX2 se prouve avec des lampes qui atteignent vraiment les transparents, pas avec un compte de lampes déclarées.
- **Optimisation mesurée** : ordonnanceur en budget de millisecondes (X4, LR2), hystérésis adaptative généralisée, GPU intégré — phase E5 de la section 8, qui reste la référence pour les critères de sortie.
