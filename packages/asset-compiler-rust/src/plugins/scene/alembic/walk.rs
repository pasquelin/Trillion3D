//! Walking the hierarchy: what each object is, and what it becomes in the scene.
//!
//! An Alembic object names its schema in its metadata. This driver keeps three: `Xform`, which
//! carries a transform, `PolyMesh` and `SubD`, which carry a surface, and `FaceSet`, which names
//! faces of its mesh. Everything else — curves, points, NURBS surfaces, cameras, lamps — is
//! counted on the report under its name: this driver imports static geometry, and what it does
//! not convert, it says rather than hiding. Descent continues under a skipped object: only an
//! `Xform` carries a transform, so nothing is moved by walking through it.
use super::archive::{Archive, Object, MAX_DEPTH};
use super::kind::{kind_of, Kind};
use super::property::{Properties, POD_BOOL, POD_F64, POD_U8};
use super::scene::Scene;
use super::xform;
use crate::le::words;
use crate::Result;
use serde_json::json;
use std::sync::atomic::AtomicBool;

mod surface;

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
            self.scene
                .tables
                .report
                .add(crate::plugins::scene::codes::HIERARCHY_TOO_DEEP);
            return Ok(Vec::new());
        }
        if crate::plugins::scene::cancel::raised(self.cancelled) {
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
                self.scene.tables.report.add(reason);
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
            let matrix = xform::matrix(
                ops.unwrap_or_default(),
                &words(values.unwrap_or_default(), f64::from_le_bytes).collect::<Vec<_>>(),
            )?;
            let report = &mut self.scene.tables.report;
            if let Some(matrix) = crate::plugins::scene::axes::node_matrix(matrix, report) {
                node["matrix"] = json!(matrix);
            }
            inherits = properties
                .sample(self.archive, ".inherits", POD_BOOL, Some(1))?
                .and_then(|bytes| bytes.first().copied())
                .is_none_or(|value| value != 0);
        }
        if !children.is_empty() {
            node["children"] = json!(children);
        }
        self.scene.tables.count("xforms", 1);
        let id = self.scene.tables.node(node);
        if inherits {
            return Ok(vec![id]);
        }
        // Attached by no parent, the node is a scene root (`SceneTables` roots: nodes no other cites).
        self.scene
            .tables
            .report
            .add("alembic-transform-not-inherited");
        Ok(Vec::new())
    }

    /// A property with several samples is animated: this driver reads the first and says so.
    fn animated(&mut self, properties: &Properties, name: &str) {
        if properties.find(name).is_some_and(|found| found.samples > 1) {
            self.scene.tables.report.add("alembic-animation-ignored");
        }
    }
}
