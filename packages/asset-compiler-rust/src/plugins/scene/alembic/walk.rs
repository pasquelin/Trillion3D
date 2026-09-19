//! Walking the hierarchy: what each object is, and what it becomes in the scene.
//!
//! An Alembic object names its schema in its metadata. This driver keeps three: `Xform`, which
//! carries a transform, `PolyMesh` and `SubD`, which carry a surface, and `FaceSet`, which names
//! faces of its mesh. Everything else — curves, points, NURBS surfaces, cameras, lamps — is
//! counted on the report under its name: this driver imports static geometry, and what it does
//! not convert, it says rather than hiding. Descent continues under a skipped object: only an
//! `Xform` carries a transform, so nothing is moved by walking through it.
use super::archive::{Archive, Object, MAX_DEPTH};
use super::geom::Geometry;
use super::kind::{kind_of, Kind};
use super::mesh::{parts, FaceSet};
use super::property::{Properties, POD_BOOL, POD_F64, POD_I32, POD_U8};
use super::scene::Scene;
use super::values::{f64s, i32s};
use super::xform;
use crate::Result;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};

/// What a walk has at hand.
pub(super) struct World<'a> {
    pub(super) archive: &'a Archive,
    pub(super) scene: &'a mut Scene,
    pub(super) cancelled: &'a AtomicBool,
}

impl World<'_> {
    /// The top-level properties of an object, those that carry its schema.
    fn top(&self, object: &Object) -> Result<Option<Properties>> {
        match object.group.first().copied() {
            Some(first) => Properties::read(self.archive, first).map(Some),
            None => Ok(None),
        }
    }

    /// Builds the nodes of this object and its descendants, and yields those its parent attaches.
    /// An `Xform` that does not inherit from its parent is a scene root: it keeps its matrix, and
    /// its parent does not count it among its children.
    pub(super) fn visit(&mut self, object: &Object, depth: usize) -> Result<Vec<usize>> {
        if depth > MAX_DEPTH {
            self.scene.report.add("alembic-hierarchy-too-deep");
            return Ok(Vec::new());
        }
        if self.cancelled.load(Ordering::Relaxed) {
            return Ok(Vec::new());
        }
        let kind = kind_of(&object.meta);
        if kind == Kind::FaceSet {
            return Ok(Vec::new());
        }
        let children = self.archive.children(object)?;
        let mut attached = Vec::new();
        for child in &children {
            attached.extend(self.visit(child, depth + 1)?);
        }
        match kind {
            Kind::Xform => self.xform_node(object, attached),
            Kind::Mesh | Kind::SubD => self.mesh_node(object, kind, &children, attached),
            Kind::FaceSet => Ok(Vec::new()),
            Kind::Skipped(reason) => {
                self.scene.report.add(reason);
                Ok(attached)
            }
        }
    }

    /// The node of an `Xform`: its local matrix, and the nodes it attaches.
    fn xform_node(&mut self, object: &Object, children: Vec<usize>) -> Result<Vec<usize>> {
        let mut node = json!({ "name": object.name });
        let mut inherits = true;
        if let Some(properties) = self
            .top(object)?
            .map(|top| top.compound(self.archive, ".xform"))
            .transpose()?
            .flatten()
        {
            let ops = properties.sample(self.archive, ".ops", POD_U8, None)?;
            let values = properties.sample(self.archive, ".vals", POD_F64, None)?;
            self.animated(&properties, ".vals");
            let matrix = xform::matrix(ops.unwrap_or_default(), &f64s(values.unwrap_or_default()))?;
            if matrix != xform::IDENTITY && xform::is_finite(&matrix) {
                node["matrix"] = json!(matrix);
            } else if !xform::is_finite(&matrix) {
                self.scene.report.add("alembic-transform-invalid");
            }
            inherits = properties
                .sample(self.archive, ".inherits", POD_BOOL, Some(1))?
                .and_then(|bytes| bytes.first().copied())
                .is_none_or(|value| value != 0);
        }
        if !children.is_empty() {
            node["children"] = json!(children);
        }
        self.scene.count("xforms", 1);
        let id = self.scene.node(node);
        if inherits {
            return Ok(vec![id]);
        }
        self.scene.report.add("alembic-transform-not-inherited");
        self.scene.roots.push(id);
        Ok(Vec::new())
    }

    /// The node of a mesh: its surface split by its face sets, and what it attaches.
    fn mesh_node(
        &mut self,
        object: &Object,
        kind: Kind,
        children: &[Object],
        attached: Vec<usize>,
    ) -> Result<Vec<usize>> {
        if kind == Kind::SubD {
            self.scene.report.add("alembic-subd-as-polygons");
        }
        let Some(geom) = self
            .top(object)?
            .map(|top| top.compound(self.archive, ".geom"))
            .transpose()?
            .flatten()
        else {
            self.scene.report.add("alembic-mesh-invalid");
            return Ok(attached);
        };
        self.animated(&geom, "P");
        let Some(geometry) = Geometry::read(self.archive, &geom)? else {
            self.scene.report.add("alembic-mesh-invalid");
            return Ok(attached);
        };
        for reason in &geometry.dropped {
            self.scene.report.add(reason);
        }
        if geometry.normals.is_none() {
            self.scene.report.add("alembic-normals-missing");
        }
        let facesets = self.facesets(children)?;
        let (parts, counted) = parts(&geometry, &facesets, self.cancelled)?;
        self.scene
            .report
            .add_count("alembic-face-in-two-facesets", counted.overlaps);
        self.scene
            .report
            .add_count("alembic-degenerate-face", counted.degenerate);
        self.scene
            .report
            .add_count("alembic-ngon-untriangulable", counted.uncut);
        if parts.is_empty() {
            self.scene.report.add("alembic-mesh-empty");
            return Ok(attached);
        }
        let mesh = self.scene.mesh(&object.name, &parts, &facesets);
        let mut node = json!({ "name": object.name, "mesh": mesh });
        if !attached.is_empty() {
            node["children"] = json!(attached);
        }
        self.scene.count("meshInstances", 1);
        self.scene.count("faceSets", facesets.len());
        Ok(vec![self.scene.node(node)])
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
                self.scene.report.add("alembic-faceset-invalid");
                continue;
            };
            out.push(FaceSet {
                name: child.name.clone(),
                faces: i32s(faces),
            });
        }
        Ok(out)
    }

    /// A property with several samples is animated: this driver reads the first and says so.
    fn animated(&mut self, properties: &Properties, name: &str) {
        if properties.find(name).is_some_and(|found| found.samples > 1) {
            self.scene.report.add("alembic-animation-ignored");
        }
    }
}
