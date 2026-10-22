//! THE REGION SIMPLIFIER of the cluster DAG: a region of the level's mesh, compacted and scaled
//! into a frame of its own, simplified by our quadric simplifier (`region/collapse.rs`) towards the
//! target size it is asked for.
//!
//! **The frame.** The build measures a region in centimetres, its source in metres: a position is
//! read at a hundred times its metres, then scaled by the power of two that brings the region's
//! mean triangle (the square root of its mean area, in centimetres, at least `NEAR_POINTS` of
//! them) into a quarter to a half of a unit: the exponent of a quarter less the exponent of that
//! size, held within single precision's range. The attribute weights are written for that frame
//! (`dag::attributes`), whatever the model's size; a power of two keeps the scaling exact both
//! ways, but the hundred-fold does not: dividing by it again moves a position by one unit in the
//! last place. So an unmoved vertex whose attributes changed keeps its metres, and a position a
//! solve leaves where a source vertex lies in the frame (a collapse onto a locked vertex) is that
//! vertex's metres as they were, bit for bit, as the welds by position read them; only a position
//! the solve created, or one that two different source positions share in the frame, and the
//! error, come back from the frame by dividing (`Region::metres`).
//!
//! **The surface limit.** A region simplified for a cluster level holds each wedge's error to its
//! area and each collapse's to the area it touches (`region/collapse.rs`): a small piece goes as
//! cheaply as it is small.
//!
//! **Targets.** Every target is simplified afresh from the region as it was given. A stand-in's
//! (`Region::solve_to`) is a size and an error: the collapses go on past the size until one costs
//! the error, and stop at the limit it names.
//!
//! **Rules.** A cook's `SolveRules` hold every solve of its regions: the bound on the edges a
//! collapse makes, none by default, and whether the border of what a solve left is pushed out by
//! the area its collapses lost (`region/collapse/area.rs`), off by default.
pub(crate) mod collapse;
pub(crate) mod prepare;
pub(crate) mod quadric;
use crate::simplify::region::collapse::run::Stop;
use crate::simplify::{compact_attributes, compact_region, Attribute, Corrected, Role, SolveRules};
use crate::simplify::{CENTIMETRES, NEAR_POINTS};
use crate::{invalid, Result};
use std::cell::OnceCell;
use std::collections::hash_map::Entry;
use trillion3d_math::vector::vec3::{cross, point_checked_f32};
use trillion3d_math::vector::vecn::{length, sub};
use trillion3d_page_codec::hash::{word_map, WordMap};

/// In `Region::frame_at`, the mark of a position of the frame that two different source positions
/// share.
const SHARED: u32 = u32::MAX;

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
    pub(crate) locked: Vec<bool>,
    /// The source positions in the frame.
    frame: Vec<f32>,
    /// Per position of the frame, by its bits, the first compact vertex that lies there (`SHARED`
    /// when two different source positions do); built by the first `Region::metres`.
    frame_at: OnceCell<WordMap<[u32; 3], u32>>,
    /// Per triangle, its material and the mirror bits of its texture sets: two triangles of
    /// different words share no edge (`prepare::mirrored`).
    materials: Vec<u32>,
    /// The power of two the frame scales centimetres by.
    scale: f32,
    rules: SolveRules,
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
    let p = |v: u32| point_checked_f32(positions, v as usize).unwrap_or([0.0; 3]);
    let mut area = 0.0_f32;
    for t in indices.as_chunks::<3>().0 {
        let (edge01, edge20) = (sub(p(t[1]), p(t[0])), sub(p(t[0]), p(t[2])));
        area += 0.5 * length(cross(edge01, edge20));
    }
    area
}

/// A length of the source, in metres, in the frame of scale `scale`: read in centimetres, then
/// scaled.
fn to_frame(metres: f32, scale: f32) -> f32 {
    metres * CENTIMETRES * scale
}

/// A length of the frame of scale `scale` in metres: `to_frame` undone, the division by the
/// hundred-fold rounding — a position goes through `Region::metres`, an error through here.
fn from_frame(length: f32, scale: f32) -> f32 {
    length / scale / CENTIMETRES
}

