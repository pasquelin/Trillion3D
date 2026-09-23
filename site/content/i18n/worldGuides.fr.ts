import type { LocaleOverlay } from './entryOverlay.ts';

/** French overlay for the world guides: camera controls, the family index and the
 *  measurement entry point. Split from `guides.fr.ts` to keep both files under the 200-line
 *  source cap. */
export const worldGuidesFr: LocaleOverlay = {
  'camera-controls': {
    title: 'Contrôleurs de caméra, possédés par le monde',
    description:
      'Le contrôleur donné à un monde à sa création — orbite, vol, première personne, trackball, panoramique plan, ou aucun — et comment un hôte passe de l’un à l’autre.',
    html: `<p>Un monde possède son contrôleur de caméra : il lit les <code>PointerEvent</code>, <code>WheelEvent</code> et <code>KeyboardEvent</code> sur la caméra propre au monde, et n’apporte aucune bibliothèque à lui dans la page. Une option le choisit, à la création, et ne rien dire vaut <strong>aucun</strong> — le monde ne lit aucune entrée et l’hôte pilote <code>world.camera</code> lui-même, tant qu’il n’en nomme pas un. <code>'orbit'</code> est le plateau tournant qu’un spectateur attend : un glissement principal tourne l’azimut et l’élévation autour de la cible cadrée, le haut du monde conservé et les pôles jamais atteints ; un glissement secondaire ou deux doigts déplacent ; la molette et le pincement zooment.</p>
<ul class="list-disc pl-6 space-y-1">
<li><code>'none'</code> — le monde ne lit aucune entrée ; l’hôte pilote <code>world.camera</code> lui-même. La valeur par défaut quand rien n’est nommé.</li>
<li><code>'orbit'</code> — le plateau tournant ci-dessus.</li>
<li><code>'fly'</code> — six degrés de liberté : W/S avant et arrière, A/D gauche et droite, R/F haut et bas, flèches tangage et lacet, Q/E roulis, et un glissement regarde autour.</li>
<li><code>'firstPerson'</code> — le verrouillage du pointeur est demandé au geste, l’horizon reste horizontal, la marche suit le seul lacet.</li>
<li><code>'trackball'</code> — la scène tourne autour des deux axes de l’écran, roulis compris et aucun pôle où caler.</li>
<li><code>'panZoom'</code> — la caméra ne tourne jamais ; les glissements font glisser la vue, la molette et le pincement la déplacent dans le plan qu’elle regarde.</li>
</ul>
<p><strong>Rien ne se passe dans une scène immobile.</strong> Le monde ne redessine que tant que le contrôleur déplace la pose, ou que l’hôte appelle <code>invalidate()</code> ; une orbite posée ou une touche relâchée ne coûte rien.</p>
<p><strong><code>world.controls</code> est une poignée vivante, pas un choix figé.</strong> L’option <code>controls</code> ne fixe que ce avec quoi le monde démarre ; <code>world.controls.kind</code> relit ou change à tout moment quel contrôleur pilote la caméra — le précédent est libéré et le suivant construit sur la caméra propre au monde. <code>world.controls.enabled</code> le coupe sans le perdre, et <code>world.controls.target</code> est le point autour duquel un contrôleur à pivot tourne.</p>
<p>Les contrôles vivent sur le monde pour deux raisons : ils lisent l’entrée sur le canevas que le monde possède déjà — un second écouteur doublerait les gestes — et ils suivent <code>world.camera</code> quand elle est remplacée, si bien qu’un hôte ne reconstruit jamais son contrôleur à la main. Exemple en direct : <a class="link link-primary" href="#/fr/examples/five-ways-to-move-the-camera">Cinq façons de déplacer la caméra</a>.</p>`,
  },
  'measurement-entry': {
    title: 'Le point d’entrée de mesure',
    description:
      'Là où un témoin, un moteur de rendu forcé ou une session interne restent nommables — jamais par le point d’entrée publié `web-geometry`.',
    html: `<p>Une page importe <code>web-geometry</code> et ne voit jamais de moteur de rendu interne, de témoin ni de session interne : <code>createWorld</code> dessine avec un seul moteur de rendu, choisi sur la machine ou refusé nommément s’il est forcé et absent. Le banc, les preuves et les vues de comparaison ont encore besoin de nommer un témoin — Three.js nu, <code>THREE.LOD</code>, la session interne <code>openMeasuredWorld</code> — et c’est le seul rôle du point d’entrée de mesure séparé, <code>packages/sdk-browser/src/measurement/measurement.ts</code>.</p>
<p>Il réexporte tout ce que le point d’entrée publié expose, plus ce qu’un hôte n’a jamais besoin de voir : <code>openMeasuredWorld</code>/<code>createMeasuredWorldJob</code> (la session interne qu’un monde ouvre sur lui-même), les fabriques de moteurs (<code>referenceBackend</code>, <code>exactPagesBackend</code>, <code>threeLodBackend</code>, <code>webgpuPagesBackend</code>, <code>autonomousPagesBackend</code>), et des aides réservées à la mesure comme <code>replicateInstances</code>. Rien de tout cela n’atteint un monde publié, et rien n’est importé par une application.</p>`,
  },
};
