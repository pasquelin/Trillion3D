import { wgslBlock, type WgslDecl } from '../../../../../math/src/wgsl/decl.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { hammersley16 } from '../../../../../math/src/wgsl/sampling.ts'
import { PI, TWO_PI } from '../../../../../math/src/wgsl/constants.ts'
import { fastAtan2, sinFromCosUnclamped } from '../../../../../math/src/wgsl/geometry.ts'
import { PAGE_SIZE } from '../../../../../sdk-core/src/lighting/surfaceCache/cardResolution.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { TV_SH_WGSL } from '../../translucency/frameWgsl.ts'
import { PAGE_LIGHTING } from './layout.ts'

/**
 * WHAT THE RADIOSITY'S KERNELS SHARE: how its work is cut, the probes, the rays, the texels the probes lie at.
 *
 * THE PROBES. A probe lies every `spacing` texels of a card, a texel of the page it falls in, jittered inside its cell
 * by the page's image of the pattern (`probeJitter`: a Hammersley point of the pattern's `maxFrames`, scrambled by two
 * fixed words, times the spacing, or the fixed index where one is set); each traces `hemisphere` × `hemisphere` rays over
 * its texel's hemisphere (`radiosityRay`: the cell of the ray jittered by the probe's blue noise at its page's image or the
 * fixed index, the uniform mapping of the hemisphere, turned to the texel's normal by the Frisvad basis). A RADIOSITY TILE is
 * the unit the probes are listed in: one probe where the spacing is 4 or more — its tile the probe's, in probes —, else the whole
 * 8 × 8 tile of its page. Its place is a word: the page in 22 bits and the tile along x and y in 5 each. The tiles are
 * `radiosityAt` in the context; a kernel that works a trace or a probe a thread finds the tile, the probe in it and the ray
 * by `unswizzle`, the probes of a tile in rows, the rays of a probe in rows after them.
 *
 * A TEXEL of a probe or of the page it lies in (`radTexel`) is a texel of a page that may lie off its edge (`inside`),
 * hold a surface (`valid`), with its place and normal, the atlas texel it is, the page's temporal index and its place
 * on the card in texels (`cardCoord`, from the page's rectangle of the card and the tiles its mip spans), which seeds the noise.
 */

const CONSTANTS = wgslConsts({
  PHYSICAL_PAGE: PAGE_SIZE,
  PAGE_INDIRECT_LAST: PAGE_LIGHTING.lastUpdate + 1,
  PAGE_INDIRECT_TEMPORAL: PAGE_LIGHTING.temporal + 1,
  PAGE_MIP_FIRST: 1,
  PAGE_MIP_TILES_X: 14,
  PAGE_MIP_TILES_Y: 15,
})

