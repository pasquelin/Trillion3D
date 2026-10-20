//! THE REGION SIMPLIFIER of the cluster DAG: a region of the level's mesh, compacted and scaled
//! into a frame of its own, simplified by our quadric simplifier (`qem_simplifier.rs`) towards the
//! target size it is asked for.
//!
//! **The frame.** Positions are scaled by the power of two that brings the region's mean triangle
//! (the square root of its mean area, at least 2e-5) into a quarter to a half of a unit: the
//! exponent of a quarter less the exponent of that size, held within single precision's range.
//! The attribute weights are written for that frame (`dag::attributes`), whatever the model's
//! size; a power of two keeps the scaling exact both ways.
//!
//! **The surface limit.** A region simplified for a cluster level holds each wedge's error to its
//! area and each collapse's to the area it touches (`qem_simplifier.rs`): a small piece goes as
//! cheaply as it is small.
//!
//! **Targets.** Every target is simplified afresh from the region as it was given.
//!
//! **Ghosts.** A simplification starts from the ghosts the simplifications of its region's
//! children left (`qem_simplifier_ghosts.rs`) and hands on its own once its group keeps it
//! (`Handing`): where removed surface was, in object space, so a hole is measured against the
//! surface it came from whatever the level.
use crate::qem::{compact_attributes, compact_region, Attribute, Corrected, Role};
use crate::{invalid, Result};
use trillion3d_math::vec3::cross;
use trillion3d_math::vecn::{length, sub};

#[path = "qem_solve_prepare.rs"]
mod prepare;
#[path = "qem_quadric.rs"]
mod quadric;
#[path = "qem_simplifier.rs"]
mod simplifier;

pub(crate) use simplifier::position_bits;
use simplifier::Simplifier;

/// A ghost one simplification hands to the next, in object space: where removed surface was, its
/// size, a position of the live piece it was left by and one of the live triangle covering it,
/// when there is one.
#[derive(Clone, Copy, Debug)]
pub struct CarriedGhost {
    pub p: [f32; 3],
    pub size: f32,
    pub owner: Option<[f32; 3]>,
    pub cover: Option<[f32; 3]>,
}
impl CarriedGhost {
    /// Whether it can still open a hole above `error`: a hole is sought up to twice its size.
    pub fn outlasts(&self, error: f64) -> bool {
        2.0 * f64::from(self.size) > error
    }
}

/// A region prepared once, in its own compact vertex space and frame, simplified towards a target.
pub struct Region {
    /// The region's triangles over the compact vertices.
    pub compact: Vec<u32>,
    /// Per compact vertex, the source vertex it stands for.
    pub remap: Vec<u32>,
    /// Three floats per compact vertex, in object space.
    pub source: Vec<f32>,
    /// The weighed attributes, interleaved in the order of `attributes`, as written.
    pub source_values: Vec<f32>,
    /// One weight per attribute float.
    weights: Vec<f32>,
    corrected: Corrected,
    /// Per compact vertex: its position is locked.
    locked: Vec<bool>,
    /// The source positions in the frame.
    frame: Vec<f32>,
    /// Per triangle, the mirror bits of its texture sets: two triangles of different bits share
    /// no edge (`prepare::mirrored`).
    materials: Vec<u32>,
    /// The frame's scale.
    scale: f32,
}

/// A simplification of a `Region`: what it kept and where it moved it.
pub struct SolvedRegion<'r> {
    pub region: &'r Region,
    /// Triangles over the compact vertices.
    pub indices: Vec<u32>,
    /// Three floats per compact vertex: the source's where it did not move, else the solve's.
    pub positions: Vec<f32>,
    /// The weighed attributes: the source's where the vertex did not move, else the solve's.
    pub values: Vec<f32>,
    moved: Vec<bool>,
    /// Object-space error of the simplification: the square root of the largest error made,
    /// brought back from the frame.
    pub error_object: f64,
    /// What hands its ghosts on, once its group keeps it; none when it simplified nothing.
    pub handing: Option<Handing>,
}

