import { wgslBlock, type WgslDecl } from '../../../../math/src/wgsl/decl.ts'
import { hgPhase } from '../../../../math/src/wgsl/lighting.ts'
import { LOCAL_FOG_FLAG, LOCAL_FOG_INSTANCE, LOCAL_FOG_SLOT } from './localLayout.ts'

/** A slot of the block in the light buffer, by its number or its expression. */
export const localFogBlock = (slot: number | string) => `directLights.localFog[${slot}]`

/**
 * THE LOCAL FOG VOLUMES, as the programs read them from the light buffer (`localLayout.ts`): how
 * many the view draws, its switches, and each volume — a centre and a radius, a height axis, the
 * numbers of its law, its albedo and its emissive light.
 *
 * A volume is a unit sphere in its own space — `p / radius`, the point relative to its centre —: its
 * medium is dense at the centre and none at the surface radially, `radial · (1 − d²)` for the distance
 * `d` to the centre, and thins out with height `h` along its axis, `height · e^(−falloff · (h −
 * offset))`; the two are combined by their coverage, never added (`localFogCoverage`).
 */
export const FOG_LOCAL_DATA_WGSL = wgslBlock(
  'FOG_LOCAL_DATA_WGSL',
  [],
  `
struct LocalFog{centre:vec3f,radius:f32,axis:vec3f,start:f32,radial:f32,height:f32,falloff:f32,offset:f32,albedo:vec3f,phase:f32,emissive:vec3f,}
const LOCAL_FOG_INSTANCES:u32=${LOCAL_FOG_SLOT.instances}u;
const LOCAL_FOG_SLOTS_EACH:u32=${LOCAL_FOG_INSTANCE.slots}u;
/** How many volumes the view draws. */
fn localFogCount()->u32{return u32(${localFogBlock(LOCAL_FOG_SLOT.header)}.x);}
/** Whether the header's switch \`bit\` (\`LOCAL_FOG_FLAG\`) is set. */
fn localFogFlagged(bit:u32)->bool{return (u32(${localFogBlock(LOCAL_FOG_SLOT.header)}.y)&bit)!=0u;}
/** The distance, metres, before which no volume shows. */
fn localFogStart()->f32{return ${localFogBlock(LOCAL_FOG_SLOT.header)}.w;}
/** The volume \`i\` of the view. */
fn localFogAt(i:u32)->LocalFog{
 let base=LOCAL_FOG_INSTANCES+i*LOCAL_FOG_SLOTS_EACH;
 let c=${localFogBlock(`base+${LOCAL_FOG_INSTANCE.centre}u`)};
 let a=${localFogBlock(`base+${LOCAL_FOG_INSTANCE.axis}u`)};
 let l=${localFogBlock(`base+${LOCAL_FOG_INSTANCE.law}u`)};
 let o=${localFogBlock(`base+${LOCAL_FOG_INSTANCE.albedo}u`)};
 let e=${localFogBlock(`base+${LOCAL_FOG_INSTANCE.emissive}u`)};
 return LocalFog(c.xyz,c.w,a.xyz,a.w,l.x,l.y,l.z,l.w,o.xyz,o.w,e.xyz);
}`,
)

/** The lists of the local fog volumes over each tile, as a program that binds them at `b.tiles` reads
 *  them: a word, and how many words the buffer holds, which the view's tiling is checked against
 *  (`localFogTiled`); for a program that binds none, no word, so that the view is not tiled for it. */
export const fogTilesWgsl = (b: { group: number; tiles?: number }): WgslDecl =>
  wgslBlock(
    `fogTilesWgsl(${b.group}, ${b.tiles})`,
    [],
    b.tiles === undefined
      ? `
fn localFogTileWord(i:u32)->u32{return 0u;}
fn localFogTileWords()->u32{return 0u;}`
      : `
@group(${b.group}) @binding(${b.tiles}) var<storage,read> localFogTiles:array<u32>;
fn localFogTileWord(i:u32)->u32{return localFogTiles[i];}
fn localFogTileWords()->u32{return arrayLength(&localFogTiles);}`,
  )

/**
 * THE LISTS OF THE VOLUMES OVER EACH TILE OF THE SCREEN, as the programs that lay the volumes read them
 * (`localCullWgsl.ts` writes them): the list of a tile is a count, then the numbers of its volumes,
 * four to a word, in the order they are drawn, from the word `localFogListAt` finds it at. A program
 * that has a pixel finds its tile by the pixel (`localFogListAt`, the tile it lies in, the last row and
 * column taking what lies past them); the fog's cells have none, and find it by the screen place of
 * their centre (`localFogListOver`, the view's rows of the block). The walk is
 * `localFogListCount(list)` volumes, volume `localFogListVolume(list, k)` the `k`th. A view that is not
 * tiled — no culling pass this image, or lists in a buffer too small for its tiles (the program
 * binds none, or a stand-in) — walks every volume of the view (`LOCAL_FOG_NO_LIST`). The program
 * declares the lists as `localFogTileWord(i)`, and the words it holds as `localFogTileWords()`
 * (`fogResourcesWgsl`).
 */
