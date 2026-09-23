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
  'families-reference': {
    title: 'Chaque famille, une ligne',
    description:
      'Chaque famille qu’un monde remet à une page, membre par membre — le contrat complet vit dans docs/SDK.md.',
    html: `<p>Tout ce qu’un monde construit vient de l’une de ces familles. Douze viennent du moteur à maillage entier qu’une page connaît déjà ; huit existent parce que la géométrie ici est <strong>coupée en pages</strong> que le moteur fait entrer et sortir de la mémoire selon ce que l’image lit — non une parité, mais ce qu’est ce moteur. Chaque membre, et un exemple pour chacun : <a class="link link-primary" href="https://github.com/pasquelin/WebGeometry/blob/develop/docs/SDK.md#families">docs/SDK.md, « Families »</a>.</p>
<div class="overflow-x-auto my-4"><table class="table table-zebra table-sm"><thead><tr><th>Famille</th><th>Membres</th></tr></thead><tbody>
<tr><td><code>geometry</code></td><td>la forme seule : <code>box</code>, <code>sphere</code>, <code>cylinder</code>, <code>cone</code>, <code>torus</code>, <code>torusKnot</code>, <code>plane</code>, <code>circle</code>, <code>ring</code>, <code>capsule</code>, <code>lathe</code>, <code>extrude</code>, <code>tube</code>, <code>shape</code>, <code>polyhedron</code>, <code>edges</code>, <code>wireframe</code>, <code>createBuffer</code></td></tr>
<tr><td><code>material</code></td><td>la matière seule : <code>meshStandard</code>, <code>meshPhysical</code>, <code>meshBasic</code>, <code>meshPhong</code>, <code>meshLambert</code>, <code>meshToon</code>, <code>meshNormal</code>, <code>meshMatcap</code>, <code>meshDepth</code>, <code>points</code>, <code>line</code>, <code>lineDashed</code>, <code>sprite</code>, <code>shadow</code>, <code>createShader</code></td></tr>
<tr><td><code>light</code></td><td><code>ambient</code>, <code>directional</code>, <code>point</code>, <code>spot</code>, <code>hemisphere</code>, <code>rectArea</code>, <code>probe</code></td></tr>
<tr><td><code>camera</code></td><td><code>perspective</code>, <code>orthographic</code>, <code>cube</code>, <code>stereo</code>, <code>array</code></td></tr>
<tr><td><code>object</code></td><td>forme et matière, placées : <code>mesh</code>, <code>group</code>, <code>points</code>, <code>line</code>, <code>lineSegments</code>, <code>lineLoop</code>, <code>sprite</code></td></tr>
<tr><td><code>math</code></td><td><code>vector2/3/4</code>, <code>matrix3/4</code>, <code>quaternion</code>, <code>euler</code>, <code>box3</code>, <code>sphere</code>, <code>plane</code>, <code>ray</code>, <code>triangle</code>, <code>frustum</code>, <code>color</code>, <code>spherical</code>, <code>curve</code>, <code>path</code>, <code>shape</code>, <code>clamp</code>, <code>lerp</code>, <code>degToRad</code></td></tr>
<tr><td><code>texture</code></td><td><code>image</code>, <code>data</code>, <code>canvas</code>, <code>video</code>, <code>depth</code>, <code>cube</code>, <code>array</code>, <code>compressed</code></td></tr>
<tr><td><code>loader</code></td><td><code>texture</code>, <code>cubeTexture</code>, <code>imageBitmap</code>, <code>file</code>, <code>data</code></td></tr>
<tr><td><code>helper</code></td><td>les repères de travail : <code>axes</code>, <code>grid</code>, <code>polarGrid</code>, <code>box</code>, <code>plane</code>, <code>arrow</code>, <code>camera</code>, <code>directionalLight</code>, <code>pointLight</code>, <code>spotLight</code>, <code>hemisphereLight</code></td></tr>
<tr><td><code>animation</code></td><td><code>createMixer</code>, <code>clip</code>, <code>track</code>, <code>numberTrack</code>, <code>vectorTrack</code>, <code>quaternionTrack</code>, <code>colorTrack</code></td></tr>
<tr><td><code>buffer</code></td><td><code>float32/16</code>, <code>uint32/16/8</code>, <code>int32/16/8</code>, <code>interleaved</code></td></tr>
<tr><td><code>blending</code>, <code>side</code>, <code>wrap</code>, <code>filter</code>, <code>colorSpace</code>, <code>toneMapping</code></td><td>des constantes gelées, chacune sa propre famille</td></tr>
<tr><td><code>page</code></td><td>la géométrie en pages : <code>createStreamer</code>, <code>createCache</code>, <code>httpSource</code>, <code>decode</code></td></tr>
<tr><td><code>budget</code></td><td>les enveloppes fixes jamais dépassées : <code>memory</code>, <code>geometryPool</code>, <code>texturePool</code></td></tr>
<tr><td><code>metric</code></td><td>ce que l’image a coûté, jamais estimé : <code>frame</code>, <code>cpuSteps</code>, <code>gpuPasses</code>, <code>createProfiler</code></td></tr>
<tr><td><code>diagnostic</code></td><td>observer le moteur travailler : <code>createChannel</code>, <code>presentationColor</code>, <code>partitionAudit</code>, <code>transparentOcclusion</code>, <code>shadowAtlas</code></td></tr>
<tr><td><code>capability</code></td><td>ce que la machine accorde : <code>detect</code>, <code>lighting</code></td></tr>
<tr><td><code>capture</code></td><td>une image prise à part : <code>surface</code>, <code>buffer</code></td></tr>
<tr><td><code>pose</code></td><td>poses nommées, cadrage, rejeu : <code>fromBounds</code>, <code>runPath</code>, <code>pointOfInterest</code></td></tr>
<tr><td><code>batch</code></td><td>mille matrices à la fois : <code>multiplyMatrix4</code>, <code>transformPoints</code>, <code>composeMatrix4</code>, <code>frustumKeepsBox</code></td></tr>
</tbody></table></div>
<p>Le monde lui-même n’est pas une famille : c’est l’objet que renvoie <code>createWorld</code>, portant <code>scene</code>, <code>camera</code>, <code>controls</code>, <code>budget</code>, <code>diagnostic</code>, <code>onFrame</code>/<code>loop</code>, <code>render</code>, <code>invalidate</code> et <code>dispose</code>. <code>LOD</code>, <code>InstancedMesh</code> et <code>BatchedMesh</code> n’ont pas d’équivalent ici — délibérément : la coupe du DAG est ce qu’ils existent pour approcher.</p>`,
  },
  'measurement-entry': {
    title: 'Le point d’entrée de mesure',
    description:
      'Là où un témoin, un moteur de rendu forcé ou une session interne restent nommables — jamais par le point d’entrée publié `web-geometry`.',
    html: `<p>Une page importe <code>web-geometry</code> et ne voit jamais de moteur de rendu interne, de témoin ni de session interne : <code>createWorld</code> dessine avec un seul moteur de rendu, choisi sur la machine ou refusé nommément s’il est forcé et absent. Le banc, les preuves et les vues de comparaison ont encore besoin de nommer un témoin — Three.js nu, <code>THREE.LOD</code>, la session interne <code>openMeasuredWorld</code> — et c’est le seul rôle du point d’entrée de mesure séparé, <code>packages/sdk-browser/src/measurement/measurement.ts</code>.</p>
<p>Il réexporte tout ce que le point d’entrée publié expose, plus ce qu’un hôte n’a jamais besoin de voir : <code>openMeasuredWorld</code>/<code>createMeasuredWorldJob</code> (la session interne qu’un monde ouvre sur lui-même), les fabriques de moteurs (<code>referenceBackend</code>, <code>exactPagesBackend</code>, <code>threeLodBackend</code>, <code>webgpuPagesBackend</code>, <code>autonomousPagesBackend</code>), et des aides réservées à la mesure comme <code>replicateInstances</code>. Rien de tout cela n’atteint un monde publié, et rien n’est importé par une application.</p>`,
  },
};
