type V = number[];

/** The shadow read's WGSL structs as `shaderRun` builds them: the demand's and the shading's
 *  lamp lookups (`lampReadAt`, `lampFacePoint`) return these. */
export const SHADOW_READ_STRUCTS = {
  ShadowAt: (map: object, t: V, home: V, Q: V, texel: number) => ({ map, t, home, Q, texel }),
  LampFacePoint: (clip: V, ndc: V, t: V) => ({ clip, ndc, t }),
  LampAt: (at: object, clip: V, ndc: V, face: number, side: number, inside: boolean) => ({
    ...{ at, clip, ndc },
    ...{ face, side, inside },
  }),
  ShadowMap: (base: number, ring: number, pages: number, ox: number, oy: number) => ({
    ...{ base, ring, pages },
    ...{ ox, oy },
  }),
};
