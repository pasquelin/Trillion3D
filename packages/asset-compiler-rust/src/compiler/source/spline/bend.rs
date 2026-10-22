//! The bend of a spline mesh: where a vertex of the mesh lands on a cubic Hermite curve, and how its
//! normal and tangent turn with it, in single precision as the renderer bends them (the curve
//! itself, its position and its direction, from the maths crate's Hermite basis).
//!
//! A vertex's distance along the curve is its coordinate on the forward axis, fitted to [0, 1]
//! (`Fit`). The slice of the curve at that distance (`Bend::slice`) holds a position, the curve's
//! direction, the two axes across it (the up direction crossed with the direction, rolled about it)
//! and the scale across them; the vertex's other two coordinates, scaled, are laid along those axes
//! from the slice's position (`Bend::vertex`). A normal and a tangent take the slice's rotation, with
//! no scale: an axis whose scale is negative is turned over.
use trillion3d_math::scalar::{hermite, hermite_basis, hermite_slope_basis};
use trillion3d_math::vector::vec3::{cross, normalize_finite_f32};
use trillion3d_math::vector::vecn::{add, lerp, scale, sub};

pub(super) type V3 = [f32; 3];
pub(super) type V2 = [f32; 2];

/// What a spline mesh is bent by, every field the reference's (its spline parameters and its
/// component's own): the curve's two ends, the scale, roll and offset across it at each end, the
/// direction the curve's frame leans on, whether scale, roll and offset ease in and out, and the
/// mesh's forward axis — 0, 1 or 2 for x, y or z — with the range along it that maps to the curve.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Bend {
    pub start_pos: V3,
    pub start_tangent: V3,
    pub end_pos: V3,
    pub end_tangent: V3,
    pub start_scale: V2,
    pub end_scale: V2,
    pub start_roll: f32,
    pub end_roll: f32,
    pub start_offset: V2,
    pub end_offset: V2,
    pub up: V3,
    pub smooth: bool,
    pub axis: usize,
    pub boundary: (f32, f32),
}

/// The map from a vertex's coordinate on the forward axis to its distance along the curve:
/// `coordinate · scale + offset`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) struct Fit {
    pub scale: f32,
    pub offset: f32,
}

/// One slice of the curve: its position, direction, the two axes across it and the scale on them.
struct Slice {
    pos: V3,
    dir: V3,
    across: [V3; 2],
    sizes: V2,
}

/// A vertex after the bend: its position, and its normal and tangent if it had them.
pub(super) struct Bent {
    pub pos: V3,
    pub normal: Option<V3>,
    pub tangent: Option<V3>,
}

/// `a` made unit; NaN when it has no length, which the bend refuses by name.
fn unit(a: V3) -> V3 {
    normalize_finite_f32(a).unwrap_or([f32::NAN; 3])
}

/// `smoothstep(0, 1, x)`: `x` held within [0, 1], then `x² (3 − 2x)`.
fn smooth_step(x: f32) -> f32 {
    let x = x.clamp(0.0, 1.0);
    x * x * (3.0 - 2.0 * x)
}

/// How far two bounds of a custom range may lie apart and be one — the reference's small number,
/// 1e-8 —, in which case the mesh's own extent is the range.
const SAME_BOUND: f32 = 1e-8;

impl Bend {
    /// The fit of a mesh whose vertices span `low` to `high`: the extent the mesh has along the
    /// forward axis, or the range `boundary` names when its two ends lie apart; the identity for a
    /// mesh of no extent at all.
    pub fn fit(&self, (low, high): (V3, V3)) -> Fit {
        if (0..3).all(|c| high[c] - low[c] <= 0.0) {
            return Fit {
                scale: 1.0,
                offset: 0.0,
            };
        }
        let (first, last) = self.boundary;
        if (last - first).abs() <= SAME_BOUND {
            let span = high[self.axis] - low[self.axis];
            let inverse = if span <= 0.0 { 1.0 } else { 1.0 / span };
            Fit {
                scale: inverse,
                offset: -low[self.axis] * inverse,
            }
        } else {
            let inverse = 1.0 / (last - first);
            Fit {
                scale: inverse,
                offset: -first * inverse,
            }
        }
    }

