export const guidesCompilerFr = {
  'dag-simplification': {
    title: 'Simplification : le DAG de grappes et ses deux quadriques',
    description:
      'Comment un niveau grossier est fait, de quels sommets, ce qui reste verrouillé, et le rapport qui dit ce qui s’est passé.',
    html: `<p>Le niveau 0 d’une primitive est une partition spatiale exacte de ses triangles en grappes de 128 au plus. Chaque niveau au-dessus regroupe 8 à 32 grappes voisines, simplifie le groupe fusionné à la moitié de ses triangles et redécoupe le résultat en grappes de même taille. Deux quantités voyagent avec chaque grappe — l’erreur du groupe qui l’a produite et l’erreur du groupe qui la remplace — et un moteur choisit, à chaque image, la coupe plate <code>parentError &gt; seuil ≥ lodError</code> avec <code>setPixelError</code>. L’option <code>simplification</code> de <code>prepare()</code> dit de quoi ces niveaux grossiers ont le droit d’être faits :</p>
<ul class="list-disc pl-6 space-y-1">
<li><code>none</code> — le niveau 0 seul. Chaque grappe est une racine ; rien à l’écran n’est une surface que la source n’a pas.</li>
<li><code>qem-endpoints</code> — une quadrique de position dont chaque fusion tombe sur un sommet existant. Une grappe grossière indexe encore le tampon de sommets de la source ; ses attributs sont ceux de la copie qui a survécu.</li>
<li><code>qem-attributes</code> — la quadrique attributaire publiée. Normales, les deux jeux de coordonnées de texture et couleurs entrent dans l’erreur (poids 0,5, 0,5 et 0,25 par unité, rapportés à l’étendue du groupe ; les tangentes sont copiées du survivant), puis chaque sommet survivant est résolu vers la position et les attributs qui minimisent sa quadrique. Un niveau grossier porte donc des sommets que la source n’a pas : le compilateur les ajoute au tampon de sommets de la primitive dans <code>source.gltf</code>, après les sommets source, et laisse l’accesseur d’indices tel quel.</li>
</ul>
<h3 class="text-lg font-bold mt-4">Ce qui reste en place</h3>
<ul class="list-disc pl-6 space-y-1">
<li><strong>Les bords de groupe.</strong> Un sommet que deux groupes du même niveau partagent est verrouillé : ni déplacé ni réécrit, si bien que la coupe reste étanche quel que soit le mélange de niveaux qu’une image dessine.</li>
<li><strong>Les coutures de texture.</strong> Une position écrite deux fois avec deux coordonnées de texture est une couture ; le simplificateur ne fait que la glisser le long d’elle-même et ne fusionne jamais ses deux côtés, si bien qu’une façade grossière ne porte jamais la texture de l’autre côté. Une position copiée pour une arête franche ou un saut de couleur n’est pas protégée : sous <code>qem-attributes</code> ses copies fusionnent ensemble et leurs normales sont résolues.</li>
<li><strong>L’entrée.</strong> Avant toute partition, le compilateur soude chaque sommet identique en position et en attributs sur sa première copie, quoi que le format source ait écrit — un sommet par coin de face, ou le même sommet deux fois. Une soudure qui rendrait une arête non manifold est refusée, et le rapport le dit.</li>
</ul>
<h3 class="text-lg font-bold mt-4">Le lire</h3>
<ul class="list-disc pl-6 space-y-1">
<li>Par primitive, <code>clusters.json</code> porte <code>vertices</code> — <code>{ source, used, welded, weldRefused, coarse }</code> — et <code>dag</code> : <code>depth</code>, <code>levels[]</code> avec la bande d’erreur de chaque niveau, et <code>groups[]</code> qui compte, niveau par niveau, les groupes réduits et pourquoi les autres ne l’ont pas été (<code>noCollapse</code>, <code>borderLost</code>), <code>welded</code> et <code>relocked</code> comptant les reprises.</li>
<li>Un DAG qui n’est pas monté est un avertissement que le compilateur porte sur l’événement de progression de la primitive et que le moteur publie comme diagnostic <code>dag-warnings</code> : <code>DAG_FLAT</code> (des grappes, aucun niveau grossier) ou <code>DAG_ROOTS</code> (trop de racines pour sa taille).</li>
<li>Dans l’image, <code>render()</code> renvoie <code>selectedTriangles</code> et <code>drawnTriangles</code> pour la coupe de l’image ; le diagnostic <code>lod</code> colore les grappes exactes et les relais grossiers.</li>
</ul>
<p>La leçon <a class="link link-primary" href="#/fr/examples/runtime-pixel-error">Traverser l’observatoire à toutes les échelles</a> montre la coupe bouger avec la tolérance sur un cache compilé avec <code>qem-endpoints</code> ; la même scène compilée avec <code>qem-attributes</code> révèle des niveaux faits de sommets résolus, leurs normales interpolées plutôt que choisies.</p>`,
  },
};
