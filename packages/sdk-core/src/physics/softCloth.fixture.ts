import { fromArrays } from '../world/geometry/builder.ts';

/** The compiler's golden cloth (`physics_cook/soft_tests.rs`): 1 m of 2 × 2 squares in the xy
 *  plane, its vertices row by row from (−0.5, −0.5). */
export const goldenCloth = () =>
  fromArrays(
    Array.from({ length: 9 }, (_, v) => [
      (v % 3) * 0.5 - 0.5,
      Math.floor(v / 3) * 0.5 - 0.5,
      0,
    ]).flat(),
    [],
    [],
    [0, 1, 3, 4].flatMap((a) => [a, a + 1, a + 4, a, a + 4, a + 3]),
  );
