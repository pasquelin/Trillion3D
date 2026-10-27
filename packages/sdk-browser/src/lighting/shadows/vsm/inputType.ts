/**
 * WHERE A PASS OVER THE VIEW'S PIXELS READS THEM FROM, the reference's input type of its page marking and
 * its projection: the deferred buffers (`gbuffer`: the opaque surfaces' depth, normal and flags, a group a
 * tile of the view), or the hair strands (`strands`: the depth of the nearest strand, a group a tile of
 * the list of all the tiles with strands, `HairShadowSource`). The page marking (`markingWgsl.ts`) and
 * each pass of the projection (`projection/projectionWgsl.ts`) are one program of the input type: what
 * the type changes is how a pixel is found and when it is valid, which way its receiver faces, and the
 * gates a strand is spared — the back-face cull, the first-person rules and the screen ray.
 */
export type VsmInputType = 'gbuffer' | 'strands'
