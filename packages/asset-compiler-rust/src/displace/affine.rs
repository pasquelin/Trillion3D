//! Affine arithmetic over the barycentric ranges of a sub-triangle: a quantity as a centre, an
//! error of its own (`k`) and two noise symbols (`e`), one for each of the two free barycentric
//! coordinates of the triangle, so that a quantity built from them out of sums and products keeps
//! the correlation between its parts and a bound that is tighter than interval arithmetic's. The
//! form of a real number (`Affine`) and of a three-vector (`AffineV`), both in single precision, as
//! the bounds of a displaced triangle's error are taken (`policy.rs`).
use trillion3d_math::vector::vecn::{add, dot, scale, sub};

/// The smallest squared length a normalised affine vector is held to, and the largest.
const LEAST_SQUARED: f32 = 1.0e-4;
const MOST_SQUARED: f32 = 1.0;

/// The absolute value of each axis.
fn abs3(v: [f32; 3]) -> [f32; 3] {
    v.map(f32::abs)
}

/// A real number as `c ± (k + |e₀| + |e₁|)`, the noise symbols `e` correlating it with the other
/// quantities of the same two coordinates.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Affine {
    c: f32,
    k: f32,
    e: [f32; 2],
}

impl Affine {
    /// The number `x` itself.
    pub(super) fn constant(x: f32) -> Self {
        Self {
            c: x,
            k: 0.0,
            e: [0.0; 2],
        }
    }

    /// Any number from `low` to `high`, its uncertainty correlated with nothing.
    pub(super) fn interval(low: f32, high: f32) -> Self {
        Self {
            c: 0.5 * (low + high),
            k: 0.5 * (high - low),
            e: [0.0; 2],
        }
    }

    /// A number from `low` to `high` that is the noise symbol `symbol` (0 or 1) itself: a
    /// barycentric coordinate over a sub-triangle.
    pub(super) fn symbol(low: f32, high: f32, symbol: usize) -> Self {
        let mut e = [0.0; 2];
        e[symbol] = 0.5 * (high - low);
        Self {
            c: 0.5 * (low + high),
            k: 0.0,
            e,
        }
    }

    /// `self − other`: the centres and the symbols subtract, the errors of their own add.
    pub(super) fn minus(self, other: Self) -> Self {
        Self {
            c: self.c - other.c,
            k: self.k + other.k,
            e: [self.e[0] - other.e[0], self.e[1] - other.e[1]],
        }
    }

    /// The least value the form reaches.
    pub(super) fn least(self) -> f32 {
        self.c - self.k.abs() - self.e[0].abs() - self.e[1].abs()
    }

    /// The most value the form reaches.
    pub(super) fn most(self) -> f32 {
        self.c + self.k.abs() + self.e[0].abs() + self.e[1].abs()
    }

    /// The form held within `[low, high]`: itself where it lies inside, the bound where it lies
    /// beyond it, else its Chebyshev approximation of the clamp.
    fn clamped(self, low: f32, high: f32) -> Self {
        let (least, most) = (self.least(), self.most());
        let (image_least, image_most) = (least.clamp(low, high), most.clamp(low, high));
        if low <= least && most <= high {
            return self;
        }
        if most <= low {
            return Self::constant(low);
        }
        if least >= high {
            return Self::constant(high);
        }
        let alpha = (image_most - image_least) / (most - least);
        let gamma = 0.5 * (1.0 - alpha) * (image_most + image_least);
        let delta = (1.0 - alpha) * image_most - gamma;
        Self {
            c: alpha * self.c + gamma,
            k: (alpha * self.k).abs() + delta,
            e: self.e.map(|e| alpha * e),
        }
    }

    /// The form's inverse square root, over the range it reaches held above 1e-4, by the
    /// approximation that touches the curve at the range's far end.
    fn inverse_root(self) -> Self {
        let least = self.least().max(1.0e-4);
        let most = self.most().max(1.0e-4);
        let image_least = 1.0 / least.sqrt();
        let image_most = 1.0 / most.sqrt();
        let alpha = -0.5 * image_most * image_most * image_most;
        let gamma = 0.5 * (image_least + image_most - alpha * (least + most));
        let delta = (0.5 * (image_least - image_most - alpha * (least - most))).abs();
        Self {
            c: alpha * self.c + gamma,
            k: (alpha * self.k).abs() + delta,
            e: self.e.map(|e| alpha * e),
        }
    }
}

/// A three-vector of affine forms sharing the same two noise symbols: the vector `c ± (k + Σ|eᵢ|)`
/// axis by axis.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct AffineV {
    c: [f32; 3],
    k: [f32; 3],
    e: [[f32; 3]; 2],
}

impl AffineV {
    /// The vector `v` itself.
    pub(super) fn constant(v: [f32; 3]) -> Self {
        Self {
            c: v,
            k: [0.0; 3],
            e: [[0.0; 3]; 2],
        }
    }

    /// `self · b`, `b` a form of a real number: each noise symbol meets the other's centre, and
    /// what is left of the products of the errors adds to the error of its own.
    pub(super) fn times(self, b: Affine) -> Self {
        let k = add(abs3(scale(self.k, b.c)), abs3(scale(self.c, b.k)));
        let mut own = self.k;
        let mut other = b.k;
        let mut e = [[0.0; 3]; 2];
        for ((slot, a), b_e) in e.iter_mut().zip(self.e).zip(b.e) {
            *slot = add(scale(a, b.c), scale(self.c, b_e));
            own = add(own, abs3(a));
            other += b_e.abs();
        }
        Self {
            c: scale(self.c, b.c),
            k: add(k, scale(own, other)),
            e,
        }
    }

    /// `self + other`: the three parts add.
    pub(super) fn plus(self, other: Self) -> Self {
        Self {
            c: add(self.c, other.c),
            k: add(self.k, other.k),
            e: [add(self.e[0], other.e[0]), add(self.e[1], other.e[1])],
        }
    }

    /// `self − other`: the centres and the symbols subtract, the errors of their own add.
    pub(super) fn minus(self, other: Self) -> Self {
        Self {
            c: sub(self.c, other.c),
            k: add(self.k, other.k),
            e: [sub(self.e[0], other.e[0]), sub(self.e[1], other.e[1])],
        }
    }

    /// The form of the squared length, which it bounds from above rather than equals.
    pub(super) fn squared_length(self) -> Affine {
        let mut extent = self.k;
        let mut e = [0.0; 2];
        for (slot, symbol) in e.iter_mut().zip(self.e) {
            extent = add(extent, abs3(symbol));
            *slot = 2.0 * dot(self.c, symbol);
        }
        let reach = 0.5 * dot(extent, extent);
        Affine {
            c: dot(self.c, self.c) + reach,
            k: 2.0 * dot(self.c, self.k).abs() + reach,
            e,
        }
    }

    /// The form made unit: itself times the inverse root of its squared length, held within 1e-4
    /// and 1.
    pub(super) fn normalized(self) -> Self {
        let held = self.squared_length().clamped(LEAST_SQUARED, MOST_SQUARED);
        self.times(held.inverse_root())
    }
}
