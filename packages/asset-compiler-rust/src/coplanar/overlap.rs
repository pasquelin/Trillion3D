use super::*;
use crate::shared_math::dot;

/// The triangles of a surface, flattened into the two axes of its own world plane. Built once per
/// surface and reused by every pair it is tested against.
pub struct Footprint {
    /// Three points per triangle.
    pub points: Vec<[f64; 2]>,
}

/// Axis-aligned rectangle of a surface in the plane frame, from the world box of its clusters. This
/// is the cheap filter: two surfaces whose rectangles miss each other never read a triangle.
pub fn rectangle(surface: &Surface, u: [f64; 3], v: [f64; 3]) -> Rect {
    let mut low = [f64::INFINITY; 2];
    let mut high = [f64::NEG_INFINITY; 2];
    for corner in 0..8 {
        let point = [
            if corner & 1 == 0 {
                surface.low[0]
            } else {
                surface.high[0]
            },
            if corner & 2 == 0 {
                surface.low[1]
            } else {
                surface.high[1]
            },
            if corner & 4 == 0 {
                surface.low[2]
            } else {
                surface.high[2]
            },
        ];
        let flat = [dot(u, point), dot(v, point)];
        crate::shared_math::extend_aabb(&mut low, &mut high, flat);
    }
    (low, high)
}

/// An axis-aligned rectangle in the frame of a plane: its low corner, then its high one.
pub type Rect = ([f64; 2], [f64; 2]);

/// The rectangle two surfaces share, or `None` when they do not touch.
pub fn intersection(a: &Rect, b: &Rect) -> Option<Rect> {
    let mut low = [0.0f64; 2];
    let mut high = [0.0f64; 2];
    for axis in 0..2 {
        low[axis] = a.0[axis].max(b.0[axis]);
        high[axis] = a.1[axis].min(b.1[axis]);
        if !matches!(
            high[axis].partial_cmp(&low[axis]),
            Some(std::cmp::Ordering::Greater)
        ) {
            return None;
        }
    }
    Some((low, high))
}

/// The triangles of one surface, read back from the source once. `None` when the primitive carries
/// more triangles than the stage is allowed to hold, which is reported rather than guessed at.
pub fn footprint(
    inputs: &CoplanarInputs<'_>,
    world: &crate::compiler_world::Mat4,
    surface: &Surface,
    bounds: &CoplanarBounds,
) -> Result<Option<Footprint>> {
    let primitive = &inputs.primitives[surface.primitive];
    let mesh = required_index(primitive.get("mesh"), "primitive.mesh")?;
    let part = required_index(primitive.get("primitive"), "primitive.primitive")?;
    let Some(old_mesh) = inputs.source_mesh.get(&mesh).copied() else {
        return Ok(None);
    };
    let source = item(
        values(
            item(values(inputs.g, "meshes")?, old_mesh, "mesh")?,
            "primitives",
        )?,
        part,
        "primitive",
    )?;
    let positions = accessor(
        inputs.g,
        inputs.bin,
        required_index(
            source
                .get("attributes")
                .and_then(Value::as_object)
                .and_then(|a| a.get("POSITION")),
            "primitive.attributes.POSITION",
        )?,
        None,
    )?;
    let indices: Vec<u32> = match source.get("indices") {
        Some(value) => accessor(
            inputs.g,
            inputs.bin,
            required_index(Some(value), "primitive.indices")?,
            None,
        )?
        .collect_u32()?,
        None => (0..positions.count as u32).collect(),
    };
    if indices.len() / 3 > bounds.max_triangles_per_surface {
        return Ok(None);
    }
    let xyz = positions.collect_f32()?;
    let (u, v) = plane::plane_frame(surface.normal);
    let mut points = Vec::new();
    for triangle in indices.as_chunks::<3>().0 {
        (inputs.cancelled)()?;
        let mut corners = [[0.0f64; 3]; 3];
        for (slot, id) in triangle.iter().enumerate() {
            let base = *id as usize * 3;
            if base + 2 >= xyz.len() {
                return Ok(None);
            }
            corners[slot] = crate::compiler_world::transform_point(
                world,
                [xyz[base] as f64, xyz[base + 1] as f64, xyz[base + 2] as f64],
            );
        }
        if !in_plane(&corners, surface, inputs.offset_quantum) {
            continue;
        }
        for corner in corners {
            points.push([dot(u, corner), dot(v, corner)]);
        }
    }
    if points.is_empty() {
        return Ok(None);
    }
    Ok(Some(Footprint { points }))
}

fn in_plane(corners: &[[f64; 3]; 3], surface: &Surface, tolerance: f64) -> bool {
    for corner in corners {
        if (dot(surface.normal, *corner) - surface.offset).abs() > tolerance {
            return false;
        }
    }
    true
}

/// Cells of the shared rectangle a surface actually covers. A cell counts when its centre falls
/// inside a triangle: two surfaces that merely meet along an edge share no centre and no cell.
pub fn cover(footprint: &Footprint, rect: &Rect, grid: usize, into: &mut [u64]) {
    into.fill(0);
    let span = [rect.1[0] - rect.0[0], rect.1[1] - rect.0[1]];
    if !(span[0] > 0.0 && span[1] > 0.0) {
        return;
    }
    let step = [span[0] / grid as f64, span[1] / grid as f64];
    for triangle in footprint.points.as_chunks::<3>().0 {
        let (a, b, c) = (triangle[0], triangle[1], triangle[2]);
        let area = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]);
        if area == 0.0 {
            continue;
        }
        let cell = |value: f64, axis: usize| ((value - rect.0[axis]) / step[axis]).floor();
        let low_x = cell(a[0].min(b[0]).min(c[0]), 0).max(0.0) as usize;
        let low_y = cell(a[1].min(b[1]).min(c[1]), 1).max(0.0) as usize;
        let high_x = (cell(a[0].max(b[0]).max(c[0]), 0).max(0.0) as usize).min(grid - 1);
        let high_y = (cell(a[1].max(b[1]).max(c[1]), 1).max(0.0) as usize).min(grid - 1);
        for y in low_y..=high_y.min(grid - 1) {
            let py = rect.0[1] + (y as f64 + 0.5) * step[1];
            for x in low_x..=high_x {
                let px = rect.0[0] + (x as f64 + 0.5) * step[0];
                let w0 = ((b[0] - a[0]) * (py - a[1]) - (px - a[0]) * (b[1] - a[1])) / area;
                let w1 = ((px - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (py - a[1])) / area;
                if w0 < 0.0 || w1 < 0.0 || w0 + w1 > 1.0 {
                    continue;
                }
                let bit = y * grid + x;
                into[bit >> 6] |= 1u64 << (bit & 63);
            }
        }
    }
}

/// Cells both surfaces cover, and the area one of those cells stands for.
pub fn shared(a: &[u64], b: &[u64]) -> usize {
    a.iter()
        .zip(b.iter())
        .map(|(left, right)| (left & right).count_ones() as usize)
        .sum()
}
