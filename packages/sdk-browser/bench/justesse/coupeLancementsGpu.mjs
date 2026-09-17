/**
 * La coupe entière encodée et chronométrée dans Chromium, une variante d'encodage contre l'autre.
 *
 * Ce que la carte paie entre deux noyaux ne se compte pas en fils mais en COMMANDES : chaque passe de
 * calcul et chaque copie hors passe ferment l'encodeur courant et en ouvrent un autre. Le banc mesure
 * donc la SUITE ENTIÈRE d'une image — descente, ouverture des candidates, escalades, masque et
 * compaction —, jamais un noyau isolé, et il la mesure pour les deux encodages sur la même scène,
 * dans le même appareil, en alternant les tours pour que la dérive thermique tombe des deux côtés.
 *
 * `niveaux` peut dépasser la profondeur de la hiérarchie : les passes de trop trouvent une file vide
 * et ne font rien, mais leurs commandes sont bien ouvertes. C'est ce qui donne la PENTE — le prix
 * d'un niveau de plus —, et donc ce que coûte une hiérarchie profonde sans extrapoler la mesure.
 */

/** Exécuté dans la page : les deux variantes compilées, puis chronométrées à tour de rôle. */
export async function executer({ variantes, cas, workgroup, tours, niveaux, rondes }) {
  const appareil = await globalThis.ouvrirAppareil();
  if (!appareil) return { indisponible: 'aucun adaptateur WebGPU' };
  const { device, erreurs } = appareil;
  const lu = 'read-only-storage',
    ecrit = 'storage';
  const layout = device.createBindGroupLayout({
    entries: [lu, lu, 'uniform', ecrit, ecrit, ecrit, lu, ecrit, lu].map((type, binding) => ({
      binding,
      visibility: GPUShaderStage.COMPUTE,
      buffer: { type },
    })),
  });
  const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [layout] });
  const NOYAUX =
    'dagPrepare dagClearDrawn dagWanted dagEscalate dagCheck dagMask dagDrawPrefix dagDrawScatter';
  const montees = [];
  for (const variante of variantes) {
    const { module, compilation } = await appareil.compile(variante.shader);
    if (compilation.length) return { compilation, erreurs, variante: variante.nom };
    const etape = (entryPoint) =>
      device.createComputePipeline({ layout: pipelineLayout, compute: { module, entryPoint } });
    const noyaux = Object.fromEntries(NOYAUX.split(' ').map((nom) => [nom, etape(nom)]));
    const niveauxPipelines = [];
    for (let q = 0; q < variante.files; q++) niveauxPipelines.push(etape(`dagLevel${q}`));
    montees.push({ ...variante, noyaux, niveauxPipelines, d: variante.decalages });
  }
  const STORAGE = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
  const tampon = (taille, source, usage = STORAGE) => {
    const buffer = device.createBuffer({ size: Math.max(taille, source?.length ?? 0), usage });
    if (source) device.queue.writeBuffer(buffer, 0, new Uint8Array(source));
    return buffer;
  };
  const groupes = (n) => Math.max(1, Math.ceil(n / workgroup));
  const blockCount = groupes(cas.pageCount);
  const filesMax = Math.max(...variantes.map((v) => v.files));
  const sortieOctets = 16 + cas.pageCount * 4;
  const readbackOctets = sortieOctets * 2;
  const buffers = [
    tampon(64, cas.clusters),
    tampon(64, cas.nodes),
    tampon(256, cas.uniforms, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST),
    tampon(Math.max(16, (cas.nodeCount * filesMax + cas.pageCount * 4) * 4)),
    tampon(readbackOctets),
    tampon(Math.max(8, (cas.worldCount * 2 + blockCount * 2 + 12) * 4)),
    tampon(64, cas.worlds),
    tampon(16, cas.frames),
    tampon(48, cas.pageCones),
  ];
  const INDIRECT = GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_DST;
  const args = device.createBuffer({ size: 16, usage: INDIRECT });
  device.queue.writeBuffer(args, 0, new Uint32Array([0, 1, 1, 0]));
  const zeros = device.createBuffer({ size: 16, usage: GPUBufferUsage.COPY_SRC });
  const lecture = device.createBuffer({
    size: readbackOctets,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const relu = (ints, tete, borne) => {
    const compte = Math.min(ints[tete], borne);
    return Array.from(ints.subarray(tete + 4, tete + 4 + compte));
  };
  const group = device.createBindGroup({
    layout,
    entries: buffers.map((buffer, binding) => ({ binding, resource: { buffer } })),
  });

  /** Une image complète, encodée exactement comme le moteur l'encode pour cette variante. */
  const image = (encoder, montee, profondeur) => {
    const { noyaux, niveauxPipelines, files, d } = montee;
    const arme = (octets) => encoder.copyBufferToBuffer(buffers[5], octets, args, 0, 4);
    const seule = (pipeline) => {
      const passe = encoder.beginComputePass();
      passe.setBindGroup(0, group);
      passe.setPipeline(pipeline);
      passe.dispatchWorkgroupsIndirect(args, 0);
      passe.end();
    };
    arme(d.drawn);
    const tete = encoder.beginComputePass();
    tete.setBindGroup(0, group);
    tete.setPipeline(noyaux.dagClearDrawn);
    tete.dispatchWorkgroupsIndirect(args, 0);
    tete.setPipeline(noyaux.dagPrepare);
    tete.dispatchWorkgroups(groupes(Math.max(cas.worldCount, blockCount)));
    tete.setPipeline(niveauxPipelines[0]);
    tete.dispatchWorkgroups(groupes(cas.worldCount));
    // `lancement` dit comment la descente est encodée. « plat » est la coupe livrée : tous les
    // niveaux dans CETTE passe, chacun sur un majorant connu du rangement. Les autres valeurs sont
    // des DIAGNOSTICS — une passe par niveau, avec ou sans armement, ou même vide — qui ne rendent
    // aucune coupe et ne sont jamais comparées ; elles disent seulement d'où vient le prix.
    if (montee.lancement === 'plat')
      for (let niveau = 1; niveau < profondeur; niveau++) {
        tete.setPipeline(niveauxPipelines[niveau % files]);
        tete.dispatchWorkgroups(groupes(montee.bornes[niveau] ?? 0));
      }
    tete.end();
    if (montee.lancement !== 'plat')
      for (let niveau = 1; niveau < profondeur; niveau++) {
        const source = niveau % files;
        if (montee.lancement === 'vide') {
          const vide = encoder.beginComputePass();
          vide.end();
          continue;
        }
        if (montee.lancement === 'direct') {
          const droite = encoder.beginComputePass();
          droite.setBindGroup(0, group);
          droite.setPipeline(niveauxPipelines[source]);
          droite.dispatchWorkgroups(1);
          droite.end();
          continue;
        }
        if (files === 2)
          encoder.copyBufferToBuffer(zeros, 0, buffers[5], d.queueReset[1 - source], 8);
        if (montee.lancement !== 'sansCopie') arme(d.queueGroups[source]);
        seule(niveauxPipelines[source]);
      }
    arme(d.cand);
    seule(noyaux.dagWanted);
    arme(d.live);
    const vif = encoder.beginComputePass();
    vif.setBindGroup(0, group);
    const surListe = (pipeline) => {
      vif.setPipeline(pipeline);
      vif.dispatchWorkgroupsIndirect(args, 0);
    };
    for (let ronde = 0; ronde < 3; ronde++) surListe(noyaux.dagEscalate);
    surListe(noyaux.dagCheck);
    surListe(noyaux.dagMask);
    vif.setPipeline(noyaux.dagDrawPrefix);
    vif.dispatchWorkgroups(1);
    surListe(noyaux.dagDrawScatter);
    vif.end();
  };

  /**
   * Un lot d'images, et les DEUX temps qu'il faut séparer : celui que le processeur passe à écrire
   * les commandes, et celui qu'on attend encore une fois la dernière soumise. Les confondre
   * attribuerait au GPU un encodage processeur, ce qui n'est pas la même dépense et ne s'additionne
   * pas. `encodage` est le premier, `total` les deux bout à bout.
   */
  const lot = async (montee, profondeur, nombre) => {
    const debut = performance.now();
    for (let image_ = 0; image_ < nombre; image_++) {
      const encoder = device.createCommandEncoder();
      image(encoder, montee, profondeur);
      device.queue.submit([encoder.finish()]);
    }
    const ecrit = performance.now();
    await device.queue.onSubmittedWorkDone();
    const fin = performance.now();
    return { encodage: (ecrit - debut) / nombre, total: (fin - debut) / nombre };
  };
  const relire = async () => {
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(buffers[4], 0, lecture, 0, readbackOctets);
    device.queue.submit([encoder.finish()]);
    await lecture.mapAsync(GPUMapMode.READ);
    const ints = new Uint32Array(lecture.getMappedRange().slice(0));
    lecture.unmap();
    return {
      pages: relu(ints, 0, cas.pageCount).sort((a, b) => a - b),
      dessinees: relu(ints, sortieOctets / 4, cas.pageCount),
      frustumRejected: ints[1],
      overflow: ints[3],
    };
  };

  const mesures = montees.map(() => niveaux.map(() => []));
  const sorties = [];
  for (let ronde = 0; ronde < rondes; ronde++)
    for (let v = 0; v < montees.length; v++)
      for (let n = 0; n < niveaux.length; n++) {
        await lot(montees[v], niveaux[n], Math.max(2, tours >> 2));
        mesures[v][n].push(await lot(montees[v], niveaux[n], tours));
        const comparable = !montees[v].lancement || montees[v].lancement === 'plat';
        if (ronde === 0 && niveaux[n] === cas.levelCount && comparable)
          sorties.push({ nom: montees[v].nom, ...(await relire()) });
      }
  const info = await appareil.fermer();
  return { adaptateur: info.court, erreurs, mesures, sorties, niveaux };
}
