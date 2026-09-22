/**
 * Nelder–Mead (1965, "A simplex method for function minimization") on three parameters from
 * `start`, the first simplex `step` wide, until the simplex's values agree to the float
 * resolution of the smallest, or two hundred steps: the minimum it found.
 */
export function minimise(f: (p: number[]) => number, start: number[], step: number) {
  let simplex = [start, ...start.map((_, k) => start.map((s, i) => (i === k ? s + step : s)))];
  let values = simplex.map(f);
  for (let iteration = 0; iteration < 200; iteration++) {
    const order = values.map((_, i) => i).sort((a, b) => values[a] - values[b]);
    simplex = order.map((i) => simplex[i]);
    values = order.map((i) => values[i]);
    if (values[3] - values[0] <= 1e-7 * Math.abs(values[0])) break;
    const centre = [0, 1, 2].map((k) => (simplex[0][k] + simplex[1][k] + simplex[2][k]) / 3);
    const toward = (s: number) => centre.map((c, k) => c + s * (simplex[3][k] - c));
    const reflected = toward(-1),
      r = f(reflected);
    if (r < values[0]) {
      const expanded = toward(-2),
        e = f(expanded);
      [simplex[3], values[3]] = e < r ? [expanded, e] : [reflected, r];
    } else if (r < values[2]) [simplex[3], values[3]] = [reflected, r];
    else {
      const contracted = toward(0.5),
        c = f(contracted);
      if (c < values[3]) [simplex[3], values[3]] = [contracted, c];
      else
        for (let i = 1; i < 4; i++) {
          simplex[i] = simplex[i].map((s, k) => simplex[0][k] + 0.5 * (s - simplex[0][k]));
          values[i] = f(simplex[i]);
        }
    }
  }
  return simplex[0];
}
