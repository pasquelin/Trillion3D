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

/** Le décodage d'un mot de slot, exigé par tous les blocs qui suivent. */
export const ATLAS_SLOTS_WGSL = `const ATLAS_READY:u32=0xffffffffu;
fn atlasClass(word:u32)->u32{return word&0xffu;}
fn atlasLayer(word:u32)->i32{return i32(word>>8u);}
fn atlasFinest(lod:u32)->f32{return f32(lod&0xffu);}
fn atlasCoarsest(lod:u32)->f32{return f32((lod>>8u)&0xffu);}
fn atlasLod(px:vec2f,py:vec2f)->f32{return 0.5*log2(max(max(dot(px,px),dot(py,py)),1e-20));}`;

/** Le choix de classe : une comparaison par classe, la dernière restant le cas par défaut. */
const dispatch = (name: string, args: string, load: string, call: string) =>
  `fn ${name}(slot:u32,${args}{
 ${load}let layer=atlasLayer(word);
 ${CLASSES.slice(0, -1)
   .map((index) => `if(atlasClass(word)==${index}u){return ${name}${index}(layer,${call});}`)
   .join('\n ')}
 return ${name}${ATLAS_CLASS_COUNT - 1}(layer,${call});
}`;

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

/** Découpe alpha : sans dérivées, on lit le niveau le plus fin résident, et le 0 une fois prêt. */
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

/** Lecture de l'atlas couleur : `colorSample(slot, uvScale, uv, ddx, ddy)`. */
export const COLOR_SAMPLE_WGSL = `${CLASSES.map(colorClass).join('\n')}
${dispatch('colorSample', 'scale:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f', COLOR_LOAD, 'entry.y,scale,uv,ddx,ddy')}`;

/** Découpe alpha de l'atlas couleur : `colorAlpha(slot, uvScale, uv)`. */
export const COLOR_ALPHA_WGSL = `${CLASSES.map(alphaClass).join('\n')}
${dispatch('colorAlpha', 'scale:vec2f,uv:vec2f)->f32', COLOR_LOAD, 'entry.y,scale,uv')}`;

/** Lecture de l'atlas de données : `dataSample(slot, uvScale, uv, ddx, ddy)`. */
export const DATA_SAMPLE_WGSL = `${CLASSES.map(dataClass).join('\n')}
${dispatch('dataSample', 'scale:vec2f,uv:vec2f,ddx:vec2f,ddy:vec2f)->vec4f', DATA_LOAD, 'scale,uv,ddx,ddy')}`;

/** Les déclarations de texture d'un atlas, une par classe, aux liaisons que la disposition donne. */
export const atlasTextures = (bindings: readonly number[], name: string) =>
  bindings
    .map(
      (binding, index) =>
        `@group(0) @binding(${binding}) var ${name}${index}:texture_2d_array<f32>;`,
    )
    .join('\n');
