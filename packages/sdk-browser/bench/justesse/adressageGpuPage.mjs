// Défaut 4 : l'exécution WebGPU des lots d'adressage dans un vrai Chromium. Playwright est chargé
// depuis `render-tech-lab`, en lecture seule (`LAB_ROOT`, par défaut le voisin du dépôt).
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

/**
 * Dans la page : un rendu par lot (texture, modes, filtrage) sur deux cibles flottantes, relues.
 * Cible 0 : le WGSL du moteur, échantillonneur en serrage comme l'atlas. Cible 1 : la coordonnée
 * brute sous l'échantillonneur réglé avec le mode de la carte, comme Three le règle.
 */
async function executer({ shader, textures, lots }) {
  const adapter = await navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  // La carte réellement obtenue, rendue avec le relevé : `adapter.info` n'est pas clonable, on n'en
  // garde que les champs de texte.
  const info = adapter.info ?? {};
  const adaptateur = ['vendor', 'architecture', 'device', 'description']
    .map((champ) => info[champ])
    .filter(Boolean)
    .join(' / ');
  const erreurs = [];
  device.onuncapturederror = (e) => erreurs.push(e.error.message);
  const module = device.createShaderModule({ code: shader });
  const messages = (await module.getCompilationInfo()).messages.map((m) => m.message);
  const cible = { format: 'rgba32float' };
  const pipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex: { module },
    fragment: { module, targets: [cible, cible] },
  });
  const cartes = textures.map(({ largeur, hauteur, octets }) => {
    const texture = device.createTexture({
      size: [largeur, hauteur, 1],
      format: 'rgba8unorm',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const data = new Uint8Array(octets);
    device.queue.writeTexture({ texture }, data, { bytesPerRow: largeur * 4 }, [largeur, hauteur]);
    return texture.createView({ dimension: '2d-array' });
  });
  const sorties = [];
  for (const lot of lots) {
    const n = lot.uv.length / 2,
      filtre = lot.filtre;
    const donnees = new ArrayBuffer(n * 16);
    const f = new Float32Array(donnees),
      u = new Uint32Array(donnees);
    for (let i = 0; i < n; i++) {
      f[i * 4] = lot.uv[i * 2];
      f[i * 4 + 1] = lot.uv[i * 2 + 1];
      u[i * 4 + 2] = lot.flags[i];
    }
    const tampon = device.createBuffer({
      size: n * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(tampon, 0, donnees);
    const echantillonneur = (s, t) =>
      device.createSampler({
        addressModeU: s,
        addressModeV: t,
        magFilter: filtre,
        minFilter: filtre,
      });
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: cartes[lot.texture] },
        { binding: 1, resource: echantillonneur('clamp-to-edge', 'clamp-to-edge') },
        { binding: 2, resource: echantillonneur(lot.adresseS, lot.adresseT) },
        { binding: 3, resource: { buffer: tampon } },
      ],
    });
    const usage = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC;
    const vues = [0, 1].map(() =>
      device.createTexture({ size: [n, 1], format: 'rgba32float', usage }),
    );
    const encodeur = device.createCommandEncoder();
    const passe = encodeur.beginRenderPass({
      colorAttachments: vues.map((t) => ({
        view: t.createView(),
        loadOp: 'clear',
        storeOp: 'store',
      })),
    });
    passe.setPipeline(pipeline);
    passe.setBindGroup(0, bindGroup);
    passe.draw(3);
    passe.end();
    const ligne = Math.ceil((n * 16) / 256) * 256;
    const relues = vues.map((texture) => {
      const usageLu = GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ;
      const b = device.createBuffer({ size: ligne, usage: usageLu });
      encodeur.copyTextureToBuffer({ texture }, { buffer: b, bytesPerRow: ligne }, [n, 1]);
      return b;
    });
    device.queue.submit([encodeur.finish()]);
    const lu = [];
    for (const b of relues) {
      await b.mapAsync(GPUMapMode.READ);
      lu.push(Array.from(new Float32Array(b.getMappedRange().slice(0, n * 16))));
    }
    sorties.push({ moteur: lu[0], three: lu[1] });
  }
  return { adaptateur, messages, erreurs, sorties };
}

/** Lance Chromium, exécute les lots sur une origine locale servie par interception, referme. */
export async function executerDansChromium(argument) {
  const labRoot = process.env.LAB_ROOT ?? resolve('../render-tech-lab');
  const { chromium } = createRequire(resolve(labRoot, 'package.json'))('playwright');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    const origine = 'http://127.0.0.1:9/';
    const body = '<!doctype html><title>adressage</title>';
    await page.route(`${origine}**`, (r) =>
      r.fulfill({ status: 200, contentType: 'text/html', body }),
    );
    await page.goto(origine);
    const resultat = await page.evaluate(executer, argument);
    if (resultat.messages.length || resultat.erreurs.length)
      throw new Error(JSON.stringify({ messages: resultat.messages, erreurs: resultat.erreurs }));
    // La carte qui a rendu le relevé, consignée avec lui : un écart de bord dépend de l'adaptateur.
    console.log(`Adaptateur WebGPU : ${resultat.adaptateur || 'non renseigné'}`);
    return resultat.sorties;
  } finally {
    await browser.close();
  }
}
