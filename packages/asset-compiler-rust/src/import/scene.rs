use super::*;

impl<'a> Importer<'a> {
    pub(super) fn check(&self) -> Result<()> {
        if self.cancelled.load(Ordering::Relaxed) {
            return Err(CompilerError::new("CANCELLED", "Import cancelled"));
        }
        Ok(())
    }
    pub(super) fn load(
        &mut self,
        file: &Path,
        mapped: &[u8],
        digest: &str,
        index: usize,
        total: usize,
    ) -> Result<()> {
        let started = std::time::Instant::now();
        let file_name = file
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("source")
            .to_string();
        // Les URI d'images écrites ici sont relatives à cette racine, et c'est sous elle que le
        // compilateur relira les octets pour en calculer les aperçus : une seule règle, partagée.
        let source_dir = crate::plugins::scene::image_root(file);
        let canonical_dir = normalise(&source_dir);
        let progress = self.progress;
        let cancelled = self.cancelled;
        let label = file_name.clone();
        let callback = move |p: &ufbx::Progress| -> ufbx::ProgressResult {
            if cancelled.load(Ordering::Relaxed) {
                return ufbx::ProgressResult::Cancel;
            }
            progress(
                json!({"phase":"import-source","step":"parse","file":label,"index":index,"files":total,"completed":p.bytes_read,"total":p.bytes_total}),
            );
            ufbx::ProgressResult::Continue
        };
        let opts = ufbx::LoadOpts {
            filename: ufbx::StringOpt::Ref(file.to_str().unwrap_or("")),
            ignore_animation: true,
            load_external_files: true,
            ignore_missing_external_files: true,
            generate_missing_normals: true,
            normalize_normals: true,
            target_axes: ufbx::CoordinateAxes::right_handed_y_up(),
            target_unit_meters: 1.0,
            space_conversion: ufbx::SpaceConversion::TransformRoot,
            geometry_transform_handling: ufbx::GeometryTransformHandling::Preserve,
            inherit_mode_handling: ufbx::InheritModeHandling::Preserve,
            pivot_handling: ufbx::PivotHandling::Retain,
            index_error_handling: ufbx::IndexErrorHandling::Clamp,
            progress_cb: ufbx::ProgressCb::Ref(&callback),
            progress_interval_hint: PROGRESS_INTERVAL_BYTES,
            obj_search_mtl_by_filename: true,
            obj_unit_meters: 1.0,
            obj_axes: ufbx::CoordinateAxes::right_handed_y_up(),
            ..Default::default()
        };
        let scene = ufbx::load_memory(mapped, opts).map_err(|e| import_error(&e))?;
        let parse_ms = started.elapsed().as_secs_f64() * 1000.0;
        for warning in &scene.metadata.warnings {
            self.report.notes.push(format!(
                "{file_name}: {} (x{})",
                &*warning.description, warning.count
            ));
        }
        // Element ids restart in every file: material and mesh lookups are per file, table indices are global.
        let mut local_materials: HashMap<u32, usize> = HashMap::new();
        {
            let mut textures = TextureTable {
                source_dir: &source_dir,
                canonical_dir,
                bin: &mut self.bin,
                images: &mut self.images,
                samplers: &mut self.samplers,
                textures: &mut self.textures,
                sampler_ids: &mut self.sampler_ids,
                report: &mut self.report,
                by_element: HashMap::new(),
            };
            for material in &scene.materials {
                self.materials.push(material_json(material, &mut textures));
                local_materials.insert(material.element.element_id, self.materials.len() - 1);
            }
        }
        let mut mesh_ids: HashMap<(u32, Vec<Option<usize>>), Option<usize>> = HashMap::new();
        let mut file_nodes = 0usize;
        let mut file_triangles = 0usize;
        let mut hidden = 0usize;
        let node_total = scene.nodes.len();
        for (i, node) in scene.nodes.iter().enumerate() {
            self.check()?;
            if node.is_root {
                continue;
            }
            if let Some(light) = node.light.as_ref() {
                self.push_light(node, light);
            }
            let Some(mesh) = node.mesh.as_ref() else {
                continue;
            };
            if !node.visible {
                hidden += 1;
                continue;
            }
            let bound: Vec<Option<usize>> = {
                let list = if node.materials.is_empty() {
                    &mesh.materials
                } else {
                    &node.materials
                };
                let mut out: Vec<Option<usize>> = list
                    .iter()
                    .map(|m| local_materials.get(&m.element.element_id).copied())
                    .collect();
                if out.is_empty() {
                    out.push(None);
                }
                out
            };
            let key = (mesh.element.element_id, bound);
            let mesh_id = match mesh_ids.get(&key) {
                Some(id) => *id,
                None => {
                    let converted = mesh_json(
                        mesh,
                        &key.1,
                        &mut self.bin,
                        &mut self.accessors,
                        &mut self.report,
                    );
                    let id = converted.map(|out| {
                        self.meshes.push(out.mesh);
                        self.mesh_triangles.push(out.triangles);
                        self.meshes.len() - 1
                    });
                    mesh_ids.insert(key, id);
                    if i % 64 == 0 || i + 1 == node_total {
                        (self.progress)(
                            json!({"phase":"import-source","step":"meshes","file":file_name,"index":index,"files":total,"completed":i+1,"total":node_total}),
                        );
                    }
                    id
                }
            };
            let Some(mesh_id) = mesh_id else { continue };
            let matrix = matrix_json(&node.geometry_to_world);
            if !matrix_is_finite(&matrix) {
                self.report.add("node-invalid-transform");
                continue;
            }
            self.nodes
                .push(json!({"name":&*node.element.name,"matrix":matrix,"mesh":mesh_id}));
            file_nodes += 1;
            file_triangles += self.mesh_triangles[mesh_id];
        }
        self.report.add_count("node-hidden", hidden);
        self.mesh_nodes += file_nodes;
        self.triangles += file_triangles;
        self.files.push(json!({"file":file_name,"bytes":mapped.len(),"sha256":digest,"format":if scene.metadata.file_format==ufbx::FileFormat::Obj{"obj"}else{"fbx"},"fbxVersion":scene.metadata.version,"ascii":scene.metadata.ascii,"creator":&*scene.metadata.creator,"unitMeters":scene.settings.unit_meters,"meshes":scene.meshes.len(),"materials":scene.materials.len(),"textures":scene.textures.len(),"lodGroups":scene.lod_groups.len(),"lights":scene.lights.len(),"hiddenNodes":hidden,"meshNodes":file_nodes,"triangles":file_triangles,"parseMs":parse_ms,"ms":started.elapsed().as_secs_f64()*1000.0}));
        Ok(())
    }
    pub(super) fn push_light(&mut self, node: &ufbx::Node, light: &ufbx::Light) {
        let kind = match light.type_ {
            ufbx::LightType::Point => "point",
            ufbx::LightType::Directional => "directional",
            ufbx::LightType::Spot => "spot",
            _ => {
                self.report.add("light-area-or-volume");
                return;
            }
        };
        let matrix = light_matrix(node, light.local_direction);
        if !matrix_is_finite(&matrix) {
            self.report.add("node-invalid-transform");
            return;
        }
        // FBX ne porte pas d'unité photométrique : son intensité est un pourcentage, que le réglage
        // publié de `compiler_lights` rend en candela ou en lux, comme le glTF.
        let intensity = light.intensity * crate::compiler_lights::fbx_intensity_scale(kind);
        let mut json = json!({"name":&*light.element.name,"type":kind,"color":[light.color.x,light.color.y,light.color.z],"intensity":intensity,"extras":{"castsShadow":light.cast_shadows}});
        if kind == "spot" {
            json["spot"] = json!({"innerConeAngle":light.inner_angle.to_radians(),"outerConeAngle":light.outer_angle.to_radians().max(0.001)});
        }
        self.lights.push(json);
        self.nodes.push(json!({"name":&*node.element.name,"matrix":matrix,"extensions":{"KHR_lights_punctual":{"light":self.lights.len()-1}}}));
    }
}
