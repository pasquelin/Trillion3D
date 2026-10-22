//! The normal distribution of a voxel fitted by an isotropic one: the sums of its hits' normal
//! products (`Moments::ndf`, `xx yy zz xy xz yz`) are the covariance of the normals; its
//! eigen-decomposition, by Jacobi's rotations, gives three scales, and the two most alike are the
//! distribution's width across its axis — the third eigenvector, which becomes the voxel's normal
//! — and the third's the width along it. The voxel keeps their ratio in one byte (`ratio`): 0 for a
//! mirror, one half for a sphere of normals, nearing 1 for a fibre.
use trillion3d_math::vector::vec3::normalized_or;

/// The relative size under which an off-diagonal entry counts as zero, and most sweeps a
/// decomposition makes.
const TOLERANCE: f64 = 1e-8;
const MAX_SWEEPS: usize = 20;

/// The symmetric matrix `a` (row-major) diagonalized by Jacobi's rotations: its eigenvalues, and
/// its eigenvectors as the columns of `vectors`, the `i`-th beside the `i`-th value.
fn eigen_solve(mut a: [f64; 9]) -> ([f64; 3], [f64; 9]) {
    let mut values = [a[0], a[4], a[8]];
    let mut vectors = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    let largest = |a: &[f64; 9]| a[1].abs().max(a[2].abs()).max(a[5].abs());
    let absolute = TOLERANCE * largest(&a);
    if absolute == 0.0 {
        return (values, vectors);
    }
    for _ in 0..MAX_SWEEPS {
        // The small changes of a sweep to the diagonal, added at its end: a sum of them held apart
        // does not lose them against a large entry.
        let mut z = [0.0; 3];
        let mut changed = false;
        for (j, k, l) in [(0, 1, 2), (0, 2, 1), (1, 2, 0)] {
            changed |= rotate(&mut a, &mut vectors, &mut z, (j, k, l));
        }
        for (i, value) in values.iter_mut().enumerate() {
            *value += z[i];
            a[3 * i + i] = *value;
        }
        if !changed || largest(&a) <= absolute {
            break;
        }
    }
    (values, vectors)
}

/// The rotation that zeroes entry `(j, k)` of `a` — `l` the third index — applied to `a`, to the
/// eigenvectors and to the sweep's changes `z`; whether it turned at all.
fn rotate(
    a: &mut [f64; 9],
    v: &mut [f64; 9],
    z: &mut [f64; 3],
    (j, k, l): (usize, usize, usize),
) -> bool {
    let (x, y, w) = (a[3 * j + j], a[3 * j + k], a[3 * k + k]);
    let (mu1, mu2) = (w - x, 2.0 * y);
    if mu2.abs() <= TOLERANCE * mu1.abs() {
        // Small enough beside the diagonal: set to zero, which errs less than leaving it.
        a[3 * j + k] = 0.0;
        return false;
    }
    let rho = mu1 / mu2;
    let t = (if rho < 0.0 { -1.0 } else { 1.0 }) / (rho.abs() + (1.0 + rho * rho).sqrt());
    let c = 1.0 / (1.0 + t * t).sqrt();
    let (s, tau, h) = (c * t, c * t / (1.0 + c), t * y);
    z[j] -= h;
    z[k] += h;
    a[3 * j + j] -= h;
    a[3 * k + k] += h;
    a[3 * j + k] = 0.0;
    let update = |m: &mut [f64; 9], d1: usize, d2: usize| {
        let (nu1, nu2) = (m[d1], m[d2]);
        m[d1] -= s * (nu2 + tau * nu1);
        m[d2] += s * (nu1 - tau * nu2);
    };
    let at = |a: usize, b: usize| if a < b { 3 * a + b } else { 3 * b + a };
    update(a, at(l, j), at(l, k));
    for i in 0..3 {
        update(v, 3 * i + j, 3 * i + k);
    }
    true
}

