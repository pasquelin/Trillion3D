//! Face emission uses the shared scene tables; a quad retains its source diagonal and order.
use super::*;
use crate::shared_math::{cross, sub, unit};
impl Reader<'_, '_> {
    pub(super) fn geometry(
        &mut self,
        name: &str,
        faces: &[parser::Face],
        inherited: &str,
        inverted: bool,
        double: bool,
        scene: &mut SceneTables,
    ) -> Result<Option<usize>> {
        let mut parts: Vec<(Vertices, Option<usize>)> = Vec::new();
        for face in faces {
            let code = if face.color == "16" {
                inherited
            } else {
                &face.color
            };
            let sided = double || face.double;
            let definition = self.colors.material(code)?;
            let material_key = format!("{code}/{sided}/{definition}");
            let material = if let Some(rank) = self.materials.get(&material_key) {
                *rank
            } else {
                let mut material = definition;
                material["doubleSided"] = json!(sided);
                material["extras"] = json!({"ldrawColour":code});
                let rank = scene.materials.len();
                scene.materials.push(material);
                self.materials.insert(material_key, rank);
                rank
            };
            if parts.last().is_none_or(|p| p.1 != Some(material)) {
                parts.push((Vertices::default(), Some(material)));
            }
            let vertices = &mut parts.last_mut().unwrap().0;
            for i in 1..face.points.len() - 1 {
                super::super::archive::check(self.request)?;
                self.payload = self.payload.saturating_add(84);
                source::admit(self.payload, self.request.ram_budget / 4, "ldraw")?;
                let indices = if face.reverse ^ inverted {
                    [0, i + 1, i]
                } else {
                    [0, i, i + 1]
                };
                let [a, b, c] = indices.map(|n| face.points[n]);
                let normal = unit(cross(sub(b, a), sub(c, a))).unwrap_or([0.; 3]);
                for p in [a, b, c] {
                    vertices.indices.push(vertices.count() as u32);
                    for v in p {
                        vertices.positions.push(source::finite(v, "ldraw")?);
                    }
                    vertices.normals.extend(normal.map(|v| v as f32));
                }
            }
        }
        if parts.is_empty() {
            Ok(None)
        } else {
            source::mesh(scene, name, &parts).map(Some)
        }
    }
}
