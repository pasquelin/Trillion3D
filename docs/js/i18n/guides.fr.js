export const guidesFr = {
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
  architecture: {
    title: 'Architecture et règles',
    description:
      'Les promesses du moteur et les conventions suivies par chaque fonction ci-dessous.',
    html: `<p>La mission décrite dans <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/architecture/PRODUCT_PRINCIPLES.md">Principes du produit</a> est une géométrie virtualisée pour le web : grappes diffusées, une coupe du DAG par image, tampon de visibilité, anticrénelage temporel, budgets mémoire et de diffusion fixes. Les étapes d’éclairage figurent dans <code>docs/SPEC_ENGINE_WITHOUT_THREE.md</code> §8.</p>
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
<h3 class="text-lg font-bold mt-4">Ce que le chemin WebGL2 dessine lui-même</h3>
<p>Sur une session WebGL2, le moteur possède le contexte et dessine chaque cluster paginé avec son propre programme — lots opaques, masqués et fondus, pages de diagnostic — et, depuis #120, les surfaces transmissives de la scène : un maillage <code>KHR_materials_transmission</code> reste une copie de scène, composée après les clusters sur un fond figé de l’image en lumière linéaire, le même modèle que la passe WebGPU. Il n’y a pas d’autre rendu pour les clusters : un matériau, une lumière ou une texture que le programme ne peut préserver fait échouer la préparation avec l’<code>EngineError</code> <code>CLUSTER_MATERIAL_UNSUPPORTED</code>, dont <code>details.reason</code> nomme l’entrée, jamais une image partielle. Le rendu hôte compose encore les copies fondues restantes, le compositeur de comparaison, les captures et les images tenues (#85).</p>
<div class="overflow-x-auto my-4"><table class="table table-zebra table-sm"><thead><tr><th>Three.js</th><th>Moteur</th><th>Différence déclarée</th></tr></thead><tbody>
<tr><td><code>WebGLRenderer.renderTransmissionPass</code></td><td>passe de transmission de <code>WebglClusterRenderer</code></td><td>le fond est une copie brute : la rugosité ne le floute pas, un verre ne voit pas à travers un autre</td></tr>
<tr><td>extensions de <code>MeshPhysicalMaterial</code></td><td>facteurs de transmission, d’IOR et de volume seulement</td><td>clearcoat, sheen, iridescence, anisotropie, dispersion, spéculaire et leurs cartes sont refusés par leur nom</td></tr>
</tbody></table></div>
<p>Parcours en deux temps : garder Three.js pour charger et construire la scène tout en dessinant avec le moteur, puis passer au cache compilé et retirer <code>three</code> des dépendances.</p>`,
  },
};
