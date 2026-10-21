//! The packing's 4×4 transforms, row-vector convention, in single precision with the reference
//! math library's roundings.
//!
//! - Sine and cosine: the angle reduced to `[−π, π]` by the nearest whole turn (rounded half away
//!   from zero), then folded into `[−π/2, π/2]`; the sine by an 11-degree and the cosine by a
//!   10-degree minimax polynomial, each evaluated by Horner's rule.
//! - A product's row `r` is `(r.x·B₀ + r.z·B₂) + (r.y·B₁ + r.w·B₃)`, each product rounded.
//! - A plane point `(x, y)` maps to `(y·M₁ + M₃) + x·M₀`, divided by its `w`.

/// π, 2π, 1/(2π) and π/2 in single precision.
pub(super) const PI: f32 = 3.141_592_654;
const TWO_PI: f32 = 6.283_185_307;
const ONE_OVER_TWO_PI: f32 = 0.159_154_943;
const HALF_PI: f32 = 1.570_796_327;

/// The sine and cosine of `angle`.
fn sin_cos(angle: f32) -> (f32, f32) {
    let mut quotient = ONE_OVER_TWO_PI * angle;
    quotient = if angle >= 0.0 {
        (quotient + 0.5) as i32 as f32
    } else {
        (quotient - 0.5) as i32 as f32
    };
    let mut y = angle - TWO_PI * quotient;
    let sign = if y > HALF_PI {
        y = PI - y;
        -1.0
    } else if y < -HALF_PI {
        y = -PI - y;
        -1.0
    } else {
        1.0
    };
    let y2 = y * y;
    let sin = (((((-2.388_985_9e-8 * y2 + 2.752_556_2e-6) * y2 - 0.000_198_408_74) * y2
        + 0.008_333_331)
        * y2
        - 0.166_666_67)
        * y2
        + 1.0)
        * y;
    let p = ((((-2.605_161_5e-7 * y2 + 2.476_049_5e-5) * y2 - 0.001_388_837_8) * y2
        + 0.041_666_638)
        * y2
        - 0.5)
        * y2
        + 1.0;
    (sin, sign * p)
}

#[derive(Clone, Copy)]
pub(super) struct Matrix(pub [[f32; 4]; 4]);

impl Matrix {
    pub(super) fn identity() -> Matrix {
        Matrix([
            [1.0, 0.0, 0.0, 0.0],
            [0.0, 1.0, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ])
    }

    /// The turn by `angle` about the z axis.
    pub(super) fn rotation(angle: f32) -> Matrix {
        let (sin, cos) = sin_cos(angle);
        Matrix([
            [cos, sin, 0.0, 0.0],
            [-sin, cos, 0.0, 0.0],
            [0.0, 0.0, 1.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ])
    }

    /// The move by `(x, y)`.
    pub(super) fn translation(x: f32, y: f32) -> Matrix {
        let mut m = Matrix::identity();
        m.0[3] = [x, y, 0.0, 1.0];
        m
    }

    /// The scaling by `(x, y)` in the plane, flattening z.
    pub(super) fn scaling(x: f32, y: f32) -> Matrix {
        Matrix([
            [x, 0.0, 0.0, 0.0],
            [0.0, y, 0.0, 0.0],
            [0.0, 0.0, 0.0, 0.0],
            [0.0, 0.0, 0.0, 1.0],
        ])
    }

    /// `self · other`.
    pub(super) fn then(&self, other: &Matrix) -> Matrix {
        let b = &other.0;
        Matrix(self.0.map(|[x, y, z, w]| {
            std::array::from_fn(|j| (x * b[0][j] + z * b[2][j]) + (y * b[1][j] + w * b[3][j]))
        }))
    }

    /// The plane point `p` through the transform.
    pub(super) fn apply(&self, [x, y]: [f32; 2]) -> [f32; 2] {
        let m = &self.0;
        let r: [f32; 4] = std::array::from_fn(|j| (y * m[1][j] + m[3][j]) + x * m[0][j]);
        [r[0] / r[3], r[1] / r[3]]
    }
}
