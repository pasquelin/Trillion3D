//! A curves object in the scene: the node that carries its strands, and the attributes a groom
//! declares for the whole of it.
use super::super::archive::{Archive, Object};
use super::super::curves::{self, floats};
use super::super::kind::Kind;
use super::super::property::Properties;
use super::{Declared, World};
use crate::hair_strands::finite_width;
use crate::plugins::scene::codes::CURVES_TRUNCATED;
use crate::Result;
use serde_json::json;

/// The groom's width, when the properties `props` hold one: a single float, written once or as an
/// array of one value, of single or double precision, and finite.
fn width_of(archive: &Archive, props: &Properties) -> Result<Option<f32>> {
    let single = |pod: u32, bytes: &[u8]| match floats(pod, bytes)?[..] {
        [width] => Some(width),
        _ => None,
    };
    Ok(props
        .decoded(archive, "groom_width", 1, single)?
        .and_then(|width| finite_width(f64::from(width))))
}

impl World<'_> {
    /// What the groom declares for a curves object whose top-level properties are `own`, as the
    /// groom's attributes are read from the top down: the first `Xform` above it that has user
    /// properties — else arbitrary geometry parameters — declares them, and so no object below it
    /// does; if none does, the object's own user properties may. `None` when the one that declares
    /// gives no width, or none declares.
    fn declared_width(&mut self, own: Option<&Properties>) -> Result<Option<f32>> {
        for at in 0..self.chain.len() {
            if matches!(self.chain[at].declared, Declared::Unread) {
                let top = self.properties(self.chain[at].top)?;
                self.chain[at].declared = self.declaration(top.as_ref(), Kind::Xform)?;
            }
            if let Declared::Attributes(width) = self.chain[at].declared {
                return Ok(width);
            }
        }
        match self.declaration(own, Kind::Curves)? {
            Declared::Attributes(width) => Ok(width),
            _ => Ok(None),
        }
    }

    /// What the object whose top-level properties are `top` declares: those of an `Xform` are its
    /// user properties, else its arbitrary geometry parameters; a curves object's, its user
    /// properties.
    fn declaration(&self, top: Option<&Properties>, kind: Kind) -> Result<Declared> {
        let (schema, names): (&str, &[&str]) = match kind {
            Kind::Xform => (".xform", &[".userProperties", ".arbGeomParams"]),
            _ => (".geom", &[".userProperties"]),
        };
        let Some(schema) = top
            .map(|top| top.compound(self.archive, schema))
            .transpose()?
            .flatten()
        else {
            return Ok(Declared::Nothing);
        };
        for name in names {
            let Some(props) = schema.compound(self.archive, name)? else {
                continue;
            };
            if !props.is_empty() {
                return Ok(Declared::Attributes(width_of(self.archive, &props)?));
            }
        }
        Ok(Declared::Nothing)
    }

    /// The node of a curves object: its strands, written in the scene's binary and cited from the
    /// node's extensions, and what it attaches. An object that carries no strand — no `.geom`, no
    /// point, no curve — brings no node and counts nothing.
    pub(super) fn curves_node(
        &mut self,
        object: &Object,
        attached: Vec<usize>,
    ) -> Result<Vec<usize>> {
        let top = self.top(object)?;
        let width = self.declared_width(top.as_ref())?;
        let Some(geom) = top
            .map(|top| top.compound(self.archive, ".geom"))
            .transpose()?
            .flatten()
        else {
            return Ok(attached);
        };
        self.animated(&geom, "P");
        let (groom, truncated) = curves::read(self.archive, &geom, width)?;
        if truncated {
            self.scene.tables.report.add(CURVES_TRUNCATED);
        }
        let Some(groom) = groom else {
            return Ok(attached);
        };
        let mut node =
            json!({ "name": object.name, "extensions": self.scene.tables.strands(&groom) });
        if !attached.is_empty() {
            node["children"] = json!(attached);
        }
        self.scene.tables.count("strands", groom.counts.len());
        Ok(vec![self.scene.tables.node(node)])
    }
}
