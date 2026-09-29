//! The bake: one orthographic capture per lattice vertex, traced against the level-0 mesh
//! through the alpha-aware filter, four rotated-grid rays a texel.
use super::mesh::{Sample, Traceable};
use super::octahedron::{basis, frame_direction};
use crate::shared_math::scale;
use rayon::prelude::*;
use trillion3d_page_codec::vec3::add;

/// Rotated-grid subsamples of a texel, in texel units.
const SUBSAMPLES: [[f64; 2]; 4] = [
    [0.375, 0.125],
    [0.875, 0.375],
    [0.625, 0.875],
    [0.125, 0.625],
];

/// What is captured: `frames`×`frames` views of `side`² texels, hemi-octahedral or full.
#[derive(Clone, Copy)]
pub(crate) struct Capture {
    pub frames: usize,
    pub side: usize,
    pub hemi: bool,
}

/// The three maps of an atlas, RGBA8, `side`² texels each, frame `(i, j)` at texel
/// `(i·frame, j·frame)`: base colour (sRGB) and coverage, object normal (`n·½ + ½`) and depth
/// `D = ½ + height / 2R`, packed occlusion-roughness-metallic.
pub(crate) struct Atlas {
    pub capture: Capture,
    pub side: usize,
    pub maps: [Vec<u8>; 3],
}

fn byte(x: f64) -> u8 {
    (x.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// A texel from its kept samples: colours averaged over the hits, coverage the share of rays
/// that hit.
fn resolve(hits: &[Sample], radius: f64) -> [[u8; 4]; 3] {
    let coverage = byte(hits.len() as f64 / SUBSAMPLES.len() as f64);
    if hits.is_empty() {
        return [[0; 4]; 3];
    }
    let mean = |f: &dyn Fn(&Sample) -> [f64; 3]| {
        let sum = hits.iter().fold([0.0; 3], |s, h| add(s, f(h)));
        scale(sum, 1.0 / hits.len() as f64)
    };
    let colour = mean(&|h| h.colour).map(|c| crate::texture_preview::linear_to_srgb(c as f32));
    let normal = crate::tracer::normalise(mean(&|h| h.normal)).map(|n| byte(n * 0.5 + 0.5));
    let depth = hits
        .iter()
        .map(|h| 0.5 + (2.0 * radius - h.distance) / (2.0 * radius))
        .sum::<f64>();
    let orm = mean(&|h| h.orm).map(byte);
    [
        [colour[0], colour[1], colour[2], coverage],
        [
            normal[0],
            normal[1],
            normal[2],
            byte(depth / hits.len() as f64),
        ],
        [orm[0], orm[1], orm[2], 255],
    ]
}

/// One frame: `side`² texels of the three maps, rows top to bottom.
fn frame(mesh: &Traceable, capture: Capture, at: (usize, usize)) -> Vec<[[u8; 4]; 3]> {
    let r = mesh.radius;
    let dir = frame_direction(at, capture.frames, capture.hemi);
    let (x, y) = basis(dir);
    let eye = add(mesh.centre, scale(dir, 2.0 * r));
    let side = capture.side as f64;
    (0..capture.side * capture.side)
        .map(|texel| {
            let (px, py) = ((texel % capture.side) as f64, (texel / capture.side) as f64);
            let hits: Vec<Sample> = SUBSAMPLES
                .iter()
                .filter_map(|s| {
                    let u = ((px + s[0]) / side - 0.5) * 2.0 * r;
                    let v = ((py + s[1]) / side - 0.5) * 2.0 * r;
                    let origin = add(eye, add(scale(x, u), scale(y, v)));
                    mesh.trace(origin, scale(dir, -1.0), 4.0 * r)
                })
                .collect();
            resolve(&hits, r)
        })
        .collect()
}

/// Bakes every frame in parallel, then lays them out in the three maps.
pub(crate) fn bake(mesh: &Traceable, capture: Capture) -> Atlas {
    let n = capture.frames;
    let frames: Vec<Vec<[[u8; 4]; 3]>> = (0..n * n)
        .into_par_iter()
        .map(|k| frame(mesh, capture, (k % n, k / n)))
        .collect();
    let side = n * capture.side;
    let mut maps = [
        vec![0u8; side * side * 4],
        vec![0u8; side * side * 4],
        vec![0u8; side * side * 4],
    ];
    for (k, texels) in frames.iter().enumerate() {
        let (i, j) = (k % n, k / n);
        for (t, texel) in texels.iter().enumerate() {
            let (x, y) = (
                i * capture.side + t % capture.side,
                j * capture.side + t / capture.side,
            );
            for (map, value) in maps.iter_mut().zip(texel) {
                map[(y * side + x) * 4..(y * side + x) * 4 + 4].copy_from_slice(value);
            }
        }
    }
    Atlas {
        capture,
        side,
        maps,
    }
}

impl Atlas {
    /// Mean coverage of the frames against their bounding disc, `c` of the switch formulas.
    pub fn coverage(&self) -> f64 {
        let covered: f64 = self.maps[0]
            .as_chunks::<4>()
            .0
            .iter()
            .map(|t| f64::from(t[3]) / 255.0)
            .sum();
        let frames = (self.capture.frames * self.capture.frames) as f64;
        let disc = std::f64::consts::PI * (self.capture.side as f64 * 0.5).powi(2);
        covered / frames / disc
    }
}
