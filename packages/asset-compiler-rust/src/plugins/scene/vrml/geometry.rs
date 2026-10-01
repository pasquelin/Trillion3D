//! IndexedFaceSet uses the existing polygon cutter; explicit normals and corner attributes survive.
use super::attributes::{indices, positions, Attribute};
use super::*;
use crate::shared_math::unit;
impl Reader<'_, '_> {
    pub(super) fn geometry(
        &mut self,
        id: usize,
        material: usize,
        scene: &mut SceneTables,
    ) -> Result<usize> {
        let node = &self.document.nodes[id];
        if node.kind == "IndexedLineSet" {
            return super::lines::geometry(node, &self.document, material, self.request, scene);
        }
        if node.kind != "IndexedFaceSet" {
            return Err(source::unsupported(
                "vrml",
                format!("geometry {}", node.kind),
            ));
        }
        node.fields(&[
            "coord",
            "coordIndex",
            "color",
            "colorIndex",
            "colorPerVertex",
            "normal",
            "normalIndex",
            "normalPerVertex",
            "texCoord",
            "texCoordIndex",
            "ccw",
            "solid",
            "convex",
            "creaseAngle",
        ])?;
        let positions = positions(node, &self.document)?;
        let faces = indices(node.numbers("coordIndex")?)?;
        let normals = Attribute::new(node, &self.document, "normal", "Normal", "vector", 3)?;
        let colors = Attribute::new(node, &self.document, "color", "Color", "color", 3)?;
        let uvs = Attribute::new(
            node,
            &self.document,
            "texCoord",
            "TextureCoordinate",
            "point",
            2,
        )?;
        let [crease] = node.number_array("creaseAngle", [0.])?;
        if crease < 0. {
            return Err(source::invalid("vrml", "negative creaseAngle"));
        }
        let generated = if normals.is_none() {
            Some(super::smoothing::generate(
                &positions,
                &faces,
                crease,
                self.request,
            )?)
        } else {
            None
        };
        let default_uv = super::texture::default_uv(&positions);
        let textured = scene.materials[material]["pbrMetallicRoughness"]
            .get("baseColorTexture")
            .is_some();
        let ccw = node.boolean("ccw", true)?;
        scene.materials[material]["doubleSided"] = json!(!node.boolean("solid", true)?);
        if colors.is_some() {
            scene.materials[material]["pbrMetallicRoughness"]["baseColorFactor"][0] = json!(1.);
            scene.materials[material]["pbrMetallicRoughness"]["baseColorFactor"][1] = json!(1.);
            scene.materials[material]["pbrMetallicRoughness"]["baseColorFactor"][2] = json!(1.);
        }
        let mut out = Vertices::default();
        let mut cutter = super::super::ngon::Ngon::default();
        for (face_rank, face) in faces.iter().enumerate() {
            super::super::archive::check(self.request)?;
            if face.len() < 3 {
                return Err(source::invalid("vrml", "face has fewer than three corners"));
            }
            let points = face
                .iter()
                .map(|i| {
                    positions
                        .get(i * 3..i * 3 + 3)
                        .map(|p| [p[0], p[1], p[2]])
                        .ok_or_else(|| source::invalid("vrml", "coordinate index out of bounds"))
                })
                .collect::<Result<Vec<_>>>()?;
            cutter.begin();
            for point in &points {
                cutter.corner(*point);
            }
            if !cutter.cut(self.request.cancelled).ok_or_else(|| {
                crate::CompilerError::new(crate::CANCELLED, "Compilation cancelled")
            })? {
                return Err(source::invalid(
                    "vrml",
                    "degenerate or self-intersecting face",
                ));
            }
            for triangle in cutter.triangles() {
                self.payload = self.payload.saturating_add(132);
                source::admit(self.payload, self.request.ram_budget / 4, "vrml")?;
                let [a, b, c] = if ccw {
                    *triangle
                } else {
                    [triangle[0], triangle[2], triangle[1]]
                };
                for corner in [a, b, c] {
                    out.indices.push(out.count() as u32);
                    for v in points[corner] {
                        out.positions.push(source::finite(v, "vrml")?);
                    }
                    if let Some(normals) = &normals {
                        let n = normals.corner(face_rank, corner, face[corner])?;
                        let n = unit([n[0], n[1], n[2]])
                            .ok_or_else(|| source::invalid("vrml", "zero normal"))?;
                        out.normals.extend(n.map(|v| v as f32));
                    } else {
                        out.normals
                            .extend(generated.as_ref().unwrap()[face_rank][corner].map(|v| {
                                if ccw {
                                    v
                                } else {
                                    -v
                                }
                            }));
                    }
                    if let Some(colors) = &colors {
                        for v in colors.corner(face_rank, corner, face[corner])? {
                            if !(0. ..=1.).contains(v) {
                                return Err(source::invalid("vrml", "colour outside [0,1]"));
                            }
                            out.colors.push(*v as f32);
                        }
                        out.colors.push(1.);
                    }
                    if let Some(uvs) = &uvs {
                        for v in uvs.corner(face_rank, corner, face[corner])? {
                            out.uvs.push(source::finite(*v, "vrml")?);
                        }
                    } else if textured {
                        let (axes, min, extent) = default_uv;
                        for axis in axes {
                            out.uvs.push(source::finite(
                                (points[corner][axis] - min[axis]) / extent,
                                "vrml",
                            )?);
                        }
                    }
                }
            }
        }
        source::mesh(
            scene,
            node.name.as_deref().unwrap_or("IndexedFaceSet"),
            &[(out, Some(material))],
        )
    }
}