/// The isotropic fit of the normal distribution whose sums are `sums` (`xx yy zz xy xz yz`): its
/// axis — the unit eigenvector of the scale the other two most resemble — and its two widths,
/// across the axis and along it (the square roots of the eigenvalues: the mean of the two alike,
/// and the third).
///
/// Two scales both zero are alike: a distribution along one axis of the frame — a wall facing it
/// — has two eigenvalues of exactly zero, whose ratio is not a number, so the axis would be taken
/// from the first pair whatever it faces.
pub(super) fn fit_isotropic(sums: [f64; 6]) -> ([f64; 3], [f64; 2]) {
    let [xx, yy, zz, xy, xz, yz] = sums;
    let (values, vectors) = eigen_solve([xx, xy, xz, xy, yy, yz, xz, yz, zz]);
    let scale = values.map(|v| v.abs().sqrt());
    let alike = |k: usize| {
        let (a, b) = (scale[k], scale[(1 << k) & 3]);
        match a.max(b) == 0.0 {
            true => 1.0,
            false => a.min(b) / a.max(b),
        }
    };
    let mut best = 0;
    for k in 1..3 {
        if alike(best) < alike(k) {
            best = k;
        }
    }
    let (k0, k1) = (best, (1 << best) & 3);
    let k2 = (1 << k1) & 3;
    let axis = [vectors[k2], vectors[k2 + 3], vectors[k2 + 6]];
    (axis, [0.5 * (scale[k0] + scale[k1]), scale[k2]])
}

/// The ratio of the fit's two widths in `[0, 1]`: one half for equal widths, under it as the
/// widths across the axis fall short of the width along it — 0 for a mirror —, over it as they
/// outgrow it — nearing 1 for a fibre.
pub(super) fn ratio([across, along]: [f64; 2]) -> f64 {
    match across > along {
        true => 1.0 - 0.5 * along / across,
        false => 0.5 * across / along,
    }
}

/// The voxel's normal and its ratio byte's value from the sums of its hits' normal products: the
/// fit's axis and its widths' ratio.
pub(super) fn fitted(sums: [f64; 6]) -> ([f64; 3], f64) {
    let (axis, widths) = fit_isotropic(sums);
    (normalized_or(axis, [0.0, 0.0, 1.0]), ratio(widths))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The sums of the products of `normals`, a unit each.
    fn sums(normals: &[[f64; 3]]) -> [f64; 6] {
        let mut out = [0.0; 6];
        for [x, y, z] in normals {
            for (sum, p) in out
                .iter_mut()
                .zip([x * x, y * y, z * z, x * y, x * z, y * z])
            {
                *sum += p;
            }
        }
        out
    }

    // Behaviour: a distribution of one normal fits an axis along it and a ratio of 0 — a mirror —
    // whichever axis of the frame it faces: the zero scales of a wall facing x or y are alike (as
    // a 0 / 0 they would fall back to the first pair and answer z); a sphere of normals fits a
    // ratio of one half; a ring of normals around an axis fits a ratio over one half.
    #[test]
    fn the_fit_finds_the_axis_and_the_ratio_of_a_distribution() {
        for axis in [
            [1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
            [0.0, -1.0, 0.0],
        ] {
            let (found, ratio) = fitted(sums(&[axis, axis]));
            let along: f64 = (0..3).map(|k| found[k] * axis[k]).sum();
            assert!((along.abs() - 1.0).abs() < 1e-12, "{axis:?}: {found:?}");
            assert_eq!(ratio, 0.0, "{axis:?}");
        }
        let sphere = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
        assert!((fitted(sums(&sphere)).1 - 0.5).abs() < 1e-12);
        let ring = [
            [1.0, 0.0, 0.0],
            [-1.0, 0.0, 0.0],
            [0.0, 1.0, 0.0],
            [0.0, -1.0, 0.0],
        ];
        let (found, ratio) = fitted(sums(&ring));
        assert!(
            found[2].abs() > 1.0 - 1e-12 && ratio > 0.5,
            "{found:?} {ratio}"
        );
    }

    // Behaviour: the decomposition is the matrix's: each eigenvector is taken by the matrix to its
    // value times itself, to the tolerance the rotations stop at.
    #[test]
    fn the_eigen_solution_diagonalizes_the_matrix() {
        let a = [4.0, 1.0, 0.5, 1.0, 3.0, 0.25, 0.5, 0.25, 2.0];
        let (values, v) = eigen_solve(a);
        for i in 0..3 {
            let vec = [v[i], v[i + 3], v[i + 6]];
            for r in 0..3 {
                let row: f64 = (0..3).map(|c| a[3 * r + c] * vec[c]).sum();
                assert!((row - values[i] * vec[r]).abs() < 1e-6, "{i} {r}");
            }
        }
    }
}