    /// The curve's two ends and tangents, each axis taken to the basis `weights` — the position
    /// of the curve at one distance, or its slope.
    fn along(&self, weights: [f64; 4]) -> V3 {
        let ends = [
            self.start_pos,
            self.start_tangent,
            self.end_pos,
            self.end_tangent,
        ];
        core::array::from_fn(|c| {
            let values = ends.map(|end| f64::from(end[c]));
            hermite(weights, 1.0, values) as f32
        })
    }

    /// The curve's position at `a`.
    fn position(&self, a: f32) -> V3 {
        self.along(hermite_basis(f64::from(a)))
    }

    /// The curve's unit direction at `a`: its slope, normalized.
    fn direction(&self, a: f32) -> V3 {
        unit(self.along(hermite_slope_basis(f64::from(a))))
    }

    /// The slice at distance `a`: the curve's position and direction, the frame across it — the up
    /// direction crossed with the direction, then rolled about it — and the scale, roll and offset
    /// between the two ends, eased when the bend is smooth.
    fn slice(&self, a: f32) -> Slice {
        let ease = if self.smooth { smooth_step(a) } else { a };
        let roll = self.start_roll + (self.end_roll - self.start_roll) * ease;
        let offset = lerp(self.start_offset, self.end_offset, ease);
        let (pos, dir) = (self.position(a), self.direction(a));
        let base_x = unit(cross(self.up, dir));
        let base_y = cross(dir, base_x);
        let (sin, cos) = roll.sin_cos();
        let x = sub(scale(base_x, cos), scale(base_y, sin));
        let y = add(scale(base_y, cos), scale(base_x, sin));
        let pos = add(add(pos, scale(base_x, offset[0])), scale(base_y, offset[1]));
        let sizes = lerp(self.start_scale, self.end_scale, ease);
        Slice {
            pos,
            dir,
            across: [x, y],
            sizes,
        }
    }

    /// Whether the bend turns the mesh inside out: its start scales differ in sign.
    pub fn mirrors(&self) -> bool {
        (self.start_scale[0] < 0.0) != (self.start_scale[1] < 0.0)
    }

