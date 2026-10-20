//! The principal axes of a voxel's surface (`voxel::bricks`).

/// The orthonormal eigenvectors of the symmetric `m`, by cyclic Jacobi rotations.
pub(crate) fn symmetric_axes(mut m: [[f64; 3]; 3]) -> [[f64; 3]; 3] {
    let mut axes = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    for _ in 0..32 {
        let off = m[0][1].abs() + m[0][2].abs() + m[1][2].abs();
        if off <= f64::EPSILON * (m[0][0].abs() + m[1][1].abs() + m[2][2].abs()) {
            break;
        }
        for (p, q) in [(0, 1), (0, 2), (1, 2)] {
            if m[p][q] == 0.0 {
                continue;
            }
            let theta = (m[q][q] - m[p][p]) / (2.0 * m[p][q]);
            let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
            let (c, s) = (1.0 / (t * t + 1.0).sqrt(), t / (t * t + 1.0).sqrt());
            for k in 0..3 {
                let (a, b) = (m[k][p], m[k][q]);
                m[k][p] = c * a - s * b;
                m[k][q] = s * a + c * b;
            }
            for k in 0..3 {
                let (a, b) = (m[p][k], m[q][k]);
                m[p][k] = c * a - s * b;
                m[q][k] = s * a + c * b;
            }
            for axis in &mut axes {
                let (a, b) = (axis[p], axis[q]);
                axis[p] = c * a - s * b;
                axis[q] = s * a + c * b;
            }
        }
    }
    // Column j of the accumulated rotation is the j-th eigenvector.
    std::array::from_fn(|j| [axes[0][j], axes[1][j], axes[2][j]])
}
