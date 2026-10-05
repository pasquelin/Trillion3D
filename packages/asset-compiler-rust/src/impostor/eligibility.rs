//! Whether a mesh gets an impostor, derived from the mesh and never from a list (#817, "When to
//! switch"). With `f` the focal length in pixels, `R` the bounding radius, `T` the root
//! triangles, `c` the measured mean coverage of the frames and `r_f` the frame side in texels:
//! the atlas is sharp from `z_tex = 2R·f / r_f`, the root costs more triangles than the pixels
//! it covers from `z_tri = R·f·√(cπ/T)`, and the bake takes the smallest power-of-two
//! `r_f ≥ 2√(T/(cπ))`, so that `z_tex ≤ z_tri`.
use super::surface::coverage_cut;
use serde_json::{json, Value};
use std::f64::consts::PI;

/// Frames a side: the default capture, 12×12 = 144 views.
pub(crate) const FRAMES: usize = 12;
/// Smallest frame side, in texels: the probe that measures `c` captures at this side.
pub(crate) const PROBE_SIDE: usize = 16;
/// Largest atlas side: WebGPU's guaranteed `maxTextureDimension2D`, the texture any card holds.
pub(crate) const ATLAS_LIMIT: usize = 8192;

/// The engine's default vertical field (`DEFAULT_FOV`, 55°, `backend/common.ts`) on the target
/// screen, 1117 CSS lines at DPR 2 — 2234 device lines, half of them above the axis —: the focal
/// length in device pixels (2146) the compiler judges distances with. A narrower
/// field or a taller screen moves the switch at run time (#483), never the bake.
pub(crate) fn reference_focal() -> f64 {
    1117.0 / (55.0f64.to_radians() * 0.5).tan()
}

/// What the mesh says of itself.
pub(crate) struct Candidate {
    pub root_triangles: usize,
    pub radius: f64,
    pub placements: usize,
    pub masked: bool,
    pub skinned: bool,
    /// Farthest distance a placement is seen from: the diagonal of the scene's bounds.
    pub reach: f64,
}

/// Why a mesh keeps its geometry at every distance.
#[derive(Debug, PartialEq)]
pub(crate) enum Refusal {
    /// A skinned or morphed mesh deforms; a still capture cannot follow it.
    Skinned,
    /// Neither repeated nor masked: one opaque placement gains less than its atlas costs.
    SingleOpaquePlacement,
    /// No ray of any frame met a surface.
    NoCoverage,
    /// The root stays below the pixels it covers out to the scene's reach.
    RootCheaperThanImpostor { switch: f64 },
    /// The atlas the root asks for is wider than any card holds.
    AtlasOverLimit { side: usize },
}
impl Refusal {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Skinned => "skinned",
            Self::SingleOpaquePlacement => "single-opaque-placement",
            Self::NoCoverage => "no-coverage",
            Self::RootCheaperThanImpostor { .. } => "root-cheaper-than-impostor",
            Self::AtlasOverLimit { .. } => "atlas-over-texture-limit",
        }
    }
    /// The report's words for it, with the numbers that decided.
    pub fn json(&self, candidate: &Candidate, coverage: Option<f64>) -> Value {
        let detail = match self {
            Self::Skinned => {
                "a skinned or morphed mesh deforms; a still capture cannot follow it".into()
            }
            Self::SingleOpaquePlacement => "one opaque placement".to_string(),
            Self::NoCoverage => "no frame covers a texel".to_string(),
            Self::RootCheaperThanImpostor { switch } => format!(
                "root cheaper than impostor: {} root triangles stay below the pixels the mesh covers out to {:.1} m, the farthest a placement is seen from; the switch would sit at {:.1} m",
                candidate.root_triangles, candidate.reach, switch
            ),
            Self::AtlasOverLimit { side } => {
                format!("an atlas of {side}² texels is over the {ATLAS_LIMIT}² texture limit")
            }
        };
        json!({"status": "refused", "reason": self.code(), "detail": detail, "coverage": coverage})
    }
}

/// `z_tri`: the depth from which the root's triangles outnumber the pixels it covers.
pub(crate) fn triangle_depth(candidate: &Candidate, coverage: f64, focal: f64) -> f64 {
    candidate.radius * focal * (coverage * PI / candidate.root_triangles.max(1) as f64).sqrt()
}

/// `z_tex`: the depth from which a frame of `side` texels is sharp.
pub(crate) fn texel_depth(candidate: &Candidate, side: usize, focal: f64) -> f64 {
    2.0 * candidate.radius * focal / side as f64
}

/// The frame side the root asks for: the smallest power of two `≥ 2√(T/(cπ))`.
pub(crate) fn frame_side(root_triangles: usize, coverage: f64) -> usize {
    let side = 2.0 * (root_triangles as f64 / (coverage * PI)).sqrt();
    (side.ceil() as usize).next_power_of_two().max(PROBE_SIDE)
}

/// Before any trace: only a rigid, repeated or masked mesh is a candidate.
pub(crate) fn precheck(candidate: &Candidate) -> Result<(), Refusal> {
    if candidate.skinned {
        return Err(Refusal::Skinned);
    }
    if candidate.placements < 2 && !candidate.masked {
        return Err(Refusal::SingleOpaquePlacement);
    }
    Ok(())
}

/// The frame side to bake at, from the coverage the probe measured, or the refusal.
pub(crate) fn judge(candidate: &Candidate, coverage: f64) -> Result<usize, Refusal> {
    precheck(candidate)?;
    if coverage <= 0.0 {
        return Err(Refusal::NoCoverage);
    }
    let switch = triangle_depth(candidate, coverage, reference_focal());
    if switch > candidate.reach {
        return Err(Refusal::RootCheaperThanImpostor { switch });
    }
    let side = frame_side(candidate.root_triangles, coverage);
    if side * FRAMES > ATLAS_LIMIT {
        return Err(Refusal::AtlasOverLimit {
            side: side * FRAMES,
        });
    }
    Ok(side)
}

/// Whether a primitive of source mesh `mesh` cuts its coverage, from its materials alone.
pub(crate) fn masked(g: &Value, mesh: usize) -> bool {
    let primitives = g["meshes"][mesh]["primitives"]
        .as_array()
        .into_iter()
        .flatten();
    primitives.into_iter().any(|p| {
        let material = p["material"]
            .as_u64()
            .map(|id| &g["materials"][id as usize]);
        material.is_some_and(|m| coverage_cut(m).is_some())
    })
}

/// Whether a primitive of source mesh `mesh` deforms by its own attributes: morph targets or
/// joint weights, which its pages carry to the GPU deformation stage
/// (`compiler_page_object.rs`, `page_deformation`).
pub(crate) fn deforms(g: &Value, mesh: usize) -> bool {
    let primitives = g["meshes"][mesh]["primitives"]
        .as_array()
        .into_iter()
        .flatten();
    primitives.into_iter().any(|p| {
        let attributes = &p["attributes"];
        p.get("targets").is_some()
            || attributes.get("JOINTS_0").is_some()
            || attributes.get("WEIGHTS_0").is_some()
    })
}