/// The simplifier of a solved region, kept to hand its ghosts on.
pub struct Handing {
    simplifier: Simplifier,
    scale: f32,
}
impl Handing {
    /// The ghosts to hand on, in object space, to a parent that publishes `error`: those that
    /// can still open a hole above it (`CarriedGhost::outlasts`).
    pub fn ghosts(mut self, error: f64) -> Vec<CarriedGhost> {
        let least = (error * f64::from(self.scale)) as f32;
        self.simplifier.carried(least, 1.0 / self.scale)
    }
}
impl SolvedRegion<'_> {
    /// Floats of the weighed attributes per compact vertex.
    pub fn stride(&self) -> usize {
        self.region.weights.len()
    }
    /// Whether the solve rewrote compact vertex `local` — its position or a weighed attribute —;
    /// only a vertex its triangles use is marked.
    pub fn moved(&self, local: usize) -> bool {
        self.moved[local]
    }
}

/// The surface area of the triangles `indices` over `positions`, summed in single precision a
/// triangle after the other: half the length of the cross of its first edge and its last. A
/// corner past the positions reads the origin, as `compact_region` reads it: a malformed region
/// reaches `Region::of`, which names it.
pub fn surface_area(positions: &[f32], indices: &[u32]) -> f32 {
    let p = |v: u32| {
        let at = v as usize * 3;
        match positions.get(at..at + 3) {
            Some(&[x, y, z]) => [x, y, z],
            _ => [0.0; 3],
        }
    };
    let mut area = 0.0_f32;
    for t in indices.as_chunks::<3>().0 {
        let (edge01, edge20) = (sub(p(t[1]), p(t[0])), sub(p(t[0]), p(t[2])));
        area += 0.5 * length(cross(edge01, edge20));
    }
    area
}

impl Region {
    /// Compacts `indices` and the weighed `attributes` of their vertices, each at its weight;
    /// `locked` names the source vertices whose position is locked; `surface_area` is the area of
    /// the triangles as their clusters measured it (`surface_area`), which sets the frame.
    pub fn of(
        positions: &[f32],
        attributes: &[Attribute],
        locked: &dyn Fn(u32) -> bool,
        indices: &[u32],
        surface_area: f32,
    ) -> Result<Self> {
        if indices.len() < 3
            || !indices.len().is_multiple_of(3)
            || !positions.len().is_multiple_of(3)
        {
            return Err(invalid("A region needs whole triangles and positions"));
        }
        let (source, compact, remap) = compact_region(positions, indices);
        let (source_values, weights) = compact_attributes(attributes, &remap);
        // The power of two from the exponent of the mean triangle's size to a quarter's.
        let size = (surface_area / (compact.len() / 3) as f32).sqrt().max(2e-5);
        let exponent = (125 - ((size.to_bits() >> 23) & 0xff) as i32).clamp(-126, 127);
        let scale = f32::from_bits(((exponent + 127) as u32) << 23);
        let mut uv_offsets = Vec::new();
        let mut offset = 0;
        for a in attributes {
            if a.role == Role::Texture {
                uv_offsets.push(offset);
            }
            offset += a.width;
        }
        let stride = weights.len();
        Ok(Self {
            locked: remap.iter().map(|&v| locked(v)).collect(),
            frame: source.iter().map(|&x| x * scale).collect(),
            materials: prepare::mirrored(&compact, &source_values, stride, &uv_offsets),
            compact,
            remap,
            source,
            source_values,
            weights,
            corrected: Corrected::of(attributes),
            scale,
        })
    }

    /// Simplifies the region afresh towards `target_triangles`, from the ghosts `carried` its
    /// children left, and returns what remains; a region already at or under the target comes
    /// back as it was, at zero error, and hands nothing of its own on.
    pub fn solve(&self, target_triangles: usize, carried: &[CarriedGhost]) -> SolvedRegion<'_> {
        if self.compact.len() / 3 <= target_triangles {
            return self.unsimplified();
        }
        let mut simplifier = self.build();
        let error = simplifier.simplify(target_triangles, carried, self.scale);
        self.assembled(simplifier, error)
    }
}
