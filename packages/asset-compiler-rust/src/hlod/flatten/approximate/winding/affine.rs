//! The transforms the scene's instances are read through: an object's placement — its matrix —,
//! and that placement with its scale taken out, the one a thin part's scaled copy is placed by;
//! each applied to points, and inverted to bring the scene's points into a mesh's own space.
use crate::compiler::source::node_transform::Mat4;
use trillion3d_math::matrix::linear::{determinant_by_first_row, linear_columns};
use trillion3d_math::vector::vec3::cross;
use trillion3d_math::vector::vecn::{dot, length};

/// A point's map `rows · p + shift`: its linear part row by row, then its translation.
#[derive(Clone, Copy)]
pub(crate) struct Affine {
    pub rows: [[f64; 3]; 3],
    pub shift: [f64; 3],
}

impl Affine {
    /// The map of `columns`, the images of the three axes, and `shift`.
    fn of(columns: [[f64; 3]; 3], shift: [f64; 3]) -> Self {
        Self {
            rows: std::array::from_fn(|r| std::array::from_fn(|c| columns[c][r])),
            shift,
        }
    }

    /// The placement of `matrix`, column-major.
    pub(crate) fn placing(matrix: &Mat4) -> Self {
        Self::of(linear_columns(matrix), [matrix[12], matrix[13], matrix[14]])
    }

    /// `matrix`'s scale and the placement left once it is taken out: the scale its columns'
    /// lengths, the first one carrying the sign of its determinant — the turn left a rotation
    /// wherever the matrix mirrors —, and the matrix with each column divided by its scale.
    pub(crate) fn unscaled(matrix: &Mat4) -> ([f64; 3], Self) {
        let columns = linear_columns(matrix);
        let sign = determinant_by_first_row(matrix).signum();
        let scale: [f64; 3] =
            std::array::from_fn(|k| length(columns[k]) * if k == 0 { sign } else { 1.0 });
        let turned = std::array::from_fn(|k| columns[k].map(|x| x / scale[k]));
        (
            scale,
            Self::of(turned, [matrix[12], matrix[13], matrix[14]]),
        )
    }

    /// `p` mapped.
    pub(crate) fn apply(&self, p: [f64; 3]) -> [f64; 3] {
        std::array::from_fn(|r| dot(self.rows[r], p) + self.shift[r])
    }

    /// The inverse map: its linear part's rows the cross products of the columns over the
    /// determinant, its shift the translation brought back.
    pub(crate) fn inverse(&self) -> Self {
        let columns: [[f64; 3]; 3] = std::array::from_fn(|c| self.rows.map(|row| row[c]));
        let [c0, c1, c2] = columns;
        let det = dot(c0, cross(c1, c2));
        let rows = [cross(c1, c2), cross(c2, c0), cross(c0, c1)].map(|r| r.map(|x| x / det));
        let shift = std::array::from_fn(|r| -dot(rows[r], self.shift));
        Self { rows, shift }
    }
}