    /// Bends the vertex at `pos` with the `normal` and `tangent` it may carry, under `fit`.
    pub fn vertex(&self, fit: Fit, pos: V3, normal: Option<V3>, tangent: Option<V3>) -> Bent {
        let along = pos[self.axis] * fit.scale + fit.offset;
        let slice = self.slice(along);
        let (first, second) = ((self.axis + 1) % 3, (self.axis + 2) % 3);
        let across = |v: V3, sizes: V2| {
            add(
                scale(slice.across[0], v[first] * sizes[0]),
                scale(slice.across[1], v[second] * sizes[1]),
            )
        };
        // A normal and a tangent turn with the slice and take no scale; an axis scaled by a
        // negative number is turned over.
        let signs = slice.sizes.map(|s| if s >= 0.0 { 1.0 } else { -1.0 });
        let turn = |v: V3| add(scale(slice.dir, v[self.axis]), across(v, signs));
        Bent {
            pos: add(slice.pos, across(pos, slice.sizes)),
            normal: normal.map(turn),
            tangent: tangent.map(turn),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The reference's default curve — one unit along x, tangents along x — with up along z.
    fn straight() -> Bend {
        Bend {
            start_pos: [0.0; 3],
            start_tangent: [1.0, 0.0, 0.0],
            end_pos: [1.0, 0.0, 0.0],
            end_tangent: [1.0, 0.0, 0.0],
            start_scale: [1.0, 1.0],
            end_scale: [1.0, 1.0],
            start_roll: 0.0,
            end_roll: 0.0,
            start_offset: [0.0; 2],
            end_offset: [0.0; 2],
            up: [0.0, 0.0, 1.0],
            smooth: false,
            axis: 0,
            boundary: (0.0, 0.0),
        }
    }
    const SPAN: (V3, V3) = ([0.0; 3], [1.0, 1.0, 1.0]);

    fn near(a: V3, b: V3) -> bool {
        (0..3).all(|c| (a[c] - b[c]).abs() < 1e-5)
    }

    // Behaviour: the default curve, a straight line along the forward axis with up along z, leaves
    // a mesh as it is — position, normal and tangent.
    #[test]
    fn the_default_curve_leaves_the_mesh_as_it_is() {
        let bend = straight();
        let fit = bend.fit(SPAN);
        let bent = bend.vertex(
            fit,
            [0.5, 0.2, 0.3],
            Some([0.0, 1.0, 0.0]),
            Some([1.0, 0.0, 0.0]),
        );
        assert!(near(bent.pos, [0.5, 0.2, 0.3]));
        assert!(near(bent.normal.unwrap(), [0.0, 1.0, 0.0]));
        assert!(near(bent.tangent.unwrap(), [1.0, 0.0, 0.0]));
    }

    // Behaviour: the scale across the curve scales a vertex's other coordinates, a negative one
    // turns that axis over for the normal too, and a start scale of mixed signs mirrors the mesh.
    #[test]
    fn the_scale_stretches_across_and_a_negative_one_turns_the_normal_over() {
        let mut bend = straight();
        bend.start_scale = [2.0, 1.0];
        bend.end_scale = [2.0, 1.0];
        let fit = bend.fit(SPAN);
        let doubled = bend.vertex(fit, [0.5, 0.2, 0.3], Some([0.0, 1.0, 0.0]), None);
        assert!(near(doubled.pos, [0.5, 0.4, 0.3]));
        assert!(near(doubled.normal.unwrap(), [0.0, 1.0, 0.0]));
        assert!(!bend.mirrors());
        bend.start_scale = [-1.0, 1.0];
        bend.end_scale = [-1.0, 1.0];
        let turned = bend.vertex(fit, [0.5, 0.2, 0.3], Some([0.0, 1.0, 0.0]), None);
        assert!(near(turned.pos, [0.5, -0.2, 0.3]));
        assert!(near(turned.normal.unwrap(), [0.0, -1.0, 0.0]));
        assert!(bend.mirrors());
    }

    // Behaviour: the distance along the curve is the coordinate on the forward axis over the
    // mesh's extent, or over the range the bend names; a mesh of no extent keeps the identity.
    #[test]
    fn the_fit_follows_the_meshs_extent_or_the_range_named() {
        let mut bend = straight();
        let fit = bend.fit(([0.0; 3], [2.0, 1.0, 1.0]));
        assert_eq!((fit.scale, fit.offset), (0.5, 0.0));
        bend.boundary = (1.0, 3.0);
        let fit = bend.fit(([0.0; 3], [2.0, 1.0, 1.0]));
        assert_eq!((fit.scale, fit.offset), (0.5, -0.5));
        assert_eq!(
            bend.fit(([1.0; 3], [1.0; 3])),
            Fit {
                scale: 1.0,
                offset: 0.0
            }
        );
    }

    // Behaviour: the curve leaves its start along the start tangent and reaches its end along the
    // end tangent, passing through both ends, and its direction is a unit vector all the way.
    #[test]
    fn the_curve_runs_from_its_start_tangent_to_its_end_tangent() {
        let mut bend = straight();
        bend.start_tangent = [4.0, 0.0, 0.0];
        bend.end_pos = [4.0, 0.0, 4.0];
        bend.end_tangent = [0.0, 0.0, 4.0];
        assert!(near(bend.position(0.0), [0.0; 3]));
        assert!(near(bend.position(1.0), [4.0, 0.0, 4.0]));
        assert!(near(bend.direction(0.0), [1.0, 0.0, 0.0]));
        assert!(near(bend.direction(1.0), [0.0, 0.0, 1.0]));
        let middle = bend.direction(0.5);
        assert!(
            (middle[0] * middle[0] + middle[1] * middle[1] + middle[2] * middle[2] - 1.0).abs()
                < 1e-5
        );
        assert!(middle[0] > 0.0 && middle[2] > 0.0);
    }

    // Behaviour: a quarter turn of roll turns the frame about the curve: the vertex's third
    // coordinate lands on y and its second on minus z.
    #[test]
    fn a_roll_turns_the_frame_about_the_curve() {
        let mut bend = straight();
        bend.start_roll = std::f32::consts::FRAC_PI_2;
        bend.end_roll = std::f32::consts::FRAC_PI_2;
        let fit = bend.fit(SPAN);
        let bent = bend.vertex(fit, [0.5, 0.2, 0.3], None, None);
        assert!(near(bent.pos, [0.5, 0.3, -0.2]));
    }
}