const FOG_LOCAL_LIST_WGSL = wgslBlock(
  'FOG_LOCAL_LIST_WGSL',
  [FOG_LOCAL_DATA_WGSL],
  `
/** The list a program is given where the view is not tiled: the view's own. */
const LOCAL_FOG_NO_LIST:u32=4294967295u;
/** Whether the lists are made for this image and the program holds them. */
fn localFogTiled()->bool{
 return ${localFogBlock(LOCAL_FOG_SLOT.tiling)}.y>=1.0&&localFogTileWords()>=u32(${localFogBlock(LOCAL_FOG_SLOT.screen)}.w);
}
/** The list of the tile that holds the pixel \`pixel\`, in pixels of the view. */
fn localFogListAt(pixel:vec2f)->u32{
 if(!localFogTiled()){return LOCAL_FOG_NO_LIST;}
 let tiling=${localFogBlock(LOCAL_FOG_SLOT.tiling)};
 let tile=clamp(floor(pixel/tiling.x),vec2f(0.0),tiling.yz-1.0);
 return (u32(tile.y)*u32(tiling.y)+u32(tile.x))*u32(tiling.w);
}
/** The list of the tile that holds the point \`toward\`, relative to the eye, by its screen place: the view's
 *  rows (\`LOCAL_FOG_SLOT.projection\`) take it to the pixel it lies in. The view's own list where the point
 *  is not in front of the eye. */
fn localFogListOver(toward:vec3f)->u32{
 let p=vec4f(toward,1.0);
 let w=dot(${localFogBlock(LOCAL_FOG_SLOT.projection + 3)},p);
 if(w<=0.0){return LOCAL_FOG_NO_LIST;}
 let ndc=vec2f(dot(${localFogBlock(LOCAL_FOG_SLOT.projection)},p),dot(${localFogBlock(LOCAL_FOG_SLOT.projection + 1)},p))/w;
 return localFogListAt((vec2f(ndc.x,-ndc.y)*0.5+0.5)*${localFogBlock(LOCAL_FOG_SLOT.screen)}.xy);
}
/** How many volumes the list \`list\` holds: its tile's, or all the view's. */
fn localFogListCount(list:u32)->u32{
 if(list==LOCAL_FOG_NO_LIST){return localFogCount();}
 return localFogTileWord(list);
}
/** The number, among the view's volumes, of the \`k\`th of the list \`list\`: a byte of its words. */
fn localFogListVolume(list:u32,k:u32)->u32{
 if(list==LOCAL_FOG_NO_LIST){return k;}
 return (localFogTileWord(list+1u+(k>>2u))>>((k&3u)*8u))&255u;
}`,
)

/**
 * THE LOCAL FOG VOLUMES SEEN ALONG A RAY (`localFogOver`): the light they scatter toward the eye and what
 * they let of the light behind pass, over a point at `toward` from the eye — a surface, a layer, the
 * far depth of the sky. Each volume of the list of the tile of the pixel `pixel` the point is seen in
 * (`localFogListAt`; the view's, where it is not tiled), the farthest first, lays its own over those
 * before it (`light · kept + its light`); none where the view draws no volume.
 *
 * For one volume the ray is taken to the volume's unit space and cut: it starts at the sphere or at the
 * start distance, the larger of the volumes's own and the view's, and ends at the sphere's far side or
 * at the point, the nearer; where the fog's volume covers the near air — the scene's fog has one, built
 * this image, which the local volumes are voxelised into (`LOCAL_FOG_FLAG.inVolume`) —, the ray starts past
 * the volume's far end along it, what lies before is the volume's. The coverage of what remains is
 * the integral of the radial and the height laws along it (`localFogCoverage`), each as a transmittance, the
 * two combined by `1 − (1 − Tr)(1 − Th)`, the optical depth of that one carried to metres by the
 * radius. The light is the sun's by the phase function of the volume's distribution toward it, plus the sky
 * light's term along the ray reversed, times the albedo, plus the emissive light, times the coverage.
 */
