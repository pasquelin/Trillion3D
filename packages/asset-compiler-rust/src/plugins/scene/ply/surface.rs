//! The source surface, then a triangle-preserving conversion through the existing n-gon cutter.
use super::*;
use values::Reader;
#[derive(Default)]
struct Vertex {
    position: [f32; 3],
    normal: Option<[f32; 3]>,
    uv: Option<[f32; 2]>,
    color: Option<[f32; 4]>,
}
struct Face {
    corners: Vec<u32>,
    material: Option<usize>,
}
#[derive(Default)]
pub(super) struct Surface {
    vertices: Vec<Vertex>,
    faces: Vec<Face>,
    materials: Vec<[f32; 4]>,
    corners: usize,
}

fn color(value: f64, kind: Scalar, alpha: bool) -> Result<f32> {
    let value = value / kind.color_scale()?;
    if !(0.0..=1.0).contains(&value) {
        return Err(source::invalid("ply", "colour outside [0,1]"));
    }
    Ok(if kind.integral() && !alpha {
        crate::albedo::srgb_component_to_linear(value) as f32
    } else {
        value as f32
    })
}
impl Surface {
    pub(super) fn record(
        &mut self,
        element: &Element,
        reader: &mut Reader<'_>,
        budget: usize,
    ) -> Result<()> {
        if element.name == "face" {
            return self.face(element, reader, budget);
        }
        let mut vertex = Vertex::default();
        let mut material = [1.0; 4];
        for property in &element.properties {
            let value = reader.scalar(property.scalar)?;
            if let Some(axis) = ["red", "green", "blue", "alpha"]
                .iter()
                .position(|n| *n == property.name)
            {
                let component = color(value, property.scalar, axis == 3)?;
                material[axis] = component;
                vertex.color.get_or_insert([1.0; 4])[axis] = component;
                continue;
            }
            let value = source::finite(value, "ply")?;
            if let Some(axis) = ["x", "y", "z"].iter().position(|n| *n == property.name) {
                vertex.position[axis] = value;
            } else if let Some(axis) = ["nx", "ny", "nz"].iter().position(|n| *n == property.name) {
                vertex.normal.get_or_insert([0.0; 3])[axis] = value;
            } else {
                let axis = usize::from(["v", "t", "texture_v"].contains(&property.name.as_str()));
                vertex.uv.get_or_insert([0.0; 2])[axis] = value;
            }
        }
        if element.name == "material" {
            self.materials.push(material);
        } else {
            self.vertices.push(vertex);
        }
        Ok(())
    }
    fn face(&mut self, element: &Element, reader: &mut Reader<'_>, budget: usize) -> Result<()> {
        let mut face = Face {
            corners: Vec::new(),
            material: None,
        };
        for property in &element.properties {
            if let Some(length) = property.list {
                let count = reader.index(length)?;
                // Bound the quadratic work of a single concave polygon; normal meshes have
                // short rings. Larger rings are explicitly refused, never fan-triangulated.
                if !(3..=4096).contains(&count) {
                    return Err(source::unsupported(
                        "ply",
                        "face must contain 3..4096 corners",
                    ));
                }
                self.corners = self
                    .corners
                    .checked_add(count)
                    .ok_or_else(|| source::invalid("ply", "corner count overflow"))?;
                source::admit(self.corners.saturating_mul(256), budget / 2, "ply")?;
                for _ in 0..count {
                    face.corners.push(reader.index(property.scalar)? as u32);
                }
            } else {
                face.material = Some(reader.index(property.scalar)?);
            }
        }
        self.faces.push(face);
        Ok(())
    }
    pub(super) fn emit(self, scene: &mut SceneTables, request: &SceneRequest<'_>) -> Result<()> {
        for (rank, color) in self.materials.iter().enumerate() {
            scene
                .materials
                .push(source::material(&format!("material-{rank}"), *color));
        }
        let mut parts: Vec<(Vertices, Option<usize>)> = Vec::new();
        let mut blended = std::collections::BTreeMap::new();
        let mut cutter = super::super::ngon::Ngon::default();
        for face in &self.faces {
            if face.material.is_some_and(|m| m >= self.materials.len()) {
                return Err(source::invalid("ply", "material index is out of bounds"));
            }
            cutter.begin();
            for &index in &face.corners {
                let vertex = self
                    .vertices
                    .get(index as usize)
                    .ok_or_else(|| source::invalid("ply", "vertex index is out of bounds"))?;
                cutter.corner(vertex.position.map(f64::from));
            }
            match cutter.cut(request.cancelled) {
                None => return Err(super::super::cancel::refusal()),
                Some(false) if face.corners.len() != 3 => {
                    return Err(source::invalid("ply", "polygon has no valid triangulation"))
                }
                Some(_) => {}
            }
            let mut material = face.material;
            if face
                .corners
                .iter()
                .any(|i| self.vertices[*i as usize].color.is_some_and(|c| c[3] < 1.0))
            {
                material = Some(*blended.entry(face.material).or_insert_with(|| {
                    let mut value = face
                        .material
                        .map(|rank| scene.materials[rank].clone())
                        .unwrap_or_else(|| source::material("vertex-colours", [1.; 4]));
                    value["alphaMode"] = json!("BLEND");
                    value["extras"]["sourceMaterial"] = json!(face.material);
                    let rank = scene.materials.len();
                    scene.materials.push(value);
                    rank
                }));
            }
            if parts.last().is_none_or(|part| part.1 != material) {
                parts.push((Vertices::default(), material));
            }
            let out = &mut parts.last_mut().unwrap().0;
            for triangle in cutter.triangles() {
                for corner in triangle {
                    let vertex = &self.vertices[face.corners[*corner] as usize];
                    out.indices.push(
                        u32::try_from(out.count())
                            .map_err(|_| source::invalid("ply", "too many corners"))?,
                    );
                    out.positions.extend(vertex.position);
                    if let Some(normal) = vertex.normal {
                        out.normals.extend(normal);
                    }
                    if let Some(uv) = vertex.uv {
                        out.uvs.extend(uv);
                    }
                    if let Some(color) = vertex.color {
                        out.colors.extend(color);
                    }
                }
            }
        }
        let rank = source::mesh_bounded(scene, "ply-surface", &parts, request)?;
        scene.node(json!({"name":"ply-surface","mesh":rank}));
        scene.count("sourceFaces", self.faces.len());
        Ok(())
    }
}
