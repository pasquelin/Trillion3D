//! A soft body's simulated vertices, made from a primitive as the page's `softBodyOf` makes them from
//! a geometry (`packages/sdk-core/src/physics/soft.ts`): vertices at one position welded into one,
//! their triangles (none for a rope), their masses from the scaled area — a rope's length — each
//! holds, or the declared mass spread so, its pins held, and a volume's pressure. Each stored value
//! is rounded to 32 bits where the page's `Float32Array` rounds it: both weigh a vertex alike.
use super::SOFT_VERTEX_WORDS as W;
use crate::dag::clusters::weld_positions;
use crate::shared_math::{cross, length, sub};

/// kg/m² of a cloth's or a volume's skin, and kg/m of a rope, left undeclared (`SOFT_AREAL_DENSITY`,
/// `SOFT_LINEAR_DENSITY`).
const AREAL_DENSITY: f64 = 0.2;
const LINEAR_DENSITY: f64 = 0.065;
/// A volume's default pressure rests its weight on this share of its mean cross-section
/// (`SOFT_FOOTPRINT`), and a volume keeps within this share of its rest volume (`SOFT_MAX_SWELL`).
const FOOTPRINT: f64 = 0.25;
const MAX_SWELL: f64 = 0.1;
/// The worker's step (`PHYSICS_STEP`), Jolt's substeps of a soft body per step, and Earth's pull.
const STEP: f64 = 1.0 / 60.0;
const SUBSTEPS: f64 = 5.0;
const EARTH: f64 = 9.81;

/// What a node declares of its soft body: its options once read (`SoftSettings`).
pub(super) struct SoftDeclared {
    /// `cloth`, `rope` or `volume`.
    pub kind: &'static str,
    pub pins: Vec<f64>,
    pub mass: Option<f64>,
    pub stretch: f64,
    pub bend: f64,
    pub pressure: Option<f64>,
}

/// The simulated vertices (`x, y, z, mass` each in the primitive's frame, a pin's mass 0), their
/// triangle corners, and the gas's pressure at rest, Pa (0 without gas).
pub(super) struct SoftRecord {
    pub vertices: Vec<f32>,
    pub indices: Vec<u32>,
    pub pressure: f64,
}

/// The most gauge pressure a volume's skin holds within `MAX_SWELL` (`heldPressure`).
fn held_pressure(vertex_mass: f64, area: f64, stretch: f64) -> f64 {
    let dt = STEP / SUBSTEPS;
    let radius = (area / (4.0 * std::f64::consts::PI)).sqrt();
    let give = ((stretch + dt * dt / vertex_mass) * radius) / (2.0 * 3f64.sqrt());
    ((1.0 + MAX_SWELL).cbrt() - 1.0) / give
}

/// The soft body of `pos` (3 floats per vertex) and its triangle `corners` (every vertex in order
/// when it has none), scaled by `scale`; the page's own words when it would refuse it.
pub(super) fn soft_record(
    pos: &[f32],
    corners: Option<&[u32]>,
    scale: [f64; 3],
    d: &SoftDeclared,
) -> Result<SoftRecord, String> {
    let (count, rope, volume) = (pos.len() / 3, d.kind == "rope", d.kind == "volume");
    // As the page's key, the text of each coordinate: 0 and -0 are one position.
    let every: Vec<u32> = (0..count as u32).collect();
    let canonical = weld_positions(pos, &every);
    let (mut map, mut kept) = (Vec::with_capacity(count), Vec::new());
    for (v, &first) in canonical.iter().enumerate() {
        // A vertex's first copy comes first: its welded index is already mapped.
        let welded = if first as usize == v {
            kept.push(v);
            kept.len() as u32 - 1
        } else {
            map[first as usize]
        };
        map.push(welded);
    }
    // A rope keeps no triangle.
    let corners = match corners {
        _ if rope => &[],
        Some(corners) => corners,
        None => &every[..],
    };
    let mut indices = Vec::new();
    let triangles: &[[u32; 3]] = corners.as_chunks().0;
    for t in triangles {
        let [a, b, c] = t.map(|corner| map.get(corner as usize).copied());
        let (Some(a), Some(b), Some(c)) = (a, b, c) else {
            return Err("A soft body's triangle names no vertex.".into());
        };
        if a != b && b != c && a != c {
            indices.extend([a, b, c]);
        }
    }
    let enough = if rope {
        kept.len() >= 2
    } else {
        !indices.is_empty()
    };
    if !enough {
        return Err(format!("A soft {} needs more vertices.", d.kind));
    }
    let mut vertices = vec![0f32; kept.len() * W];
    for (i, &v) in kept.iter().enumerate() {
        vertices[i * W..i * W + 3].copy_from_slice(&pos[v * 3..v * 3 + 3]);
    }
    let measure = spread_mass(&mut vertices, &indices, scale)?;
    let density = if rope { LINEAR_DENSITY } else { AREAL_DENSITY };
    let factor = d.mass.map_or(density, |mass| mass / measure);
    for mass in vertices.iter_mut().skip(3).step_by(W) {
        *mass = (*mass as f64 * factor) as f32;
    }
    let mut pressure = 0.0;
    if volume {
        let held = held_pressure(factor * measure / kept.len() as f64, measure, d.stretch);
        pressure = d
            .pressure
            .unwrap_or((4.0 * factor * EARTH / FOOTPRINT).min(held));
        if pressure > held {
            return Err(format!(
                "A soft volume's pressure {pressure} Pa swells it past a tenth: its skin holds {held:.1}."
            ));
        }
    }
    for &pin in &d.pins {
        if !(pin.fract() == 0.0 && pin >= 0.0 && pin < count as f64) {
            return Err(format!(
                "A soft body's pin {pin} names no vertex of its {count}."
            ));
        }
        vertices[map[pin as usize] as usize * W + 3] = 0.0;
    }
    Ok(SoftRecord {
        vertices,
        indices,
        pressure,
    })
}

/// Adds to each vertex's mass word the scaled area (no triangle: length) it holds (`spreadMass`);
/// returns the whole.
fn spread_mass(vertices: &mut [f32], indices: &[u32], s: [f64; 3]) -> Result<f64, String> {
    let at =
        |v: &[f32], i: usize| -> [f64; 3] { std::array::from_fn(|k| v[i * W + k] as f64 * s[k]) };
    let d = |v: &[f32], a: usize, b: usize| sub(at(v, b), at(v, a));
    let share = |v: &mut [f32], corners: &[usize], amount: f64| {
        for &i in corners {
            v[i * W + 3] = (v[i * W + 3] as f64 + amount / corners.len() as f64) as f32;
        }
        amount
    };
    let mut whole = 0.0;
    if indices.is_empty() {
        for i in 1..vertices.len() / W {
            let amount = length(d(vertices, i - 1, i));
            whole += share(vertices, &[i - 1, i], amount);
        }
    }
    for t in indices.as_chunks::<3>().0 {
        let [a, b, c] = t.map(|corner| corner as usize);
        let area = length(cross(d(vertices, a, b), d(vertices, a, c))) / 2.0;
        whole += share(vertices, &[a, b, c], area);
    }
    // Also refuses a NaN whole, as the page does.
    match whole.partial_cmp(&0.0) {
        Some(std::cmp::Ordering::Greater) => Ok(whole),
        _ => Err("A soft body has no area or length.".into()),
    }
}
