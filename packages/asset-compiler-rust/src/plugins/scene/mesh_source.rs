//! Common bounded input and glTF publication for documented surface-file readers.
//! Format parsing remains in each plugin; cache, provenance and emission use the existing tables.
use super::*;
use crate::import::{SceneTables, Vertices};
use std::{fs::File, io::Read};

pub(super) struct FilePlugin {
    pub name: &'static str,
    pub version: &'static str,
    pub extensions: &'static [&'static str],
    pub magic: &'static [u8],
    pub read: fn(&[u8], &SceneRequest<'_>, &mut SceneTables) -> Result<()>,
}

impl Plugin for FilePlugin {
    fn name(&self) -> &'static str {
        self.name
    }
    fn version(&self) -> &'static str {
        self.version
    }
    fn extensions(&self) -> &'static [&'static str] {
        self.extensions
    }
}

impl ScenePlugin for FilePlugin {
    fn accepts_head(&self, head: &[u8]) -> bool {
        !self.magic.is_empty() && head.starts_with(self.magic)
    }
    fn prepare(&self, request: &SceneRequest<'_>) -> Result<PreparedScene> {
        let started = Instant::now();
        let file = super::archive::only_input(request, self)?;
        super::archive::check(request)?;
        // Parsing and glTF emission coexist with the input. Reserve seven eighths
        // for decoded tables and output; this is admission, not an RSS guarantee.
        let limit = request.ram_budget / 8;
        let mut bytes = Vec::new();
        File::open(file)?
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)?;
        admit(bytes.len(), limit, self.name)?;
        let mut scene = SceneTables::new(self);
        scene.read_file(
            &file.file_name().unwrap_or_default().to_string_lossy(),
            bytes.len(),
            &crate::hash(&bytes),
        );
        (self.read)(&bytes, request, &mut scene)?;
        let output = super::finish(
            scene,
            request,
            self,
            file,
            started,
            &format!("{}: no polygonal surface", self.name),
        )?;
        Ok(request.converted(output))
    }
}

pub(super) fn invalid(format: &str, message: impl std::fmt::Display) -> CompilerError {
    CompilerError::new("IMPORT_INVALID", format!("{format}: {message}"))
}

pub(super) fn unsupported(format: &str, what: impl std::fmt::Display) -> CompilerError {
    CompilerError::new("IMPORT_UNSUPPORTED", format!("{format}: {what}"))
}

pub(super) fn admit(bytes: usize, limit: usize, format: &str) -> Result<()> {
    if bytes > limit {
        return Err(CompilerError::new(
            "IMPORT_OUT_OF_MEMORY",
            format!("{format}: {bytes} bytes exceeds the {limit} byte admission limit"),
        ));
    }
    Ok(())
}

pub(super) fn finite(value: f64, format: &str) -> Result<f32> {
    let converted = value as f32;
    if !value.is_finite() || !converted.is_finite() {
        return Err(invalid(format, "non-finite or out-of-range coordinate"));
    }
    Ok(converted)
}

/// Source order and authored material ranks are retained, even for equal material values.
pub(super) fn mesh(
    scene: &mut SceneTables,
    name: &str,
    parts: &[(Vertices, Option<usize>)],
) -> Result<usize> {
    let mut primitives = Vec::new();
    let mut triangles = 0;
    let mut derived = std::collections::BTreeMap::new();
    for (vertices, material) in parts {
        let material = surface::alpha(scene, vertices, *material, &mut derived);
        if let Some((primitive, count)) = scene.part_primitive(vertices, material) {
            triangles += count;
            primitives.push(primitive);
        }
    }
    if primitives.is_empty() {
        return Err(invalid(name, "mesh carries no triangles"));
    }
    let rank = scene.meshes.len();
    scene
        .meshes
        .push(json!({"name":name,"primitives":primitives}));
    scene.mesh_triangles.push(triangles);
    Ok(rank)
}

pub(super) fn material(name: &str, color: [f32; 4]) -> Value {
    json!({"name":name,"pbrMetallicRoughness":{"baseColorFactor":color,"metallicFactor":0,"roughnessFactor":1},"alphaMode":if color[3] < 1.0 { "BLEND" } else { "OPAQUE" }})
}

#[cfg(test)]
pub(super) mod test_support;

/// Display-encoded RGB (STL colour extensions/3MF); opacity is not colour-encoded.
pub(super) fn linear_color(mut color: [f32; 4]) -> [f32; 4] {
    for channel in &mut color[..3] {
        *channel = crate::albedo::srgb_component_to_linear(*channel as f64) as f32;
    }
    color
}

pub(super) mod xml;

mod surface;
pub(super) use surface::bounded as mesh_bounded;
