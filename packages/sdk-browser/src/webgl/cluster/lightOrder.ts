import { WEBGL_RECT_KIND } from './rectGlsl.ts';

/** A direct light as its order reads it: its kind, and whether it casts a shadow. */
type OrderedLight = {
  isDirectionalLight?: boolean;
  isPointLight?: boolean;
  isSpotLight?: boolean;
  castShadow?: boolean;
};

/** A light's rank in the program's `lightData`; an ambient light is summed apart. */
const kindOf = (light: OrderedLight) =>
  light.isDirectionalLight ? 0 : light.isPointLight ? 1 : light.isSpotLight ? 2 : WEBGL_RECT_KIND;
const KIND_ORDER = [1, 2, 0, WEBGL_RECT_KIND];
const SHADOW_CASTERS_FIRST = [true, false];

/**
 * Visits the direct lights in the order the reference files them: the points, the spots, the
 * suns, the rectangles, and within a kind the ones that cast a shadow first, each group in the
 * graph's order — the stable sort the reference applies before it files the lights by kind.
 * Nothing is allocated: the program uploads its lights every frame.
 */
export function inReferenceOrder<T extends OrderedLight>(
  lights: readonly T[],
  visit: (light: T, kind: number) => void,
) {
  for (const rank of KIND_ORDER)
    for (const shadowed of SHADOW_CASTERS_FIRST)
      for (const light of lights)
        if (kindOf(light) === rank && !!light.castShadow === shadowed) visit(light, rank);
}
