//! A mesh object in the scene: its surface split by its face sets, and the node that carries it.
use super::super::archive::Object;
use super::super::geom::Geometry;
use super::super::kind::{kind_of, Kind};
use super::super::mesh::{parts, FaceSet};
use super::super::property::POD_I32;
use super::World;
use crate::support::le::words;
use crate::Result;
use serde_json::json;

impl World<'_> {
    /// The node of a mesh: its surface split by its face sets, and what it attaches.
    pub(super) fn mesh_node(
        &mut self,
        object: &Object,
        kind: Kind,
        children: &[Object],
        attached: Vec<usize>,
    ) -> Result<Vec<usize>> {
        if kind == Kind::SubD {
            self.scene.tables.report.add("alembic-subd-as-polygons");
        }
        let Some(geom) = self
            .top(object)?
            .map(|top| top.compound(self.archive, ".geom"))
            .transpose()?
            .flatten()
        else {
            self.scene
                .tables
                .report
                .add(crate::plugins::scene::codes::MESH_INVALID);
            return Ok(attached);
        };
        self.animated(&geom, "P");
        let Some(geometry) = Geometry::read(self.archive, &geom)? else {
            self.scene
                .tables
                .report
                .add(crate::plugins::scene::codes::MESH_INVALID);
            return Ok(attached);
        };
        for reason in &geometry.dropped {
            self.scene.tables.report.add(reason);
        }
        if geometry.normals.is_none() {
            self.scene.tables.report.add("alembic-normals-missing");
        }
        let facesets = self.facesets(children)?;
        let (parts, counted) = parts(&geometry, &facesets, self.cancelled)?;
        self.scene
            .tables
            .report
            .add_count("alembic-face-in-two-facesets", counted.overlaps);
        self.scene.tables.report.add_count(
            crate::plugins::scene::codes::DEGENERATE_FACE,
            counted.degenerate,
        );
        self.scene
            .tables
            .report
            .add_count(crate::plugins::scene::codes::NGON_UNCUT, counted.uncut);
        if parts.is_empty() {
            self.scene
                .tables
                .report
                .add(crate::plugins::scene::codes::MESH_EMPTY);
            return Ok(attached);
        }
        let mesh = self.scene.mesh(&object.name, &parts, &facesets);
        let mut node = json!({ "name": object.name, "mesh": mesh });
        if !attached.is_empty() {
            node["children"] = json!(attached);
        }
        self.scene.tables.count("meshInstances", 1);
        self.scene.tables.count("faceSets", facesets.len());
        Ok(vec![self.scene.tables.node(node)])
    }

    /// The face sets of a mesh, in the order the file declares them.
    fn facesets(&mut self, children: &[Object]) -> Result<Vec<FaceSet>> {
        let mut out = Vec::new();
        for child in children
            .iter()
            .filter(|c| kind_of(&c.meta) == Kind::FaceSet)
        {
            let Some(faces) = self
                .top(child)?
                .map(|top| top.compound(self.archive, ".faceset"))
                .transpose()?
                .flatten()
                .map(|properties| properties.sample(self.archive, ".faces", POD_I32, Some(1)))
                .transpose()?
                .flatten()
            else {
                self.scene.tables.report.add("alembic-faceset-invalid");
                continue;
            };
            out.push(FaceSet {
                name: child.name.clone(),
                faces: words(faces, i32::from_le_bytes).collect(),
            });
        }
        Ok(out)
    }
}
