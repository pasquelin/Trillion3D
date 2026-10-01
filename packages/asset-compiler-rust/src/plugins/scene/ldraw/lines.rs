//! Real line primitives; conditional segments retain their projection controls as custom accessors.
use super::*;
impl Reader<'_, '_> {
    pub(super) fn lines(
        &mut self,
        name: &str,
        lines: &[parser::Line],
        inherited: &str,
        mesh: Option<usize>,
        scene: &mut SceneTables,
    ) -> Result<Option<usize>> {
        if lines.is_empty() {
            return Ok(mesh);
        }
        let mesh = mesh.unwrap_or_else(|| {
            let rank = scene.meshes.len();
            scene.meshes.push(json!({"name":name,"primitives":[]}));
            scene.mesh_triangles.push(0);
            rank
        });
        let mut ordinary: BTreeMap<usize, Vertices> = BTreeMap::new();
        for line in lines {
            super::super::archive::check(self.request)?;
            self.payload = self.payload.saturating_add(128);
            source::admit(self.payload, self.request.ram_budget / 4, "ldraw")?;
            let code = if line.color == "16" {
                inherited
            } else {
                &line.color
            };
            let mut material = if code == "24" {
                self.colors.edge(inherited)?
            } else {
                self.colors.material(code)?
            };
            material["extensions"] = json!({"KHR_materials_unlit":{}});
            let key = format!("line/{material}");
            let rank = if let Some(rank) = self.materials.get(&key) {
                *rank
            } else {
                let rank = scene.materials.len();
                scene.materials.push(material);
                self.materials.insert(key, rank);
                rank
            };
            let points = line.points[..2]
                .iter()
                .flatten()
                .map(|v| source::finite(*v, "ldraw"))
                .collect::<Result<Vec<_>>>()?;
            if line.points.len() == 2 {
                let vertices = ordinary.entry(rank).or_default();
                let offset = vertices.count() as u32;
                vertices.indices.extend([offset, offset + 1]);
                vertices.positions.extend(points);
            } else {
                let vertices = Vertices {
                    positions: points,
                    indices: vec![0, 1],
                    ..Default::default()
                };
                let mut primitive = emit(&vertices, rank, scene);
                for (i, point) in line.points[2..].iter().enumerate() {
                    let values = point
                        .iter()
                        .cycle()
                        .take(6)
                        .map(|v| source::finite(*v, "ldraw"))
                        .collect::<Result<Vec<_>>>()?;
                    let view = scene
                        .bin
                        .view(&crate::import::f32_bytes(&values), Some(34962));
                    let accessor = scene.accessors.len();
                    scene.accessors.push(
                        json!({"bufferView":view,"componentType":5126,"count":2,"type":"VEC3"}),
                    );
                    primitive["attributes"][format!("_LDRAW_CONTROL{i}")] = json!(accessor);
                }
                scene.meshes[mesh]["primitives"]
                    .as_array_mut()
                    .unwrap()
                    .push(primitive);
            }
        }
        for (rank, vertices) in ordinary {
            let primitive = emit(&vertices, rank, scene);
            scene.meshes[mesh]["primitives"]
                .as_array_mut()
                .unwrap()
                .push(primitive);
        }
        Ok(Some(mesh))
    }
}
fn emit(vertices: &Vertices, material: usize, scene: &mut SceneTables) -> serde_json::Value {
    let mut primitive = crate::import::primitive(
        vertices,
        &mut scene.bin,
        &mut scene.accessors,
        Some(material),
    );
    primitive["mode"] = json!(1);
    primitive
}
