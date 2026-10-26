import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { WORKGROUP_THREADS } from '../../../gpu/dispatch/grid.ts'
import { lightingCommonWgsl, lightingLayersWgsl, surfaceTexelWgsl } from './commonWgsl.ts'
import { ARGS_WRITER_WGSL } from './contextWgsl.ts'
import { radiosityCommonWgsl } from './radiosityCommonWgsl.ts'

/**
 * THE RADIOSITY'S TILES: from the indirect update's list of card tiles (`contextWgsl.ts`), a thread a card tile — dispatched
 * for the list's capacity, a thread past the list's end leaving — lists the radiosity tiles the probes of the tile make — a probe at a texel that holds a surface, where the spacing is 4 or
 * more, whose jittered texel is looked at; else the card tile itself — and `radiosityArgs` writes the dispatches that work them,
 * a thread a ray (`ARGS_TRACES`: the trace, the filter) and a thread a probe (`ARGS_PROBES`: the harmonics). A tile past the
 * list's capacity is counted and not kept.
 *
 * Bindings: 0 the parameters, 1 the tables, 2 the context (written), 3 and 4 the depth and normal layers, 5 the blue noise.
 */

export const RADIOSITY_BUILD_BINDINGS = {
  tables: 1,
  context: 2,
  depth: 3,
  normal: 4,
  noise: 5,
} as const

export const RADIOSITY_BUILD_ENTRIES = ['radiosityTiles', 'radiosityArgs'] as const

export const RADIOSITY_BUILD_WGSL = wgslProgram(
  `fn addRadTile(word:u32){
 let at=atomicAdd(&ctx[CTX_RADIOSITY_TILES],1u);
 if(at<lp.radiosityTiles){atomicStore(&ctx[lp.radiosityAt+at],word);}
}
@compute @workgroup_size(${WORKGROUP_THREADS})
fn radiosityTiles(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let tile=id.x+id.y*n.x*${WORKGROUP_THREADS}u;
 if(tile>=ctxListed(LG_LIST_INDIRECT)){return;}
 let packed=ctxTile(LG_LIST_INDIRECT,tile);
 let page=tilePage(packed);
 let tileCoord=tileCoordOf(packed);
 if(radTileProbes()!=1u){addRadTile(packRadTile(page,tileCoord));return;}
 let probes=cardTileProbes();
 let jitter=pageJitter(page);
 for(var y=0u;y<probes;y++){
  for(var x=0u;x<probes;x++){
   let probe=vec2u(x,y);
   if(radTexel(page,tileCoord*LG_TILE+probe*lp.spacing+jitter).valid){addRadTile(packRadTile(page,tileCoord*probes+probe));}
  }
 }
}
@compute @workgroup_size(1)
fn radiosityArgs(){
 let probes=radTileCount()*radTileProbes()*radTileProbes();
 setArgs(ARGS_TRACES,groupGrid(ceilDiv(probes*lp.hemisphere*lp.hemisphere,${WORKGROUP_THREADS}u)));
 setArgs(ARGS_PROBES,groupGrid(ceilDiv(probes,${WORKGROUP_THREADS}u)));
}`,
  [
    lightingCommonWgsl({
      tables: RADIOSITY_BUILD_BINDINGS.tables,
      context: { binding: RADIOSITY_BUILD_BINDINGS.context, access: 'atomic' },
    }),
    surfaceTexelWgsl(
      lightingLayersWgsl(RADIOSITY_BUILD_BINDINGS.depth, RADIOSITY_BUILD_BINDINGS.normal),
    ),
    radiosityCommonWgsl(RADIOSITY_BUILD_BINDINGS.noise),
    ARGS_WRITER_WGSL,
  ],
)