export const FOG_LOCAL_OVER_WGSL = wgslBlock(
  'FOG_LOCAL_OVER_WGSL',
  [FOG_LOCAL_DATA_WGSL, FOG_LOCAL_LIST_WGSL, hgPhase],
  `
/** The least cosine of the height axis a ray is divided by. */
const LOCAL_FOG_SAFE_DIRECTION:f32=0.0001;
/** The coverage — one minus the transmittance — of the volume \`f\` along the ray from \`start\`, in its unit
 *  space, along the unit \`dir\` for \`run\`: the radial law's integral — the sphere's density \`1 − d²\` in
 *  closed form, three quarters of it, so that a ray through the centre takes the extinction itself —,
 *  the height law's — \`height · e^(−falloff · (h − offset))\` along the ray, the exponent of its start held
 *  above −80 —, combined. */
fn localFogCoverage(f:LocalFog,start:vec3f,dir:vec3f,run:f32)->f32{
 var radial=0.0;
 var height=0.0;
 if(f.radial>0.0){
  let b=dot(dir,start);
  let c=dot(start,start)-1.0;
  var h=b*b-c;
  if(h>=0.0){
   h=sqrt(h);
   let first=max(-b-h,0.0);
   let last=min(max(-b+h,0.0),run);
   let firstSquare=first*first;
   let lastSquare=last*last;
   let integral0=-(c*first+b*firstSquare+firstSquare*first/3.0);
   let integral1=-(c*last+b*lastSquare+lastSquare*last/3.0);
   radial=max(0.0,f.radial*(integral1-integral0)*(3.0/4.0));
  }
 }
 if(f.height>0.0){
  let rise=dot(dir,f.axis);
  let lean=select(-1.0,1.0,rise>=0.0);
  let safe=select(rise,LOCAL_FOG_SAFE_DIRECTION*lean,abs(rise)<LOCAL_FOG_SAFE_DIRECTION);
  let low=max(-80.0,(dot(start,f.axis)-f.offset)*f.falloff);
  let along=safe*run*f.falloff;
  height=(f.height/(f.falloff*safe))*(exp(-low)-exp(-(low+along)));
 }
 let kept=1.0-(1.0-exp(-radial))*(1.0-exp(-height));
 return 1.0-exp(log(kept)*f.radius);
}
/** What the volume \`f\` scatters toward the eye, of a coverage \`coverage\`, along \`dir\`, the unit vector
 *  from the eye: the sun's light by the phase function, the sky light's rows along the ray times the
 *  distribution, times the albedo, plus the emissive light, times the coverage. */
fn localFogLight(f:LocalFog,coverage:f32,dir:vec3f)->vec3f{
 var light=${localFogBlock(LOCAL_FOG_SLOT.sunLight)}.rgb*hgPhase(-f.phase,dot(dir,${localFogBlock(LOCAL_FOG_SLOT.sunDirection)}.xyz));
 let v=-f.phase*dir;
 let sky0=${localFogBlock(LOCAL_FOG_SLOT.sky)};
 let sky1=${localFogBlock(LOCAL_FOG_SLOT.sky + 1)};
 let sky2=${localFogBlock(LOCAL_FOG_SLOT.sky + 2)};
 light+=max(vec3f(dot(sky0.xyz,v)+sky0.w,dot(sky1.xyz,v)+sky1.w,dot(sky2.xyz,v)+sky2.w),vec3f(0.0));
 return (light*f.albedo+f.emissive)*coverage;
}
/** The volume \`f\` along the ray \`dir\` (unit, from the eye) to the point \`toward\` (from the eye): its light and
 *  its transmittance. \`excluded\` is how far along the ray the fog's volume covers the near air, 0 for none. */
fn localFogInstance(f:LocalFog,toward:vec3f,dir:vec3f,excluded:f32)->vec4f{
 let inverse=1.0/f.radius;
 let depthPoint=(toward-f.centre)*inverse;
 let origin=-f.centre*inverse;
 let b=2.0*dot(dir,origin);
 let c=dot(origin,origin)-1.0;
 let discriminant=b*b-4.0*c;
 var span=vec2f(-1.0);
 if(discriminant>=0.0){
  let root=sqrt(discriminant);
  span=(-b+vec2f(-root,root))*0.5;
 }
 span=max(vec2f(max(localFogStart(),f.start)*inverse),span);
 span=min(span,vec2f(length(depthPoint-origin)));
 var light=vec3f(0.0);
 var kept=1.0;
 if(any(span>vec2f(0.0))){
  span=max(span,vec2f(excluded*inverse));
  let reach=max(0.0,abs(span.y-span.x));
  if(reach>0.0){
   let coverage=localFogCoverage(f,origin+dir*span.x,dir,reach);
   light=localFogLight(f,coverage,dir);
   kept=1.0-coverage;
  }
 }
 return vec4f(light,kept);
}
/** The local fog volumes of the list \`list\` (\`localFogListAt\`, \`localFogListOver\`) over the point \`toward\` from
 *  the eye: their light and what they let of the light behind pass, the farthest laid first.
 *  \`fogVolumeExclude\` (the program's own) says how far the fog's volume covers the ray, where the volumes
 *  are voxelised into it. */
fn localFogOverList(toward:vec3f,list:u32)->vec4f{
 let none=vec4f(0.0,0.0,0.0,1.0);
 let reach=length(toward);
 if(localFogCount()==0u||reach<1e-6){return none;}
 let count=localFogListCount(list);
 if(count==0u){return none;}
 let dir=toward/reach;
 let excluded=select(0.0,fogVolumeExclude(toward),localFogFlagged(${LOCAL_FOG_FLAG.inVolume}u));
 var light=vec3f(0.0);
 var kept=1.0;
 for(var k=0u;k<count;k++){
  let seen=localFogInstance(localFogAt(localFogListVolume(list,k)),toward,dir,excluded);
  light=light*seen.a+seen.rgb;
  kept*=seen.a;
 }
 return vec4f(light,kept);
}
/** The local fog volumes over the point \`toward\`, seen in the pixel \`pixel\` of the view: the list of the tile
 *  the pixel lies in (\`localFogOverList\`). */
fn localFogOver(toward:vec3f,pixel:vec2f)->vec4f{return localFogOverList(toward,localFogListAt(pixel));}
/** The local fog volumes over the point \`toward\`, seen at its own screen place: the list of the tile it
 *  lies in, as a vertex finds it (\`localFogListOver\`); none where the view holds no volume. */
fn localFogOverVertex(toward:vec3f)->vec4f{
 // No volume in the view: nothing to find the tile of, the projection is not worked out.
 if(localFogCount()==0u){return vec4f(0.0,0.0,0.0,1.0);}
 return localFogOverList(toward,localFogListOver(toward));
}`,
)

