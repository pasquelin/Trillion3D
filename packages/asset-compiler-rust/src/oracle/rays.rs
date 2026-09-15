use super::geometry::{albedo_of, cross, normalise, sub, surface_at};
use super::scene::World;
use super::trace::{direct, scene_reach, trace};
use super::OracleJob;
use std::f64::consts::PI;

/// Rayons d'un rebond secondaire, rapportés à ceux du premier : la variance qui compte est celle du
/// premier rebond, et le second n'a pas besoin d'autant de chemins pour la même erreur.
const SECONDARY_SHARE: usize = 8;

/// Un entier mélangé puis ramené dans [0,1). La graine vient du pixel et du rang de l'échantillon,
/// donc deux exécutions rendent la même image, quel que soit le nombre de fils.
fn hash_unit(seed: u64) -> f64 {
    let mut x = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15);
    x = (x ^ (x >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    x = (x ^ (x >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    ((x ^ (x >> 31)) >> 11) as f64 / (1u64 << 53) as f64
}

/// Une direction tirée sous la loi du cosinus autour de `n` : c'est l'échantillonnage qui annule le
/// facteur cosinus de l'intégrale, si bien que l'estimateur est la moyenne des radiances fois π.
fn cosine_direction(n: [f64; 3], u1: f64, u2: f64) -> [f64; 3] {
    let radius = u1.sqrt();
    let angle = 2.0 * PI * u2;
    let up = if n[1].abs() < 0.9 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };
    let tangent = normalise(cross(up, n));
    let bitangent = cross(n, tangent);
    let z = (1.0 - u1).max(0.0).sqrt();
    normalise([
        tangent[0] * radius * angle.cos() + bitangent[0] * radius * angle.sin() + n[0] * z,
        tangent[1] * radius * angle.cos() + bitangent[1] * radius * angle.sin() + n[1] * z,
        tangent[2] * radius * angle.cos() + bitangent[2] * radius * angle.sin() + n[2] * z,
    ])
}

/// L'irradiance indirecte en un point : ce qui arrive après au moins un rebond sur une surface.
///
/// C'est exactement la quantité que la grille de sondes du moteur livre, et c'est donc elle que le
/// harnais compare. Le direct n'y entre jamais — il est mesuré ailleurs, et les composantes sont
/// partitionnées (P3).
pub fn indirect(
    job: &OracleJob,
    world: &World,
    point: [f64; 3],
    n: [f64; 3],
    samples: usize,
    depth: usize,
    seed: u64,
) -> [f64; 3] {
    let reach = scene_reach(world);
    let origin = [
        point[0] + n[0] * 1e-3,
        point[1] + n[1] * 1e-3,
        point[2] + n[2] * 1e-3,
    ];
    let mut total = [0.0f64; 3];
    for sample in 0..samples {
        // Un tirage stratifié sur le premier nombre, mélangé sur le second : la couverture de
        // l'hémisphère ne dépend pas de la chance qu'a eue le générateur.
        let u1 = (sample as f64 + hash_unit(seed ^ 0x51_7c_c1_b7)) / samples as f64;
        let u2 = hash_unit(seed.wrapping_add(sample as u64).wrapping_mul(0x2545_f491));
        let ray = cosine_direction(n, u1.min(1.0 - 1e-9), u2);
        let hit = trace(world, origin, ray, reach, false);
        if !hit.found {
            continue;
        }
        let (touched, surface) = surface_at(world, origin, ray, &hit);
        let albedo = albedo_of(world, hit.triangle);
        let mut arriving = direct(world, &job.lights, touched, surface);
        if depth > 0 {
            let deeper = indirect(
                job,
                world,
                touched,
                surface,
                (samples / SECONDARY_SHARE).max(1),
                depth - 1,
                seed.wrapping_mul(0x9e37_79b9).wrapping_add(sample as u64),
            );
            for axis in 0..3 {
                arriving[axis] += deeper[axis];
            }
        }
        for axis in 0..3 {
            total[axis] += albedo[axis] / PI * arriving[axis];
        }
    }
    // Tirage en cosinus : l'intégrale de L·cos vaut π fois la moyenne des radiances.
    let normalisation = PI / samples as f64;
    [
        total[0] * normalisation,
        total[1] * normalisation,
        total[2] * normalisation,
    ]
}

/// La direction du rayon primaire d'un pixel. Même convention que la caméra du moteur : champ de
/// vision vertical, y vers le haut, et le pixel visé en son centre.
fn camera_ray(job: &OracleJob, x: usize, y: usize) -> [f64; 3] {
    let camera = &job.camera;
    let forward = normalise(sub(camera.target, camera.position));
    let right = normalise(cross(forward, camera.up));
    let up = cross(right, forward);
    let half = (camera.fov_degrees.to_radians() * 0.5).tan();
    let aspect = job.width as f64 / job.height as f64;
    let sx = ((x as f64 + 0.5) / job.width as f64 * 2.0 - 1.0) * half * aspect;
    let sy = (1.0 - (y as f64 + 0.5) / job.height as f64 * 2.0) * half;
    normalise([
        forward[0] + right[0] * sx + up[0] * sy,
        forward[1] + right[1] * sx + up[1] * sy,
        forward[2] + right[2] * sx + up[2] * sy,
    ])
}

/// Une ligne de l'image : un rayon primaire par pixel, puis l'irradiance indirecte de ce qu'il a
/// touché. Un pixel qui ne touche rien vaut exactement zéro, comme le fond du moteur.
pub fn render_row(job: &OracleJob, world: &World, y: usize, row: &mut [f32]) {
    let reach = scene_reach(world);
    for x in 0..job.width {
        let ray = camera_ray(job, x, y);
        let hit = trace(world, job.camera.position, ray, reach, false);
        if !hit.found {
            continue;
        }
        let (point, surface) = surface_at(world, job.camera.position, ray, &hit);
        let seed = (y as u64) << 32 | x as u64;
        let value = indirect(
            job,
            world,
            point,
            surface,
            job.samples,
            job.bounces.saturating_sub(1),
            seed,
        );
        for axis in 0..3 {
            row[x * 3 + axis] = value[axis] as f32;
        }
    }
}
