import { WRAP_COORD_WGSL } from './visibilityWrapModes.ts';
import { ATLAS_CLASS_COUNT } from './webgpuAtlasClasses.ts';

/**
 * Les lectures d'atlas partagées par toutes les passes, engendrées une fois par classe de taille.
 *
 * Deux indirections, toutes deux dans la table des slots que le moteur tient à jour : le slot d'une
 * texture dit dans quelle classe et sur quelle couche elle vit, et — pour la couleur — jusqu'où sa
 * chaîne de mips est résidente. Tant qu'elle ne l'est pas jusqu'au niveau 0, l'échantillonnage est
 * explicite et borné aux niveaux réellement écrits ; dès que la pleine résolution est arrivée et ses
 * mips régénérés, le mot vaut `ATLAS_READY` et la lecture est exactement celle d'avant ce lot, à
 * dérivées explicites, sur la vraie texture. L'image finale est donc celle d'avant, au bit près.
 *
 * Le shader hôte déclare lui-même `maps0..`, `dataMaps0..`, `mapsSampler`, `colorSlots` et
 * `dataSlots` aux numéros de liaison que `webgpuBindEntries.ts` publie, et n'insère que les blocs
 * qu'il emploie.
 */
const CLASSES = Array.from({ length: ATLAS_CLASS_COUNT }, (_, index) => index);

/** Les texels du niveau 0 de la texture source d'un slot : la classe suffit, la couche est inutile. */
function texels(name: string, load: string, maps: string) {
  const lu = (index: number) => `vec2f(textureDimensions(${maps}${index},0))*scale`;
  return `fn ${name}(slot:u32,scale:vec2f)->vec2f{
 ${load}
 ${CLASSES.slice(0, -1)
   .map((index) => `if(atlasClass(word)==${index}u){return ${lu(index)};}`)
   .join('\n ')}
 return ${lu(ATLAS_CLASS_COUNT - 1)};
}`;
}

/**
 * Les préalables de toutes les lectures d'atlas : la règle d'adressage d'une coordonnée, le décodage
 * d'un mot de slot, et le nombre de texels de la texture source d'un slot couleur — la taille de sa
 * classe multipliée par son échelle, donc la période que l'adressage doit reboucler.
 */
export const ATLAS_SLOTS_WGSL = `${WRAP_COORD_WGSL}
const ATLAS_READY:u32=0xffffffffu;
fn atlasClass(word:u32)->u32{return word&0xffu;}
fn atlasLayer(word:u32)->i32{return i32(word>>8u);}
fn atlasFinest(lod:u32)->f32{return f32(lod&0xffu);}
fn atlasCoarsest(lod:u32)->f32{return f32((lod>>8u)&0xffu);}
fn atlasLod(px:vec2f,py:vec2f)->f32{return 0.5*log2(max(max(dot(px,px),dot(py,py)),1e-20));}
${texels('colorTexels', 'let word=colorSlots[slot].x;', 'maps')}`;

/** Le choix de classe : une comparaison par classe, la dernière restant le cas par défaut. */
const dispatch = (name: string, args: string, load: string, call: string, base: string) =>
  `fn ${name}(slot:u32,${args}{
 ${load}let layer=atlasLayer(word);
 ${CLASSES.slice(0, -1)
   .map((index) => `if(atlasClass(word)==${index}u){return ${base}${index}(layer,${call});}`)
   .join('\n ')}
 return ${base}${ATLAS_CLASS_COUNT - 1}(layer,${call});
}`;

/**
 * La lecture publique d'un atlas : `wrap` est le quartet d'adressage de la carte lue, pas celui du
 * matériau — une même page adresse ses six cartes chacune dans son propre mode. Puis une
 * seule lecture hors couture — exactement celle d'avant ce lot, au bit près — et quatre mêlées sur
 * la couture d'une période en répétition, où la règle de l'échantillonneur mêle le dernier texel de
 * la texture et le premier. Replier la coordonnée les sépare et aucun mode d'échantillonneur en
 * serrage ne les rapproche : c'est la lecture, pas la coordonnée, qui doit reboucler.
 *
 * Sans bit de répétition, `wrapUv` rendrait la coordonnée repliée et une couture fausse : le
 * premier chemin la replie donc directement, et s'épargne le compte de texels — un second
 * chargement du mot de slot que la lecture tient déjà, une chaîne de dispatch de classe et un
 * `textureDimensions`, jusqu'à six fois par pixel. Le repli rendu est le même, au bit près.
 *
 * `name` nomme la lecture publique, et `name + 'At'` la lecture par classe qu'elle dispatche : les
 * deux se dérivent l'une de l'autre, jamais deux paramètres qui pourraient se contredire.
 */
