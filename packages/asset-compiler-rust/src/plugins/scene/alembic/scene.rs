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
use crate::import::{primitive, Bin, Report};
use std::collections::{BTreeMap, HashMap};

mod write;

/// Roughness factor of a material with no shading network: a diffuse surface, neither metal nor mirror.
const NEUTRAL: [f64; 2] = [0.0, 1.0];

/// The glTF tables being written.
#[derive(Default)]
pub(super) struct Scene {
    pub(super) nodes: Vec<Value>,
    pub(super) meshes: Vec<Value>,
    /// Triangle count of each mesh, by rank of `meshes`.
    mesh_triangles: Vec<usize>,
    pub(super) materials: Vec<Value>,
    accessors: Vec<Value>,
    bin: Bin,
    pub(super) report: Report,
    /// What the report publishes in the clear: objects, meshes, face sets, counted refusals.
    pub(super) counts: BTreeMap<&'static str, usize>,
    /// Scene roots, in the order the walk found them.
    pub(super) roots: Vec<usize>,
    /// The material of each face-set name: two meshes that name the same one share it.
    material_ids: HashMap<String, usize>,
    /// The mesh of each content digest: repeated geometry is written only once.
    mesh_ids: HashMap<String, usize>,
    /// Mesh-carrying nodes and their triangles, tracked as they are posed.
    pub(super) instanced: (usize, usize),
    key_material: String,
}

impl Scene {
    /// An empty scene, whose cache key starts from the driver's name and version.
    pub(super) fn new(plugin: &dyn ScenePlugin) -> Scene {
        Scene {
            key_material: format!("{}:{}", plugin.name(), plugin.version()),
            ..Scene::default()
        }
    }

    pub(super) fn count(&mut self, what: &'static str, by: usize) {
        *self.counts.entry(what).or_insert(0) += by;
    }

    /// Adds a node and yields its rank. A mesh-carrying node also counts its triangles: the same
    /// geometry posed twice weighs twice in what the engine will display.
    pub(super) fn node(&mut self, node: Value) -> usize {
        if let Some(mesh) = node["mesh"].as_u64() {
            self.instanced.0 += 1;
            self.instanced.1 += self.mesh_triangles[mesh as usize];
        }
        self.nodes.push(node);
        self.nodes.len() - 1
    }

    /// The material this face set names. Alembic carries no shading network: the material is
    /// neutral, and only its name comes from the file. Inventing a colour for it would add what
    /// the source does not have.
    fn material(&mut self, name: &str) -> usize {
        if let Some(known) = self.material_ids.get(name) {
            return *known;
        }
        self.materials
            .push(json!({"name": name, "pbrMetallicRoughness": {
            "baseColorFactor": [1.0, 1.0, 1.0, 1.0],
            "metallicFactor": NEUTRAL[0], "roughnessFactor": NEUTRAL[1]}}));
        let id = self.materials.len() - 1;
        self.material_ids.insert(name.to_string(), id);
        id
    }

    /// Writes a mesh and yields its rank, or yields that of a mesh with the same bytes.
    pub(super) fn mesh(&mut self, name: &str, parts: &[Part], facesets: &[FaceSet]) -> usize {
        let digest = digest(parts, facesets);
        if let Some(known) = self.mesh_ids.get(&digest).copied() {
            self.count("instancedMeshes", 1);
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
                &mut self.bin,
                &mut self.accessors,
                material,
            ));
        }
        self.meshes
            .push(json!({"name": name, "primitives": primitives}));
        self.mesh_triangles.push(triangles);
        let id = self.meshes.len() - 1;
        self.mesh_ids.insert(digest, id);
        id
    }

    /// Notes a file read: its name, size and digest enter the cache key.
    pub(super) fn read_file(&mut self, name: &str, bytes: usize, digest: &str) {
        self.key_material
            .push_str(&format!("\n{name}:{bytes}:{digest}"));
    }
}
