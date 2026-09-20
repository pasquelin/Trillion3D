//! Alpha shape of a texture: what separates a cutout from true transparency.
//!
//! A WINDOW lets light through everywhere: its alpha is halfway across the entire surface.
//! A CUTOUT — leaf, fence mesh, branch — is present or absent at each point: its alpha
//! is at 0 or 1 almost everywhere, and gradient exists only along contour, on a few
//! pixels. Two numbers suffice to distinguish them: fraction of intermediate texels, and fraction
//! of those intermediates that are adjacent to contour.
//!
//! This module yields only a PROPOSAL. Decision belongs to answer file, because
//! no measurement distinguishes for sure dirty window from very soft leaf — and because
//! reference itself never reclassifies a material on its own.
use super::*;

/// Alpha below which texel is absent, and above which present, in bytes. Encoders
/// leave one or two stray values around extremes; margins absorb them
/// without conceding anything on the rest of scale.
const ABSENT: u8 = 8;
const PRESENT: u8 = 247;
/// Contour whose distance is measured: threshold at which reclassified material cuts out, in bytes.
/// Derived from this threshold and not rewritten: otherwise measurement would say "adjacent to contour" for a
/// border where material does not cut out.
const CONTOUR: u8 = (CUTOUT_ALPHA * 255.0 + 0.5) as u8;
/// Distance to contour, in pixels, below which intermediate texel is "adjacent to border".
/// Measured foliage softens its edge across two to eight pixels; band retains this worst case.
const BAND: u8 = 8;
/// What cutout must satisfy to be proposed: enough empty space to cut out something,
/// few intermediates, and those intermediates massively adjacent to contour.
const MIN_ABSENT: f32 = 0.01;
const MAX_BETWEEN: f32 = 0.25;
const MIN_AT_CONTOUR: f32 = 0.70;

/// What measurement observed, in fractions of texel count — except , which is a fraction of
/// intermediates only: location distinguishes the two shapes, not count.
#[derive(Default, Clone)]
pub(crate) struct AlphaShape {
    pub texels: u64,
    pub absent: f32,
    pub present: f32,
    pub between: f32,
    pub at_contour: f32,
}

impl AlphaShape {
    /// Proposal, and nothing more: what HTML page pre-positions and human keeps
    /// or corrects.
    pub fn looks_like_cutout(&self) -> bool {
        self.texels > 0
            && self.absent >= MIN_ABSENT
            && self.between <= MAX_BETWEEN
            && self.at_contour >= MIN_AT_CONTOUR
    }
    /// Numbers as sheet and page show them, rounded to tenth of percent:
    /// read by eye, not values consumer derives math from. The
    /// proposal is not part of it — it is a verdict, and sheet carries it separately.
    pub fn report(&self) -> Value {
        let percent = |share: f32| (f64::from(share) * 1000.0).round() / 10.0;
        json!({"texels":self.texels,"absentPercent":percent(self.absent),
            "presentPercent":percent(self.present),"betweenPercent":percent(self.between),
            "atContourPercent":percent(self.at_contour),"band":BAND})
    }
}

/// Measures alpha of decoded image. Cost is three traversals: contour, two chamfer distance passes,
/// then tallying.
pub(crate) fn measure(image: &image::RgbaImage) -> AlphaShape {
    let raw = image.as_raw();
    let texels = (raw.len() / 4) as u64;
    if texels == 0 {
        return AlphaShape {
            texels: 0,
            absent: 0.0,
            present: 0.0,
            between: 0.0,
            at_contour: 0.0,
        };
    }
    let distance = contour_distance(image);
    let (mut absent, mut present, mut between, mut at_contour) = (0u64, 0u64, 0u64, 0u64);
    for (at, texel) in raw.as_chunks::<4>().0.iter().enumerate() {
        match texel[3] {
            alpha if alpha <= ABSENT => absent += 1,
            alpha if alpha >= PRESENT => present += 1,
            _ => {
                between += 1;
                if distance[at] <= BAND {
                    at_contour += 1;
                }
            }
        }
    }
    let share = |count: u64| count as f32 / texels as f32;
    AlphaShape {
        texels,
        absent: share(absent),
        present: share(present),
        between: share(between),
        // Without intermediate texels, question does not arise: alpha is already binary.
        at_contour: if between == 0 {
            1.0
        } else {
            at_contour as f32 / between as f32
        },
    }
}

/// Distance of each texel to threshold contour, in pixels, via two chamfer passes. A
/// contour texel has a border neighbor on other side of threshold; distance
/// then propagates in L1 norm, which never underestimates true distance.
fn contour_distance(image: &image::RgbaImage) -> Vec<u8> {
    let (width, height) = (image.width() as usize, image.height() as usize);
    let raw = image.as_raw();
    let solid = |at: usize| raw[at * 4 + 3] >= CONTOUR;
    let mut distance = vec![u8::MAX; width * height];
    for y in 0..height {
        for x in 0..width {
            let at = y * width + x;
            let here = solid(at);
            let edge = (x > 0 && solid(at - 1) != here)
                || (x + 1 < width && solid(at + 1) != here)
                || (y > 0 && solid(at - width) != here)
                || (y + 1 < height && solid(at + width) != here);
            if edge {
                distance[at] = 0;
            }
        }
    }
    for y in 0..height {
        for x in 0..width {
            let at = y * width + x;
            let mut best = distance[at];
            if y > 0 {
                best = best.min(distance[at - width].saturating_add(1));
            }
            if x > 0 {
                best = best.min(distance[at - 1].saturating_add(1));
            }
            distance[at] = best;
        }
    }
    for y in (0..height).rev() {
        for x in (0..width).rev() {
            let at = y * width + x;
            let mut best = distance[at];
            if y + 1 < height {
                best = best.min(distance[at + width].saturating_add(1));
            }
            if x + 1 < width {
                best = best.min(distance[at + 1].saturating_add(1));
            }
            distance[at] = best;
        }
    }
    distance
}