const RADIOSITY_WGSL = wgslBlock(
  'RADIOSITY_WGSL',
  [TWO_PI, TV_SH_WGSL],
  `
fn radTileSize()->u32{return select(LG_TILE,lp.spacing,lp.spacing>=4u);}
fn radTileProbes()->u32{return radTileSize()/lp.spacing;}
fn cardTileProbes()->u32{return LG_TILE/lp.spacing;}
fn packRadTile(page:u32,tile:vec2u)->u32{return page|(tile.x<<22u)|(tile.y<<27u);}
fn radTilePage(word:u32)->u32{return word&0x3fffffu;}
fn radTileCoord(word:u32)->vec2u{return vec2u((word>>22u)&31u,(word>>27u)&31u);}
fn radTileAt(i:u32)->u32{return ctxW(lp.radiosityAt+i);}
fn radTileCount()->u32{return min(ctxW(CTX_RADIOSITY_TILES),lp.radiosityTiles);}
/** The index the jitter of a probe and of its rays is drawn at: the page's \`temporal\` one, or the setting's fixed one. */
fn jitterIndex(temporal:u32)->u32{return select(u32(lp.fixedJitter),temporal,lp.fixedJitter<0);}
fn probeJitter(temporal:u32)->vec2u{
 let index=jitterIndex(temporal)%lp.maxFrames;
 return vec2u(hammersley16(index,lp.maxFrames,vec2u(0x4ae4u,0x9bdbu))*f32(lp.spacing));
}
fn pageJitter(page:u32)->vec2u{return probeJitter(scPageW(page,PAGE_INDIRECT_TEMPORAL));}
/** Whether the page holds a lit probe: it is mapped and has been given radiosity. */
fn pageHasProbes(page:u32)->bool{return page<lp.pages&&scPageW(page,0u)!=0xffffffffu&&scPageW(page,PAGE_INDIRECT_LAST)!=0u;}
struct RadTexel{inside:bool,valid:bool,atlas:vec2u,position:vec3f,normal:vec3f,temporal:u32,cardCoord:vec2u}
fn radTexel(page:u32,coord:vec2u)->RadTexel{
 var r:RadTexel;
 r.inside=all(coord<pageSize(page));
 r.valid=false;
 r.atlas=vec2u(0u);
 r.position=vec3f(0.0);
 r.normal=vec3f(0.0,0.0,1.0);
 r.temporal=0u;
 r.cardCoord=vec2u(0u);
 if(!r.inside){return r;}
 let s=surfaceTexel(page,coord);
 r.valid=s.valid;
 r.atlas=s.atlas;
 r.position=s.position;
 r.normal=s.normal;
 r.temporal=scPageW(page,PAGE_INDIRECT_TEMPORAL);
 let tiles=vec2f(f32(scPageW(page,PAGE_MIP_TILES_X)),f32(scPageW(page,PAGE_MIP_TILES_Y)));
 r.cardCoord=vec2u(vec2f(scPageF(page,4u),scPageF(page,5u))*tiles*f32(LG_TILE)+vec2f(coord));
 return r;
}
/** The size, in probes, of the card of \`page\`'s mip. */
fn cardSizeInProbes(page:u32)->vec2u{return vec2u(scPageW(page,PAGE_MIP_TILES_X),scPageW(page,PAGE_MIP_TILES_Y))*cardTileProbes();}
/** The texel the probe \`probe\` of the card of \`page\`'s mip, a card \`sizeInProbes\` probes across, lies at, in the page of the mip
 *  that holds it: none (\`inside\` down) where that page holds no lit probe. */
fn cardProbeTexel(page:u32,sizeInProbes:vec2u,probe:vec2u)->RadTexel{
 let coordInCard=probe*lp.spacing;
 let pageCoord=coordInCard/vec2u(PHYSICAL_PAGE);
 let pagesAcross=(sizeInProbes*lp.spacing)/vec2u(PHYSICAL_PAGE);
 let neighbour=scPageW(page,PAGE_MIP_FIRST)+pageCoord.x+pageCoord.y*pagesAcross.x;
 if(!pageHasProbes(neighbour)){var none:RadTexel;return none;}
 return radTexel(neighbour,coordInCard-pageCoord*vec2u(PHYSICAL_PAGE)+pageJitter(neighbour));
}
/** The probe a texel of the atlas belongs to, in the probes' atlas. */
fn probeAtlasCoord(atlas:vec2u)->vec2u{return atlas>>vec2u(lp.spacingShift);}
/** Where the radiosity tile \`tile\` puts the probe \`probe\` of it, in the page, and the page it is of. */
struct ProbeAt{page:u32,coord:vec2u}
fn probeAt(tile:u32,probe:vec2u)->ProbeAt{
 let word=radTileAt(tile);
 let page=radTilePage(word);
 return ProbeAt(page,radTileCoord(word)*radTileSize()+probe*lp.spacing+pageJitter(page));
}
/** A trace thread's place: the radiosity tile, the probe in it and the ray of the probe. */
struct TraceAt{tile:u32,probe:vec2u,ray:vec2u}
fn unswizzle(i:u32)->TraceAt{
 let rays=lp.hemisphere*lp.hemisphere;
 let side=radTileProbes();
 let probeIndex=i/rays;
 let tile=probeIndex/(side*side);
 let inTile=probeIndex-tile*side*side;
 let ray=i-probeIndex*rays;
 return TraceAt(tile,vec2u(inTile%side,inTile/side),vec2u(ray%lp.hemisphere,ray/lp.hemisphere));
}
/** What a kernel that works a ray a thread starts from: the ray, its probe and the texel the probe lies at, and whether the
 *  thread has work — it is in the count of the traces and its texel lies inside its page; \`ok\` down, the rest is zero. */
struct RayThread{ok:bool,at:TraceAt,probe:ProbeAt,texel:RadTexel}
fn radRayThread(i:u32)->RayThread{
 var r:RayThread;
 let side=radTileProbes();
 if(i>=radTileCount()*side*side*lp.hemisphere*lp.hemisphere){return r;}
 r.at=unswizzle(i);
 r.probe=probeAt(r.at.tile,r.at.probe);
 r.texel=radTexel(r.probe.page,r.probe.coord);
 r.ok=r.texel.inside;
 return r;
}
fn tangentBasis(n:vec3f)->mat3x3f{
 if(n.z<-0.9999999){return mat3x3f(vec3f(0.0,-1.0,0.0),vec3f(-1.0,0.0,0.0),n);}
 let a=1.0/(1.0+n.z);
 let b=-n.x*n.y*a;
 return mat3x3f(vec3f(1.0-n.x*n.x*a,b,-n.x),vec3f(b,1.0-n.y*n.y*a,-n.y),n);
}
/** The weight of a probe at \`probe\` for a texel at \`position\` of normal \`normal\`: 1 where it lies near the texel's plane, 0 where it is off it
 *  by more than the depth scale allows (\`exp2(scale · (the distance off the plane over the distance between them)²) > 0.01\`). */
fn planeWeight(position:vec3f,normal:vec3f,probe:vec3f)->f32{
 let distance=abs(dot(position-probe,normal));
 let relative=max(distance/(length(probe-position)+0.01),0.1);
 return select(0.0,1.0,exp2(lp.planeDepthScale*relative*relative)>0.01);
}
`,
)

