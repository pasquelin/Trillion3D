export const guidesFr = {
  'example-many-lights': {
    title: 'Beaucoup de lumières, un seul budget',
    description:
      'Déclarez un anneau de lampes avec ombres, lisez le budget d’échantillonnage, et distinguez une image immobile convergée d’une image en mouvement.',
    html: `<p>Chaque lumière déclarée est triée par tuile d’écran de 16×16 pixels (<code>lightSettings.maxLightsPerTile</code> conservées au plus). Ce qu’un pixel fait de la liste de sa tuile dépend de l’image : une image <strong>en mouvement</strong>, que l’anticrénelage temporel accumule, pèse chaque lumière sans son ombre — la part bon marché — et n’en calcule entièrement que <code>lightSettings.samplesPerPixel</code> (4), lecture d’ombre comprise : une lumière qui vaut la part d’un échantillon est calculée exactement, les autres sont tirées en proportion de leur poids et divisées par leur probabilité, si bien que l’historique moyenne une estimation sans biais. Une image <strong>immobile</strong> calcule toutes les lumières de la tuile et converge vers la somme exacte sur ses seize images accumulées, puis se tient : deux exécutions donnent la même image au bit près.</p>
<p>Ce qu’un hôte observe : <code>explorer.lightSettings</code> publie les budgets ; <code>metrics().lightsSampled</code> est le drapeau du mode : <code>true</code> quand la résolution a tourné en mode échantillonné — une image en mouvement sur un historique, où un pixel ayant plus de lumières que d’échantillons en tire un sous-ensemble —, <code>false</code> quand elle a parcouru toute la liste ; <code>metrics().frameHeld</code> dit que l’image immobile a convergé ; <code>stageProfile()</code> porte l’étape de résolution de l’éclairage. Le coût déclaré est un léger grain sur les surfaces éclairées pendant que la caméra bouge, mesuré dans <code>docs/SDK.md</code> ; le gain, caméra mobile sur trente-deux lampes avec ombres atteignant un même pixel, est une enveloppe GPU de 39,9 → 17,9 ms en 2496×1404. La <a class="link link-primary" href="#/fr/playground/many-lights-sampling">leçon de l’anneau</a> le montre en direct.</p>`,
  },
  'example-explorer': {
    title: 'Démarrage et budgets de l’explorateur',
    description:
      'Démarrage interactif avec des budgets mémoire explicites ; le moteur gère les contrôles, la taille et le rendu à la demande.',
  },
  'example-camera': {
    title: 'Image caméra sans allocation',
    description:
      'Une projection et une image caméra allouées une fois, puis réécrites à chaque image depuis une matrice monde.',
  },
  'example-batch': {
    title: 'Une hiérarchie en un lot',
    description:
      'Dix mille nœuds composés puis multipliés par leurs parents en une passe sur des tampons plats.',
  },
  'example-diagnostics': {
    title: 'Diagnostics et qualité',
    description:
      'Changez ce que dessine l’image et la finesse de la coupe sur un explorateur actif.',
  },
  'quick-start': {
    title: 'Démarrage rapide',
    description:
      'D’un fichier glTF à une scène diffusée dans un canevas : compilez une fois, explorez dans le navigateur.',
    html: `<p>Le moteur diffuse la géométrie par grappes : un compilateur natif découpe une fois la scène source en pages, puis l’explorateur du navigateur ne lit que celles demandées par la caméra, sous des budgets mémoire fixes. Le même point d’entrée sélectionne le contrat adapté à chaque environnement.</p>
<ol>
<li><strong>Compilez</strong> sur la machine qui détient la source avec <code>web-geometry</code>. Le cache reçoit manifeste, pages et textures annexes ; <code>resourceBaseUrl</code> est l’URL que lira le navigateur.</li>
<li><strong>Explorez</strong> dans le navigateur avec le même import <code>web-geometry</code>. <code>createExplorer</code> accepte un ID ou un élément canevas. Avec <code>interactive: true</code>, le moteur gère les contrôles, la taille et le rendu à la demande. Donnez au canevas une largeur et une hauteur CSS ; appelez <code>dispose()</code> à la fermeture. Ce démarrage simple nécessite WebGPU.</li>
</ol>
<p>Le contrat complet — options, budgets, éclairage, anticrénelage temporel et diagnostics — se trouve dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md">docs/SDK.md</a>.</p>`,
  },
  'occlusion-two-phase': {
    title: 'Occlusion : le Hi-Z en deux passes',
    description:
      'Comment une grappe cachée derrière une autre quitte l’image, ce qui en décide, et les compteurs qui le disent.',
    html: `<p>Le chemin de visibilité WebGPU dessine ses grappes opaques en deux passes, selon le schéma publié en deux phases. Aucune option à régler : le mécanisme est fixe, automatique, et lit sa propre histoire.</p>
<ol class="list-decimal pl-6 space-y-1">
<li><strong>Passe principale.</strong> Une grappe est un <em>occulteur</em> quand l’image précédente l’a dessinée et que la pyramide de profondeur de cette image ne la cache pas : son rectangle et sa borne de profondeur d’alors sont relus contre cette pyramide, encore dans son tampon. Les occulteurs sont rastérisés en premier.</li>
<li><strong>Pyramide.</strong> La profondeur de la passe principale devient une pyramide Hi-Z : une chaîne de mips où chaque texel garde la profondeur la plus lointaine de son empreinte.</li>
<li><strong>Seconde passe.</strong> Toute autre grappe — retirée des occulteurs, ou rejetée à l’image précédente — est testée contre cette pyramide : une empreinte découpée à la fenêtre, le mip qui la couvre en seize texels, et la comparaison de la profondeur la plus proche de la grappe à la plus lointaine lue là. Ce qui reste caché n’est pas dessiné ; le reste est rastérisé dans une seconde passe sur les mêmes cibles.</li>
</ol>
<p>Le test de la seconde passe est le seul autorisé à rejeter, et il est conservateur à l’ulp : le rectangle contient celui de la référence, la borne de profondeur reste en dessous, une boîte qui coupe le plan proche n’est jamais rejetée. Le verdict de la passe principale ne décide que de l’<em>ordre de dessin</em> : un verdict faux coûte un second test, jamais un pixel. C’est pourquoi un monde déplacé, une cible redimensionnée ou une page qui change de rang n’ont rien à invalider — seul un rang qui change de page oublie ce qu’il tenait.</p>
<p>Dans une vue immobile, les deux moitiés convergent en un cycle de gigue d’anticrénelage : une grappe que le test a gardée reste occulteur jusqu’à ce que la vue, ou un monde, bouge. L’image est alors tenue — aucune passe ne tourne — ce qu’une pyramide mouvante interdirait.</p>
<h3 class="text-lg font-bold mt-4">La lire</h3>
<ul class="list-disc pl-6 space-y-1">
<li><code>render()</code> renvoie <code>hizTestedClusters</code>, <code>hizRejectedClusters</code>, <code>hizRejectedTriangles</code> et <code>hizCountedFrame</code> : ce que la seconde passe a testé et rejeté sur l’image décrite par le dernier relevé périodique — la carte compte, l’hôte relit une image sur quinze, et <code>null</code> signifie aucun relevé encore, jamais zéro.</li>
<li><code>stageProfile()</code> porte l’étape de partition : <code>lignes</code> (lignes résidentes), <code>occulteurs</code>, <code>testees</code>, <code>historiqueOcculteurs</code> (lignes dessinées à l’image précédente) et <code>retiresParLaPyramide</code> (lignes que cette pyramide a retirées), avec les millisecondes GPU des passes <code>WG partition</code>, <code>WG HiZ pyramid</code>, <code>WG HiZ test</code>, <code>WG visibility primary</code> et <code>WG visibility secondary</code>.</li>
<li>Le banc de mesure imprime les mêmes nombres par vue sous <em>Hi-Z tested/rejected</em> ; la vue de rue de la scène de référence rejette 5 131 des 24 902 lignes là où l’ancienne histoire en rejetait 440.</li>
</ul>
<p>La leçon <a class="link link-primary" href="#/fr/examples/occlusion-two-phase">Cacher un anneau derrière un anneau</a> montre les compteurs bouger sur le jardin quand l’œil descend à hauteur d’anneau.</p>`,
  },
  architecture: {
    title: 'Architecture et règles',
    description:
      'Les promesses du moteur et les conventions suivies par chaque fonction ci-dessous.',
    html: `<p>La mission décrite dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/architecture/PRODUCT_PRINCIPLES.md">Principes du produit</a> est une géométrie virtualisée pour le web : grappes diffusées, une coupe du DAG par image, tampon de visibilité, anticrénelage temporel, budgets mémoire et de diffusion fixes. Les étapes d’éclairage figurent dans <code>docs/SPEC_ENGINE_WITHOUT_THREE.md</code> §8.</p>
<h3 class="text-lg font-bold mt-4">Une image, sur le chemin WebGPU</h3>
<p>Le GPU coupe le DAG et compacte les grappes à dessiner ; la rastérisation matérielle écrit un <strong>tampon de visibilité</strong> (un identifiant par pixel) derrière un test d’occultation Hi-Z ; la <strong>résolution des matériaux</strong> reconstruit ensuite la surface de chaque pixel — couleur de base, normale, rugosité, émission — <em>une classe de matériau par passe</em> : une passe écrit la classe de chaque pixel comme une profondeur exacte, puis chaque classe trace un triangle plein écran à sa propre profondeur sous le test matériel <code>equal</code>, avec un pipeline compilé pour ses seuls traits (cartes, découpe, normales de sommet, tangentes). Suivent l’éclairage différé, les transparents, l’anticrénelage temporel et la présentation. Observez-le en direct avec <code>setDiagnostic('materials')</code> (une couleur par classe), le diagnostic <code>material-classes-ready</code> (les classes de la scène) et <code>stageProfile()</code> (le bloc <code>materials</code> : <code>WG material depth</code> et <code>WG material surfaces v1</code>).</p>
<h3 class="text-lg font-bold mt-4">Conventions de l’API mathématique</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Matrices 4×4 en ordre colonne</strong>, seize nombres consécutifs, translation en <code>[12..14]</code>.</li>
<li><strong>Sortie d’abord, aucune allocation.</strong> Une fonction écrit dans <code>out</code> et le renvoie ; les décalages permettent à un grand tampon de contenir plusieurs opérandes.</li>
<li><strong><code>Float64Array</code> pour les calculs</strong>, <code>ArrayLike&lt;number&gt;</code> pour la lecture. La simple précision intervient lors de l’envoi vers le GPU.</li>
<li><strong>Mêmes bits que la référence</strong>, vérifiés par <code>pnpm run perf:core</code>, sauf les deux écarts déclarés : courbe sRGB et termes de profondeur de la projection inversée infinie.</li>
<li><strong>Mesurer avant d’optimiser.</strong> Les profils CPU et GPU localisent le coût d’une image ; aucune optimisation ne part d’une supposition.</li>
</ul>
<h3 class="text-lg font-bold mt-4">Lire ce portail</h3>
<p>Chaque entrée nomme le fichier qui la contient. Le badge <span class="badge badge-warning badge-sm">en développement</span> désigne une fonction absente de <code>develop</code> et renvoie vers l’issue qui porte son contrat. Toutes les autres entrées sont livrées aujourd’hui.</p>`,
  },
  'three-migration': {
    title: 'Migration depuis Three.js',
    description:
      'Ce qu’un hôte Three.js remplace, fonction par fonction, et les différences numériques déclarées.',
    html: `<p>Le moteur ne dépend plus de la bibliothèque hôte pour ses calculs : un hôte Three.js conserve sa scène et transmet des nombres. Les lignes ci-dessous sont livrées ; l’adaptateur et la table complète de migration relèvent de l’issue #79.</p>
<div class="overflow-x-auto my-4"><table class="table table-zebra table-sm"><thead><tr><th>Three.js</th><th>Moteur</th><th>Différence déclarée</th></tr></thead><tbody>
<tr><td><code>Matrix4.multiplyMatrices(a, b)</code></td><td><code>multiplyMatrix4(out, a, b)</code></td><td>aucune : mêmes bits, ×1,2</td></tr>
<tr><td><code>Matrix4.invert()</code></td><td><code>invertMatrix4(out, m)</code></td><td>aucune : une matrice singulière donne seize zéros</td></tr>
<tr><td><code>Matrix4.compose / decompose</code></td><td><code>composeMatrix4 / decomposeMatrix4</code></td><td>aucune</td></tr>
<tr><td><code>Vector3.dot / crossVectors / applyMatrix4</code></td><td><code>dotVector3 / crossVector3 / transformAffinePoint</code></td><td>aucune ; lecture par décalages</td></tr>
<tr><td><code>Color.convertSRGBToLinear()</code></td><td><code>srgbToLinear(c)</code></td><td>courbe exacte au lieu de constantes arrondies ; écart ≤ 1e-11</td></tr>
<tr><td><code>PerspectiveCamera.updateProjectionMatrix()</code></td><td><code>perspectiveProjection(...)</code></td><td>profondeur inversée, plan lointain infini</td></tr>
<tr><td><code>Frustum.setFromProjectionMatrix</code></td><td><code>updateCameraFrame(...)</code></td><td>le plan lointain vient du <code>far</code> déclaré</td></tr>
<tr><td><code>FrontSide / BackSide / DoubleSide</code></td><td><code>Side = 'front' | 'back' | 'double'</code></td><td>lu une fois à la frontière d’import</td></tr>
<tr><td><code>Object3D.updateMatrixWorld</code></td><td><code>updateNodeMatrixWorld(...)</code></td><td>même parcours sur des tableaux plats</td></tr>
<tr><td><code>THREE.LOD</code></td><td>—</td><td>la coupe du DAG choisit le détail par image selon l’erreur écran</td></tr>
</tbody></table></div>
<p>Les fonctions livrées et leurs preuves figurent dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/API.md">docs/API.md</a>.</p>
<p>Parcours en deux temps : garder Three.js pour charger et construire la scène tout en dessinant avec le moteur, puis passer au cache compilé et retirer <code>three</code> des dépendances.</p>`,
  },
  'texture-compression': {
    title: 'Textures compressées à la cuisson',
    description:
      'BC7 pour les cartes de bureau, ASTC 4×4 pour les mobiles, cuits une fois par le compilateur ; la carte choisit, le pool tient un octet par texel.',
    html: `<p>Les textures des matériaux sont virtuelles : le compilateur cuit toute la chaîne de mips de chaque texture lue par un atlas, le navigateur ne lit que les tuiles de 128×128 demandées par l’image, et deux pools fixes les portent. Sans compression, un texel coûte quatre octets dans le pool. Le compilateur cuit désormais chaque niveau trois fois — un PNG sans perte, puis le même niveau en <strong>BC7</strong> et en <strong>ASTC 4×4</strong>, un octet par texel — et la queue de chaque chaîne voyage dans l’annexe du manifeste dans les trois encodages. Un seul cache sert toutes les cartes.</p>
<h3 class="text-lg font-bold mt-4">Ce que le moteur décide</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>La carte choisit le format.</strong> Une carte avec <code>texture-compression-bc</code> lit du BC7, une avec <code>texture-compression-astc</code> lit de l’ASTC, une sans les deux garde le RGBA8 — la raison est publiée, jamais devinée. <code>textureCompression</code> (<code>'auto'</code> par défaut) peut imposer <code>'bc7'</code> ou <code>'astc'</code>, ou demander <code>'none'</code> : l’« avant » sans perte d’une comparaison.</li>
<li><strong>Les budgets ne bougent pas, les tuiles si.</strong> <code>texturePoolBytes</code> reste le même réservoir fixe ; en format bloc il porte quatre fois plus de tuiles — seize couches par atlas à 512 Mio au lieu de quatre — et chaque queue épinglée coûte le quart.</li>
<li><strong>Tout ou rien.</strong> Cela s’applique sous <code>textureSource: 'cache'</code>, et une image source ne peut pas remplir un pool bloc : une seule texture sans chaîne cuite complète ramène les deux pools au RGBA8, en le nommant.</li>
</ul>
<h3 class="text-lg font-bold mt-4">Ce qu’il faut lire</h3>
<p><code>texturePoolFormat</code> dans les métriques d’image nomme le pool couleur réellement tenu (<code>bc7-rgba-unorm-srgb</code>, <code>astc-4x4-unorm-srgb</code> ou <code>rgba8unorm-srgb</code>) ; <code>texturePoolBytes</code>, <code>texturePoolLayers</code> et <code>textureResidentBytes</code> suivent le format. Le diagnostic <code>material-textures-ready</code> porte le choix et sa raison sous <code>pool.compression</code>. Le banc oppose les formats sur un même cache avec <code>--textures cache --compression-avant none --compression-apres bc7</code>.</p>
<h3 class="text-lg font-bold mt-4">Le coût déclaré</h3>
<p>Les deux codecs sont ceux du compilateur, une seule disposition chacun et aucune recherche de mode : BC7 mode 6, ASTC à une partition sur la plage de 192 niveaux avec des poids de 3 bits, chaque bloc ajusté sur un segment de l’espace RGBA et prouvé sur un décodeur indépendant. Sur les textures 2048² de la scène de référence, la perte se lit à 45–63 dB de PSNR sur les cartes de couleur et de données lisses et à 32 dB sur une carte de normales de briques dont les blocs varient dans deux directions — le cas qu’un mode à deux sous-ensembles ou le BC5 servirait, laissé à un lot mesuré. Les seuils 0 px du banc ne s’appliquent pas à ce lot ; la différence de pixels est mesurée et publiée avec le lot.</p>
<p>Essayez-le en direct dans le bac à sable : <em>Redimensionner les deux pools</em> relit le format du pool de textures et son allocation acceptée. Contrat dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md">docs/SDK.md</a>, disposition du cache dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/FORMAT.md">docs/FORMAT.md</a>.</p>`,
  },
};
