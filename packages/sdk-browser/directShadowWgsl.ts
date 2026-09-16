import { LIGHT_SETTINGS, POINT_FACES } from '../sdk-core/index.ts';

const POISSON_16 = [
  [-0.94201624, -0.39906216],
  [0.94558609, -0.76890725],
  [-0.094184101, -0.9293887],
  [0.34495938, 0.2938776],
  [-0.91588581, 0.45771432],
  [-0.81544232, -0.87912464],
  [-0.38277543, 0.27676845],
  [0.97484398, 0.75648379],
  [0.44323325, -0.97511554],
  [0.53742981, -0.4737342],
  [-0.26496911, -0.41893023],
  [0.79197514, 0.19090188],
  [-0.2418884, 0.99706507],
  [-0.81409955, 0.9143759],
  [0.19984126, 0.78641367],
  [0.14383161, -0.1410079],
];

/**
 * La lecture de l'atlas d'ombres : une tranche par lampe, six faces pour une ponctuelle, une pour un
 * projecteur, les cascades pour une lampe directionnelle. Comparaison de profondeur avec biais
 * constant et biais par pente, puis moyenne de seize prises. Les bornes viennent des réglages
 * publiés — ni la tranche ni le noyau ne peuvent déborder du rectangle de la face.
 */
export const DIRECT_SHADOW_WGSL = `
struct ShadowFace{viewProjection:mat4x4f,rect:vec4f,}
struct ShadowSlice{faces:array<ShadowFace,${POINT_FACES}>,info:vec4f,}
struct ShadowSlices{items:array<ShadowSlice>,}
const PCF_TAPS:u32=${LIGHT_SETTINGS.pcfTaps}u;
const SHADOW_BIAS:f32=${LIGHT_SETTINGS.shadowDepthBias};
const SHADOW_SLOPE:f32=${LIGHT_SETTINGS.shadowSlopeBias};
const SHADOW_SLOPE_MAX:f32=${LIGHT_SETTINGS.shadowSlopeBiasMax};
const SHADOW_NORMAL_TEXELS:f32=${LIGHT_SETTINGS.shadowNormalOffsetTexels};
const POISSON:array<vec2f,${LIGHT_SETTINGS.pcfTaps}>=array<vec2f,${LIGHT_SETTINGS.pcfTaps}>(${POISSON_16.map(
  ([x, y]) => `vec2f(${x},${y})`,
).join(',')});
/** Biais en mètres au point considéré : une surface rasante a besoin de plus de marge qu'une de face.
 *  La marge s'AJOUTE à la référence, la profondeur des ombres étant inversée comme celle de la
 *  caméra : rapprocher la référence de la lampe, c'est l'augmenter. */
fn shadowBiasMetres(cosine:f32)->f32{
 return SHADOW_BIAS+min(SHADOW_SLOPE*sqrt(1.0-cosine*cosine)/cosine,SHADOW_SLOPE_MAX);
}
/** Seize prises dans le rectangle de la face, décalées d'un texel de la tranche, jamais d'atlas. */
fn shadowPcf(entry:ShadowFace,local:vec2f,reference:f32,side:f32)->f32{
 let step=1.0/max(side,1.0);
 var lit=0.0;
 for(var tap=0u;tap<PCF_TAPS;tap++){
  let offset=POISSON[tap]*step;
  let inside=clamp(local+offset,vec2f(0.0),vec2f(1.0));
  let uv=entry.rect.xy+inside*entry.rect.z;
  lit+=textureSampleCompareLevel(shadowAtlas,shadowSampler,uv,reference);
 }
 return lit/f32(PCF_TAPS);
}
/**
 * Les cascades du soleil : la première dont le point tombe dans le cube unité gagne, et la boucle
 * est bornée par le nombre de cascades publié (X2). L'échelle de la cascade se lit dans sa propre
 * matrice — orthographique, donc le texel monde vaut 2/(échelle en x · côté) et un mètre de
 * profondeur vaut l'échelle en z. Aucune donnée en double, donc rien qui puisse diverger.
 */
fn sunShadowFactor(record:ShadowSlice,cascades:u32,P:vec3f,N:vec3f,L:vec3f)->f32{
 let cosine=clamp(dot(N,L),1e-3,1.0);
 let side=max(record.info.z,1.0);
 for(var c=0u;c<min(SUN_CASCADES,cascades);c++){
  let entry=record.faces[c];
  if(entry.rect.w<0.5){continue;}
  let m=entry.viewProjection;
  let scaleX=max(length(vec3f(m[0][0],m[1][0],m[2][0])),1e-9);
  let scaleZ=length(vec3f(m[0][2],m[1][2],m[2][2]));
  let texel=2.0/(scaleX*side);
  let clip=m*vec4f(P+N*texel*SHADOW_NORMAL_TEXELS/max(cosine,0.2),1.0);
  let ndc=clip.xyz/clip.w;
  if(abs(ndc.x)>1.0||abs(ndc.y)>1.0||ndc.z<0.0||ndc.z>1.0){continue;}
  let local=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5);
  return shadowPcf(entry,local,ndc.z+shadowBiasMetres(cosine)*scaleZ,side);
 }
 // Au-delà de la dernière cascade, l'ombre se teste par un rayon contre le proxy résident. Sans
 // proxy dans le cache, ce rayon rend un, la surface lointaine reste éclairée sans ombre portée,
 // et le diagnostic dit « ombre lointaine indisponible » : jamais une ombre inventée.
 return sunFarShadowFactor(P,N,L);
}
/** Fraction de lumiere qui atteint le point : 1 en pleine lumiere, 0 entierement dans l'ombre. */
fn shadowFactor(slice:i32,light:DirectLight,P:vec3f,N:vec3f,L:vec3f)->f32{
 if(slice<0){return 1.0;}
 let record=shadows.items[u32(slice)];
 let faces=u32(record.info.x);
 if(faces==0u){return 1.0;}
 if(isSun(light)){return sunShadowFactor(record,faces,P,N,L);}
 let face=select(0u,pointFaceOf(P-light.positionRange.xyz),faces==POINT_FACES);
 let entry=record.faces[face];
 if(entry.rect.w<0.5){return 1.0;}
 // Le point lu est décalé le long de la normale d'un texel de la tranche, divisé par le cosinus
 // d'incidence : un texel couvre d'autant plus de profondeur que la surface est rasante. C'est ce
 // décalage qui referme la couture entre deux faces d'une ponctuelle et supprime l'acné rasante.
 let cosine=clamp(dot(N,L),1e-3,1.0);
 let radius=length(light.positionRange.xyz-P);
 let side=max(record.info.z,1.0);
 let texel=2.0*record.info.y*radius/side;
 let clip=entry.viewProjection*vec4f(P+N*texel*SHADOW_NORMAL_TEXELS/max(cosine,0.2),1.0);
 if(clip.w<=0.0){return 1.0;}
 let ndc=clip.xyz/clip.w;
 if(abs(ndc.x)>1.0||abs(ndc.y)>1.0||ndc.z<0.0||ndc.z>1.0){return 1.0;}
 let local=vec2f(ndc.x*0.5+0.5,0.5-ndc.y*0.5);
 // Ces mètres deviennent une marge de profondeur au point considéré : dz/dd d'une projection
 // perspective vaut near·far/((far−near)·d²), donc la marge suit la distance à la lampe.
 let near=record.info.w;
 let far=max(near*1.001,light.positionRange.w);
 let scale=near*far/((far-near)*max(clip.w*clip.w,1e-4));
 return shadowPcf(entry,local,ndc.z+shadowBiasMetres(cosine)*scale,side);
}`;