impl Region {
    /// Compacts `indices` and the weighed `attributes` of their vertices, each at its weight;
    /// `locked` names the source vertices whose position is locked; `surface_area` is the area of
    /// the triangles as their clusters measured it (`surface_area`), which sets the frame; `rules`
    /// hold every solve of it.
    pub fn of(
        positions: &[f32],
        attributes: &[Attribute],
        locked: &dyn Fn(u32) -> bool,
        indices: &[u32],
        surface_area: f32,
        rules: SolveRules,
    ) -> Result<Self> {
        if indices.len() < 3
            || !indices.len().is_multiple_of(3)
            || !positions.len().is_multiple_of(3)
        {
            return Err(invalid("A region needs whole triangles and positions"));
        }
        let (source, compact, remap) = compact_region(positions, indices);
        let (source_values, weights) = compact_attributes(attributes, &remap);
        // The power of two from the exponent of the mean triangle's size, in centimetres, to a
        // quarter's.
        let size = ((surface_area / (compact.len() / 3) as f32).sqrt() * CENTIMETRES)
            .max(NEAR_POINTS * CENTIMETRES);
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
        let frame: Vec<f32> = source.iter().map(|&x| to_frame(x, scale)).collect();
        Ok(Self {
            locked: remap.iter().map(|&v| locked(v)).collect(),
            frame,
            frame_at: OnceCell::new(),
            materials: crate::simplify::region::prepare::mirrored(
                &compact,
                &source_values,
                stride,
                &uv_offsets,
            ),
            compact,
            remap,
            source,
            source_values,
            weights,
            corrected: Corrected::of(attributes),
            scale,
            rules,
        })
    }

    /// The position `p` of the frame in metres: the source position of the first vertex that lies
    /// at `p` in the frame, exactly as it was given — unless a different source position lies
    /// there too —, else `p` brought back from the frame.
    fn metres(&self, p: [f32; 3]) -> [f32; 3] {
        let at = self.frame_at.get_or_init(|| self.frame_index());
        match at.get(&p.map(f32::to_bits)) {
            Some(&v) if v != SHARED => {
                let s = &self.source[v as usize * 3..][..3];
                [s[0], s[1], s[2]]
            }
            _ => p.map(|x| from_frame(x, self.scale)),
        }
    }

    /// Per position of the frame, by its bits, the first compact vertex that lies there, `SHARED`
    /// where another one with a different source position does.
    fn frame_index(&self) -> WordMap<[u32; 3], u32> {
        let source = |v: u32| {
            let s = &self.source[v as usize * 3..][..3];
            [s[0].to_bits(), s[1].to_bits(), s[2].to_bits()]
        };
        let mut at = word_map(self.remap.len());
        for (v, p) in self.frame.as_chunks::<3>().0.iter().enumerate() {
            match at.entry(p.map(f32::to_bits)) {
                Entry::Vacant(e) => {
                    e.insert(v as u32);
                }
                Entry::Occupied(mut e) => {
                    let first = *e.get();
                    if first != SHARED && source(first) != source(v as u32) {
                        e.insert(SHARED);
                    }
                }
            }
        }
        at
    }

    /// Simplifies the region towards `target_triangles` and returns what remains, its border pushed
    /// out by the area lost when the rules keep it (`Simplifier::keep_area`); a region already at
    /// or under the target comes back as it was, at zero error. For a series of ever lower
    /// targets, the simplifier of the last one, kept in `run` (`None` to start afresh), goes on to
    /// the next target instead of starting over, which is the same solve bit for bit — the
    /// collapses and their errors never depend on the target. A solve that keeps the area pushes
    /// the border of the surface it leaves, so it starts over each time.
    pub fn solve_from(
        &self,
        run: &mut Option<collapse::Simplifier>,
        target_triangles: usize,
    ) -> SolvedRegion<'_> {
        if self.compact.len() / 3 <= target_triangles {
            return self.unsimplified();
        }
        if self.rules.keep_area {
            let mut simplifier = self.build();
            let error = simplifier.simplify(target_triangles);
            simplifier.keep_area();
            return self.assembled(&simplifier, error);
        }
        let simplifier = run.get_or_insert_with(|| self.build());
        let error = simplifier.simplify(target_triangles);
        let solved = self.assembled(simplifier, error);
        if !simplifier.resumable() {
            *run = None;
        }
        solved
    }

    /// Simplifies the region afresh towards `target_triangles` and `target_error`, a length of
    /// object space: the collapses go on, the cheapest first, past the triangles until one costs
    /// the error, and stop at `limit_triangles` whatever they cost; its border pushed out as
    /// `solve_from` pushes it. A region at the limit, or one at the triangles with no error to
    /// reach, comes back as it was, at zero error.
    pub fn solve_to(
        &self,
        (target_triangles, target_error): (usize, f32),
        limit_triangles: usize,
    ) -> SolvedRegion<'_> {
        let triangles = self.compact.len() / 3;
        if (target_triangles >= triangles && target_error == 0.0) || limit_triangles >= triangles {
            return self.unsimplified();
        }
        let frame = to_frame(target_error, self.scale);
        let mut simplifier = self.build();
        let error = simplifier.simplify_until(Stop {
            triangles: target_triangles,
            error: frame * frame,
            limit: limit_triangles,
        });
        if self.rules.keep_area {
            simplifier.keep_area();
        }
        self.assembled(&simplifier, error)
    }
}