/** The radiosity's shared text. */
export const radiosityCommonWgsl = (): WgslDecl =>
  wgslBlock('RADIOSITY_COMMON_WGSL', [hammersley16, RADIOSITY_WGSL], CONSTANTS)

/** The rays of a probe, for the programs that draw them (`radiosityRay`); `noise` is the binding of the blue noise's mask. */
export const radiosityRayWgsl = (noise: number): WgslDecl =>
  wgslBlock(
    `RADIOSITY_RAY_WGSL(${noise})`,
    [TWO_PI, blueNoiseWgsl(0, noise), RADIOSITY_WGSL, sinFromCosUnclamped],
    `
/** The direction of ray \`ray\` of the probe \`probeCoord\` (its place on the card) of a texel of normal \`normal\`. */
fn radiosityRay(normal:vec3f,temporal:u32,probeCoord:vec2u,ray:vec2u)->vec3f{
 let uv=(vec2f(ray)+blueNoiseVec2(probeCoord,jitterIndex(temporal)))/f32(lp.hemisphere);
 let phi=TWO_PI*uv.x;
 let sine=sinFromCosUnclamped(uv.y);
 let b=tangentBasis(normal);
 return b[0]*(sine*cos(phi))+b[1]*(sine*sin(phi))+b[2]*uv.y;
}
`,
  )

/** The probes' occlusion, for a program that reads the distances the radiosity's rays met their surfaces at (`probeHitDistance`, at `binding`
 *  of group 0, one texel a ray, laid as the trace atlas is) and the visibility they give, beside the radiosity's shared text. */
export const radiosityProbeVisibilityWgsl = (binding: number): WgslDecl =>
  wgslBlock(
    `RADIOSITY_PROBE_VISIBILITY_WGSL(${binding})`,
    [PI, TWO_PI, fastAtan2],
    `@group(0) @binding(${binding}) var probeHitDistance:texture_2d<f32>;
// A texel no trace has written yet holds 0 (the rays went through the distance field until the scene's triangles were traced): it is
// read as a ray that met nothing within its reach, so a probe is not hidden before its first trace.
fn traceHitDistance(ray:vec2u)->f32{let d=textureLoad(probeHitDistance,vec2i(ray),0).x;return select(d,lp.maxTrace,d<=0.0);}
/** The visibility of the position \`tested\` from the probe \`probe\`: 1 where the surface the probe's ray met along the line to it lies beyond, 0 where
 *  it lies nearer by the distance between them, eased over the part of that distance the strength (\`lp.probeOcclusionStrength\`) leaves. The ray is the
 *  one the line falls on in the probe's hemisphere (the uniform mapping, as \`radiosityRay\` lays it), by the line's unit direction: its height
 *  above the probe's plane is the ray's cosine, as the rays are laid. */
fn probeVisibility(tested:vec3f,probe:RadTexel)->f32{
 let toTested=tested-probe.position;
 let distance2=dot(toTested,toTested);
 if(distance2<=0.01){return 1.0;}
 let distance=sqrt(distance2);
 let inProbe=toTested*tangentBasis(probe.normal)/distance;
 let uv=clamp(vec2f((fastAtan2(-inProbe.y,-inProbe.x)+PI)/TWO_PI,inProbe.z),vec2f(0.0),vec2f(0.99));
 let ray=vec2u((vec2f(probeAtlasCoord(probe.atlas))+uv)*f32(lp.hemisphere));
 return saturate((traceHitDistance(ray)-distance)/max((1.0-lp.probeOcclusionStrength)*distance,0.0001)+1.0);
}`,
  )
