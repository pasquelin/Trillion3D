//! VRML per-vertex/per-face bindings resolve before triangulation, retaining corner seams.
use super::*;
pub(super) fn indices(values: Vec<f64>) -> Result<Vec<Vec<usize>>> {
    let mut faces = Vec::new();
    let mut face = Vec::new();
    for value in values {
        if value == -1. {
            if face.is_empty() {
                return Err(source::invalid("vrml", "empty index face"));
            }
            faces.push(std::mem::take(&mut face));
        } else if value < 0. || value.fract() != 0. || value > u32::MAX as f64 {
            return Err(source::invalid("vrml", "invalid index"));
        } else {
            face.push(value as usize);
        }
    }
    if !face.is_empty() {
        faces.push(face);
    }
    Ok(faces)
}
pub(super) struct Attribute {
    values: Vec<f64>,
    indices: Vec<Vec<usize>>,
    width: usize,
    per_vertex: bool,
}
impl Attribute {
    pub fn new(
        node: &document::Node,
        document: &document::Document,
        field: &str,
        kind: &str,
        value: &str,
        width: usize,
    ) -> Result<Option<Self>> {
        let Some(id) = node.child(field)? else {
            return Ok(None);
        };
        let attribute = &document.nodes[id];
        if attribute.kind != kind {
            return Err(source::invalid("vrml", format!("expected {kind}")));
        }
        attribute.fields(&[value])?;
        let values = attribute.numbers(value)?;
        if values.len() % width != 0 {
            return Err(source::invalid("vrml", "attribute component count"));
        }
        let per_vertex = if field == "texCoord" {
            true
        } else {
            node.boolean(&format!("{field}PerVertex"), true)?
        };
        let indices = indices(node.numbers(&format!("{field}Index"))?)?;
        Ok(Some(Self {
            values,
            indices,
            width,
            per_vertex,
        }))
    }
    pub fn corner(&self, face: usize, corner: usize, coordinate: usize) -> Result<&[f64]> {
        let index = if self.indices.is_empty() {
            if self.per_vertex {
                coordinate
            } else {
                face
            }
        } else if self.per_vertex {
            *self
                .indices
                .get(face)
                .and_then(|v| v.get(corner))
                .ok_or_else(|| source::invalid("vrml", "missing corner attribute index"))?
        } else {
            *self
                .indices
                .first()
                .and_then(|v| v.get(face))
                .ok_or_else(|| source::invalid("vrml", "missing face attribute index"))?
        };
        self.values
            .get(index * self.width..(index + 1) * self.width)
            .ok_or_else(|| source::invalid("vrml", "attribute index out of bounds"))
    }
}

/// Coordinate data is identical for face and line geometries.
pub(super) fn positions(node: &document::Node, document: &document::Document) -> Result<Vec<f64>> {
    let coord = node
        .child("coord")?
        .ok_or_else(|| source::invalid("vrml", "geometry without coord"))?;
    let coord = &document.nodes[coord];
    if coord.kind != "Coordinate" {
        return Err(source::invalid("vrml", "expected Coordinate"));
    }
    coord.fields(&["point"])?;
    let positions = coord.numbers("point")?;
    if positions.len() % 3 != 0 {
        return Err(source::invalid("vrml", "coordinate component count"));
    }
    Ok(positions)
}
