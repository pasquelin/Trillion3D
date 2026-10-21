//! The scene root of every driver whose format is not glTF's frame: the file's unit into metres,
//! then its up axis onto glTF's `Y`.

/// The name of the scene-root node that carries that matrix, whatever the format.
pub(super) const ROOT_NAME: &str = "root";

/// The centimetre, the implicit unit of the formats that declare a unit and default it (a USD
/// layer, a Maya scene): reading such a file as metres enlarges it a hundredfold.
pub(super) const CENTIMETRE: f64 = 0.01;

/// Scene-root matrix, column-major: a scale of `meters_per_unit`, and for a `Z`-up file the
/// −90° turn about `X` that sends `(x, y, z)` to `(x, z, −y)`, written exactly — its zeros are
/// zeros, not the rounding of a cosine.
pub(super) fn root(meters_per_unit: f64, z_up: bool) -> [f64; 16] {
    let s = meters_per_unit;
    match z_up {
        true => [
            s, 0.0, 0.0, 0.0, 0.0, 0.0, -s, 0.0, 0.0, s, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0,
        ],
        false => [
            s, 0.0, 0.0, 0.0, 0.0, s, 0.0, 0.0, 0.0, 0.0, s, 0.0, 0.0, 0.0, 0.0, 1.0,
        ],
    }
}

/// A node's local matrix as glTF writes it: `None` for the identity, which a node omits, and for
/// a matrix with a NaN or infinite component, which no node can carry — reported once.
pub(super) fn node_matrix(
    matrix: [f64; 16],
    report: &mut crate::plugins::scene::convert::Report,
) -> Option<[f64; 16]> {
    if !matrix.iter().all(|value| value.is_finite()) {
        report.add(super::codes::TRANSFORM_INVALID);
        return None;
    }
    (matrix != trillion3d_math::matrix::IDENTITY).then_some(matrix)
}

#[cfg(test)]
mod tests {
    use super::*;
    use trillion3d_math::matrix::{translation, IDENTITY};

    #[test]
    fn node_matrix_omits_the_identity_and_reports_a_non_finite_matrix() {
        let mut report = crate::plugins::scene::convert::Report::default();
        assert_eq!(node_matrix(IDENTITY, &mut report), None);
        let moved = translation([0.0, 1.0, 0.0]);
        assert_eq!(node_matrix(moved, &mut report), Some(moved));
        assert!(report.unsupported.is_empty());
        let mut broken = moved;
        broken[5] = f64::NAN;
        assert_eq!(node_matrix(broken, &mut report), None);
        broken[5] = f64::INFINITY;
        assert_eq!(node_matrix(broken, &mut report), None);
        assert_eq!(
            report.unsupported[super::super::codes::TRANSFORM_INVALID],
            2
        );
    }
}