const wrapped = (name: string, compte: string, args: string, call: string, out: string) => {
  const at = `${name}At`;
  return `fn ${name}(slot:u32,scale:vec2f,uv:vec2f,wrap:u32${args})->${out}{
 if(!wrapRepete(wrap)){return ${at}(slot,scale,wrapReplie(uv,wrap)${call});}
 let t=wrapUv(uv,wrap,${compte}(slot,scale));
 if(!t.couture){return ${at}(slot,scale,t.proche${call});}
 let s00=${at}(slot,scale,t.proche${call});
 let s10=${at}(slot,scale,vec2f(t.loin.x,t.proche.y)${call});
 let s01=${at}(slot,scale,vec2f(t.proche.x,t.loin.y)${call});
 let s11=${at}(slot,scale,t.loin${call});
 return mix(mix(s00,s10,t.poids.x),mix(s01,s11,t.poids.x),t.poids.y);
}`;
};

const COLOR_LOAD = 'let entry=colorSlots[slot];let word=entry.x;';
const DATA_LOAD = 'let word=dataSlots[slot];';

/** Couleur : chemin d'avant quand la couche est prête, niveau explicite borné pendant le chargement. */
const colorClass = (index: number) =>
  `fn colorSample${index}(layer:i32,lod:u32,scale:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f{
 if(lod==ATLAS_READY){return textureSampleGrad(maps${index},mapsSampler,uv*scale,layer,ddx*scale,ddy*scale);}
 let texels=vec2f(textureDimensions(maps${index},0))*scale;
 let level=clamp(atlasLod(ddx*texels,ddy*texels),atlasFinest(lod),atlasCoarsest(lod));
 return textureSampleLevel(maps${index},mapsSampler,uv*scale,layer,level);
}`;

/**
 * Découpe alpha : sans dérivées, on lit le niveau le plus fin résident, et le 0 une fois prêt.
 * Ce niveau grossier ne fausse pas la découpe parce que la chaîne est fabriquée à la médiane de
 * l'alpha (`textureMips.ts`), qui conserve la couverture du seuil d'un niveau au suivant.
 */
const alphaClass = (index: number) =>
  `fn colorAlpha${index}(layer:i32,lod:u32,scale:vec2f,uv:vec2f)->f32{
 let level=select(atlasFinest(lod),0.0,lod==ATLAS_READY);
 return textureSampleLevel(maps${index},mapsSampler,uv*scale,layer,level).w;
}`;

/** Données : aucun niveau progressif, donc exactement la lecture d'avant ce lot. */
const dataClass = (index: number) =>
  `fn dataSample${index}(layer:i32,scale:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f{
 return textureSampleGrad(dataMaps${index},mapsSampler,uv*scale,layer,ddx*scale,ddy*scale);
}`;

/** Lecture de l'atlas couleur : `colorSample(slot, uvScale, uv, wrap, ddx, ddy)`. */
export const COLOR_SAMPLE_WGSL = `${CLASSES.map(colorClass).join('\n')}
${dispatch('colorSampleAt', 'scale:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f', COLOR_LOAD, 'entry.y,scale,uv,ddx,ddy', 'colorSample')}
${wrapped('colorSample', 'colorTexels', ',ddx:vec2f,ddy:vec2f', ',ddx,ddy', 'vec4f')}`;

/** Découpe alpha de l'atlas couleur : `colorAlpha(slot, uvScale, uv, wrap)`. */
export const COLOR_ALPHA_WGSL = `${CLASSES.map(alphaClass).join('\n')}
${dispatch('colorAlphaAt', 'scale:vec2f,uv:vec2f)->f32', COLOR_LOAD, 'entry.y,scale,uv', 'colorAlpha')}
${wrapped('colorAlpha', 'colorTexels', '', '', 'f32')}`;

/** Lecture de l'atlas de données : `dataSample(slot, uvScale, uv, wrap, ddx, ddy)`. */
export const DATA_SAMPLE_WGSL = `${CLASSES.map(dataClass).join('\n')}
${texels('dataTexels', DATA_LOAD, 'dataMaps')}
${dispatch('dataSampleAt', 'scale:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f', DATA_LOAD, 'scale,uv,ddx,ddy', 'dataSample')}
${wrapped('dataSample', 'dataTexels', ',ddx:vec2f,ddy:vec2f', ',ddx,ddy', 'vec4f')}`;

/** Les déclarations de texture d'un atlas, une par classe, aux liaisons que la disposition donne. */
export const atlasTextures = (bindings: readonly number[], name: string) =>
  bindings
    .map(
      (binding, index) =>
        `@group(0) @binding(${binding}) var ${name}${index}:texture_2d_array<f32>;`,
    )
    .join('\n');
