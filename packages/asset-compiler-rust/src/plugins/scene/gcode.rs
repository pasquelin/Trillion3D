//! Bounded G-code tool paths, represented as lines rather than invented solid surfaces.
use super::{mesh_source as source, SceneRequest};
use crate::{
    import::{SceneTables, Vertices},
    Result,
};
use serde_json::json;
#[cfg(test)]
mod tests;
mod words;

pub(super) static GCODE: source::FilePlugin = source::FilePlugin {
    name: "gcode",
    version: "gcode-linear-1",
    extensions: &["gcode", "gco", "gc"],
    magic: b"",
    read,
};

fn read(bytes: &[u8], request: &SceneRequest<'_>, scene: &mut SceneTables) -> Result<()> {
    let text =
        std::str::from_utf8(bytes).map_err(|_| source::invalid("gcode", "expected UTF-8"))?;
    let (mut position, mut offset) = ([0.0f64; 3], [0.0f64; 3]);
    let (mut scale, mut absolute, mut extruder_absolute) = (0.001, true, true);
    let (mut extrusion, mut feed, mut motion) = (0.0, 0.0, 0u32);
    let mut paths: [Vertices; 3] = Default::default();
    let mut records = Vec::new();
    for (line, row) in text.lines().enumerate() {
        super::archive::check(request)?;
        let words = words::parse(row)?;
        if words.is_empty() {
            continue;
        }
        words::validate(&words)?;
        let mut reset = false;
        for &(key, value) in &words {
            match key {
                'G' => match value {
                    0.0 => motion = 0,
                    1.0 => motion = 1,
                    20.0 => scale = 0.0254,
                    21.0 => scale = 0.001,
                    90.0 => absolute = true,
                    91.0 => absolute = false,
                    92.0 => reset = true,
                    _ => {
                        return Err(source::unsupported(
                            "gcode",
                            format!("G{value} at line {}", line + 1),
                        ))
                    }
                },
                'M' => match value {
                    82.0 => extruder_absolute = true,
                    83.0 => extruder_absolute = false,
                    104.0 | 109.0 | 140.0 | 190.0 | 106.0 | 107.0 => {
                        scene.report.add("gcode-process-setting");
                    }
                    _ => return Err(source::unsupported("gcode", format!("M{value}"))),
                },
                'X' | 'Y' | 'Z' | 'E' | 'F' | 'S' | 'N' => {}
                _ => return Err(source::unsupported("gcode", format!("word {key}"))),
            }
        }
        let mut next = position;
        let mut next_extrusion = extrusion;
        for &(key, value) in &words {
            if let Some(axis) = ['X', 'Y', 'Z'].iter().position(|&axis| axis == key) {
                if reset {
                    offset[axis] = position[axis] - value * scale;
                } else {
                    next[axis] = if absolute {
                        value * scale + offset[axis]
                    } else {
                        position[axis] + value * scale
                    };
                }
            } else if key == 'E' {
                next_extrusion = if extruder_absolute || reset {
                    value * scale
                } else {
                    extrusion + value * scale
                };
            } else if key == 'F' {
                feed = value * scale / 60.0;
            }
        }
        if !next_extrusion.is_finite() || !feed.is_finite() || offset.iter().any(|v| !v.is_finite())
        {
            return Err(source::invalid("gcode", "non-finite modal state"));
        }
        if !reset && next != position {
            source::admit(
                (records.len() + 1).saturating_mul(1024),
                request.ram_budget / 2,
                "gcode",
            )?;
            let kind = if motion == 0 {
                0
            } else if next_extrusion > extrusion {
                2
            } else {
                1
            };
            let path = &mut paths[kind];
            for point in [position, next] {
                // Machine Z-up becomes right-handed glTF Y-up, in metres.
                path.positions.extend([
                    source::finite(point[0], "gcode")?,
                    source::finite(point[2], "gcode")?,
                    source::finite(-point[1], "gcode")?,
                ]);
                path.indices.push(
                    u32::try_from(path.indices.len())
                        .map_err(|_| source::invalid("gcode", "too many line endpoints"))?,
                );
            }
            records.push(json!({"line":line+1,"kind":kind,"feedMetresPerSecond":feed,"extrusionMetres":next_extrusion-extrusion}));
        }
        position = next;
        extrusion = next_extrusion;
    }
    let mut primitives = Vec::new();
    for (kind, vertices) in paths.iter().enumerate() {
        if vertices.indices.is_empty() {
            continue;
        }
        let name = ["rapid", "linear", "extrusion"][kind];
        let color = [
            [0.4, 0.4, 0.4, 1.0],
            [0.1, 0.3, 1.0, 1.0],
            [1.0, 0.3, 0.05, 1.0],
        ][kind];
        let mut material = source::material(name, color);
        material["extensions"] = json!({"KHR_materials_unlit":{}});
        let rank = scene.materials.len();
        scene.materials.push(material);
        let mut primitive =
            crate::import::primitive(vertices, &mut scene.bin, &mut scene.accessors, Some(rank));
        primitive["mode"] = json!(1);
        primitives.push(primitive);
    }
    if primitives.is_empty() {
        return Err(source::invalid("gcode", "no tool movement"));
    }
    scene
        .meshes
        .push(json!({"name":"toolpath","primitives":primitives,"extras":{"moves":records}}));
    scene.mesh_triangles.push(0);
    scene.node(json!({"name":"toolpath","mesh":0}));
    Ok(())
}
