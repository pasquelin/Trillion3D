//! Indirect lighting oracle: a reference path tracer, on the source triangles.
//!
//! It renders nothing for the screen. It answers one question, the one the error
//! contract poses (E1): what indirect irradiance arrives on the first surface
//! each pixel sees, for a camera pose and a list of declared lights. The engine
//! answers the same question through its measurement view; the harness compares
//! the two.
//!
//! It shares neither the proxy, nor the nodes written in the cache, nor the
//! probe grid: it re-reads the source and integrates by Monte-Carlo. It builds
//! its tree with `proxy::bvh`, the only BVH constructor in the repository on the
//! Rust side — it is the code that is shared, never the geometry nor the cut.
//! The other common model is that of lights and Lambert diffuse, the contract
//! itself.
use crate::Result;
use serde_json::{json, Value};
use std::path::PathBuf;

pub mod geometry;
pub mod job;
pub mod materials;
pub mod rays;
pub mod scene;
pub mod trace;

pub use job::job_of;

/// Oracle contract. A job of another version is refused, never misread.
pub const ORACLE_VERSION: u32 = 1;
/// Rangs des types de lampe, ceux du contrat `SceneLight` et du tampon GPU.
pub const KIND_POINT: u8 = 0;
pub const KIND_SPOT: u8 = 1;
pub const KIND_SUN: u8 = 2;
/// Width of a spotlight cone's softened edge, in cosine: the same as in the shader.
pub const SPOT_EDGE: f64 = 0.02;

/// A declared light, as the host declares it to the engine.
pub struct OracleLight {
    pub kind: u8,
    pub position: [f64; 3],
    pub direction: [f64; 3],
    pub color: [f64; 3],
    pub intensity: f64,
    pub range: f64,
    pub cos_cone: f64,
    pub casts_shadow: bool,
}

pub struct OracleCamera {
    pub position: [f64; 3],
    pub target: [f64; 3],
    pub up: [f64; 3],
    pub fov_degrees: f64,
}

/// A complete job. Nothing in it is optional without a published value.
pub struct OracleJob {
    pub source: PathBuf,
    pub width: usize,
    pub height: usize,
    pub camera: OracleCamera,
    pub lights: Vec<OracleLight>,
    /// Hemisphere rays per pixel. This is what decides the oracle's uncertainty (E7).
    pub samples: usize,
    /// Bounces counted: 1 yields only the first, 2 adds the second, and so on.
    pub bounces: usize,
    pub out: PathBuf,
}

/// Yields the indirect irradiance image and writes it. The report publishes what it cost.
pub fn run(job: &OracleJob) -> Result<Value> {
    let started = std::time::Instant::now();
    let world = scene::load(&job.source)?;
    let image = trace::render(job, &world);
    let mut bytes = Vec::with_capacity(image.len() * 4);
    for value in &image {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    std::fs::write(&job.out, &bytes)?;
    Ok(json!({
     "version": ORACLE_VERSION,
     "width": job.width, "height": job.height,
     "triangles": world.albedo.len(),
     "nodes": world.node_links.len() / 3,
     "samples": job.samples, "bounces": job.bounces,
     "out": job.out.to_string_lossy(),
     "seconds": started.elapsed().as_secs_f64(),
    }))
}
