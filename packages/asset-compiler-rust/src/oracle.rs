//! Oracle d'éclairage indirect : un traceur de chemins de référence, sur les triangles sources.
//!
//! Il ne rend rien pour l'écran. Il répond à une seule question, celle que le contrat d'erreur pose
//! (E1) : quelle irradiance indirecte arrive sur la première surface que voit chaque pixel, pour
//! une pose de caméra et une liste de lampes déclarées. Le moteur répond à la même question par sa
//! vue de mesure ; le harnais compare les deux.
//!
//! Il ne partage ni le proxy, ni les nœuds écrits dans le cache, ni la grille de sondes : il relit
//! la source et intègre par Monte-Carlo. Il construit son arbre avec `proxy::bvh`, le seul
//! constructeur de BVH du dépôt côté Rust — c'est le code qui est partagé, jamais la géométrie ni
//! la coupe. L'autre modèle commun est celui des lampes et du diffus de Lambert, le contrat même.
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

/// Contrat de l'oracle. Un travail d'une autre version est refusé, jamais interprété de travers.
pub const ORACLE_VERSION: u32 = 1;
/// Rangs des types de lampe, ceux du contrat `SceneLight` et du tampon GPU.
pub const KIND_POINT: u8 = 0;
pub const KIND_SPOT: u8 = 1;
pub const KIND_SUN: u8 = 2;
/// Largeur du bord adouci du cône d'un projecteur, en cosinus : la même que dans le nuanceur.
pub const SPOT_EDGE: f64 = 0.02;

/// Une lampe déclarée, telle que l'hôte la déclare au moteur.
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

/// Un travail complet. Rien n'y est facultatif sans valeur publiée.
pub struct OracleJob {
    pub source: PathBuf,
    pub width: usize,
    pub height: usize,
    pub camera: OracleCamera,
    pub lights: Vec<OracleLight>,
    /// Rayons d'hémisphère par pixel. C'est lui qui décide de l'incertitude de l'oracle (E7).
    pub samples: usize,
    /// Rebonds comptés : 1 ne rend que le premier, 2 y ajoute le second, et ainsi de suite.
    pub bounces: usize,
    pub out: PathBuf,
}

/// Rend l'image d'irradiance indirecte et l'écrit. Le rapport publie ce qu'elle a coûté.
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
