// Options de lampes, soleil, rebond et intensité du harnais, pour `options.mjs`.

/** Les options d'éclairage : lampes, soleil, rebond, intensité et ombres. */
export function lightingSettings(flags, number) {
  return {
    // La lumière qui rebondit est éteinte par défaut dans le moteur : le banc l'allume sur demande.
    bounce: (flags.get('rebond') ?? 'off') === 'on',
    // Lampes du contrat posées par la règle générique de `lampes.mjs` : leur nombre, si elles
    // projettent une ombre, et si la première d'entre elles bouge à chaque image.
    lights: number('lampes', 0),
    lightShadows: (flags.get('ombres') ?? 'on') !== 'off',
    // `--intensite` règle ce qu'une ponctuelle du banc émet, pour toutes les scènes de la même
    // façon : sans elle, l'indirect d'un modèle à grande maille reste sous le quantum de la capture.
    lightIntensity: number('intensite', 40),
    movingLight: flags.get('lampe-mobile') === 'true',
    // `--lampes-fichier off` ouvre la scène sans les lampes que son fichier source portait ; le
    // moteur les déclare de lui-même sinon. C'est la porte de fidélité du lot d'import des lampes :
    // deux exécutions dont seule cette option diffère.
    importedLights: (flags.get('lampes-fichier') ?? 'on') !== 'off',
    // `--soleil` ajoute la lampe directionnelle générique de `lampes.mjs`, avec ses cascades.
    sun: flags.get('soleil') === 'true',
    // Budget de l'étape Ombres, en millisecondes de carte graphique par image. Sans l'option, le
    // moteur garde le sien (`LIGHT_SETTINGS.shadowBudgetMs`).
    shadowBudgetMs: flags.has('budget-ombres') ? number('budget-ombres', 1) : null,
    // `--ombres-pages off` fait repartir la face entière dès qu'un objet bouge dans la portée d'une
    // lampe, comme avant le lot des ombres virtualisées. C'est la porte d'identité des cartes :
    // deux exécutions dont seule cette option diffère doivent rendre la même empreinte d'atlas.
    shadowPages: (flags.get('ombres-pages') ?? 'on') !== 'off',
    // `--empreinte-ombres` vide la file des pages d'ombre puis relit l'atlas de profondeur et en
    // publie l'empreinte. Éteint par défaut : c'est une lecture de 64 Mo, pas une mesure d'image.
    shadowDigest: flags.get('empreinte-ombres') === 'true',
    // `--objet-mobile <nœud>` déplace un nœud nommé de la scène préparée d'un petit cercle à chaque
    // image. Le harnais ne devine aucun nom : c'est l'hôte qui le donne, comme il donne son cache.
    movingNode: flags.get('objet-mobile') ?? null,
    movingNodeRadius: number('objet-rayon', 1),
  };
}
