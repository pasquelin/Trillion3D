//! The intermediate scene under construction, and its writing into the cache.
//!
//! Alembic carries neither image, texture, nor shading network: a face set names a material,
//! without saying anything about it. The tables written here are therefore those of geometry
//! alone — nodes, meshes, neutral materials, accessors — and a mesh whose bytes are those of a
//! mesh already written is not written twice: a file that repeats the same object weighs only
//! once in the scene, and its repetitions are only nodes.
use self::write::digest;
use super::mesh::{FaceSet, Part};
use super::*;
use crate::import::materials::UNDECLARED_SURFACE;
use crate::import::{primitive, SceneTables};
use std::collections::HashMap;

mod write;

/// The glTF tables being written — every driver's `SceneTables` — and what makes a repeated
/// material or mesh one entry.
pub(super) struct Scene {
    pub(super) tables: SceneTables,
    /// The material of each face-set name: two meshes that name the same one share it.
    material_ids: HashMap<String, usize>,
    /// The mesh of each content digest: repeated geometry is written only once.
    mesh_ids: HashMap<String, usize>,
}

impl Scene {
    /// An empty scene, whose cache key starts from the driver's name and version.
    pub(super) fn new(plugin: &dyn ScenePlugin) -> Scene {
        Scene {
            tables: SceneTables::new(plugin),
            material_ids: HashMap::new(),
            mesh_ids: HashMap::new(),
        }
    }

    /// The material this face set names. Alembic carries no shading network: the material is
    /// neutral, and only its name comes from the file. Inventing a colour for it would add what
    /// the source does not have.
    fn material(&mut self, name: &str) -> usize {
        if let Some(known) = self.material_ids.get(name) {
            return *known;
        }
        self.tables
            .materials
            .push(json!({"name": name, "pbrMetallicRoughness": {
            "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
            "metallicFactor": UNDECLARED_SURFACE[0], "roughnessFactor": UNDECLARED_SURFACE[1]}}));
        let id = self.tables.materials.len() - 1;
        self.material_ids.insert(name.to_string(), id);
        id
    }

    /// Writes a mesh and yields its rank, or yields that of a mesh with the same bytes.
    pub(super) fn mesh(&mut self, name: &str, parts: &[Part], facesets: &[FaceSet]) -> usize {
        let digest = digest(parts, facesets);
        if let Some(known) = self.mesh_ids.get(&digest).copied() {
            self.tables.count("instancedMeshes", 1);
            return known;
        }
        let mut primitives = Vec::new();
        let mut triangles = 0;
        for part in parts {
            let material = part
                .faceset
                .and_then(|rank| facesets.get(rank))
                .map(|faceset| self.material(&faceset.name));
            triangles += part.vertices.indices.len() / 3;
            // An attribute absent from the source stays absent from glTF: nothing is computed in
            // place of what the file did not write.
            primitives.push(primitive(
                &part.vertices,
                &mut self.tables.bin,
                &mut self.tables.accessors,
                material,
            ));
        }
        self.tables
            .meshes
            .push(json!({"name": name, "primitives": primitives}));
        self.tables.mesh_triangles.push(triangles);
        let id = self.tables.meshes.len() - 1;
        self.mesh_ids.insert(digest, id);
        id
    }
}