/**
 * THE LOCAL FOG VOLUMES IN THE FOG'S VOLUME (`localFogMedium`): what the volumes add to the medium of the
 * cell at `position` (relative to the eye), a cell whose front is `distanceFront` from the eye and
 * back `distanceBack`, over the volumes of the list of the tile its centre lies in (`localFogListOver`).
 * Nothing before the cell's back passes the view's start distance. A volume adds
 * what its radial and its height law give at the cell's centre — `radial · fade^0.82` for the sphere's
 * fade `1 − d` toward its surface, and `height · e^(−falloff · (h − offset))` — nothing outside the
 * sphere, the two combined as a coverage (`−log(Ta + Tb − Ta · Tb)`, optical depth being linear in
 * extinction), held to the most a cell takes (`LOCAL_FOG_SLOT.header`, lane 2); a cell the volume's
 * start distance cuts takes the share past it, a fraction of its depth. The volume's extinction
 * adds to the cell's, its albedo's share to the scattering, its emissive light as much as the extinction
 * to the glow.
 */
export const FOG_LOCAL_MEDIUM_WGSL = wgslBlock(
  'FOG_LOCAL_MEDIUM_WGSL',
  [FOG_LOCAL_DATA_WGSL, FOG_LOCAL_LIST_WGSL],
  `
struct LocalFogMedium{scattering:vec3f,extinction:f32,emissive:vec3f,}
fn localFogMedium(position:vec3f,distanceBack:f32,distanceFront:f32)->LocalFogMedium{
 var medium=LocalFogMedium(vec3f(0.0),0.0,vec3f(0.0));
 let viewStart=localFogStart();
 if(distanceBack<=viewStart){return medium;}
 let list=localFogListOver(position);
 let count=localFogListCount(list);
 for(var k=0u;k<count;k++){
  let f=localFogAt(localFogListVolume(list,k));
  let start=max(viewStart,f.start);
  if(distanceBack<start){continue;}
  var soft=1.0;
  if(distanceFront<start&&start<distanceBack){soft=(distanceBack-start)/max(0.0001,distanceBack-distanceFront);}
  let unitPoint=(position-f.centre)/f.radius;
  let fade=saturate(1.0-length(unitPoint));
  if(fade<=0.0){continue;}
  let heightExtinction=f.height*exp(-f.falloff*(dot(unitPoint,f.axis)-f.offset));
  let radialExtinction=f.radial*pow(fade,0.82);
  let a=exp(-heightExtinction);
  let b=exp(-radialExtinction);
  var extinction=max(0.0,-log(a-a*b+b));
  extinction=min(${localFogBlock(LOCAL_FOG_SLOT.header)}.z,extinction)*soft;
  medium.scattering+=extinction*f.albedo;
  medium.extinction+=extinction;
  medium.emissive+=extinction*f.emissive;
 }
 return medium;
}`,
)
