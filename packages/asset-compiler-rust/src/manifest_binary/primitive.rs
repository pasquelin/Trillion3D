use super::*;

pub(super) fn encode_primitive(
    entry: &Map<String, Value>,
    page_count: usize,
    columns: &mut [Column],
    files: usize,
) -> Result<Value> {
    let mut slim = entry.clone();
    slim.remove("pages");
    slim.remove("culling");
    slim.remove("structure");
    slim.remove("streams");
    let mut binary = Map::new();
    binary.insert("pages".into(), json!(page_count));
    match entry.get("culling") {
        None => {}
        Some(Value::Null) => {
            binary.insert("culling".into(), Value::Null);
        }
        Some(value) => {
            let culling = MANIFEST.object(value, "primitive.culling")?;
            let stride =
                MANIFEST.integer(culling.get("stride"), "primitive.culling.stride")? as usize;
            let count = MANIFEST.integer(culling.get("count"), "primitive.culling.count")? as usize;
            let nodes = MANIFEST.array(
                culling
                    .get("nodes")
                    .ok_or_else(|| MANIFEST.bad("primitive.culling.nodes is absent"))?,
                "primitive.culling.nodes",
            )?;
            if stride != trillion3d_page_codec::culling::CULLING_STRIDE {
                return Err(MANIFEST.bad(format!(
                    "primitive.culling.stride is {stride}, expected {}",
                    trillion3d_page_codec::culling::CULLING_STRIDE
                )));
            }
            if nodes.len() != count * stride {
                return Err(MANIFEST.bad("primitive.culling.nodes does not match its count"));
            }
            numbers_into(
                nodes,
                "primitive.culling.nodes",
                &mut columns[CULLING_NODES],
            )?;
            binary.insert("culling".into(), json!({"stride":stride,"count":count}));
        }
    }
    match entry.get("structure") {
        None => {}
        Some(Value::Null) => {
            binary.insert("structure".into(), Value::Null);
        }
        Some(value) => {
            let structure = MANIFEST.object(value, "primitive.structure")?;
            let groups = MANIFEST.array(
                structure
                    .get("groups")
                    .ok_or_else(|| MANIFEST.bad("primitive.structure.groups is absent"))?,
                "primitive.structure.groups",
            )?;
            for group in groups {
                let item = MANIFEST.object(group, "structure group")?;
                columns[GROUP_LEVEL].i32(as_i32(
                    MANIFEST.integer(item.get("level"), "group.level")?,
                    "group.level",
                )?);
                columns[GROUP_ERROR].f64(MANIFEST.number(item.get("error"), "group.error")?);
                vector_into(
                    item.get("sphere"),
                    4,
                    "group.sphere",
                    &mut columns[GROUP_SPHERE],
                )?;
                // Labels for both keys are literals: not formatted
                // per group, nor — for "member" — per group member.
                for (key, labels, count_column, flat_column) in [
                    (
                        "children",
                        [
                            "group.children",
                            "group.children is absent",
                            "group.children length",
                            "group.children member",
                        ],
                        GROUP_CHILD_COUNT,
                        GROUP_CHILD,
                    ),
                    (
                        "outputs",
                        [
                            "group.outputs",
                            "group.outputs is absent",
                            "group.outputs length",
                            "group.outputs member",
                        ],
                        GROUP_OUTPUT_COUNT,
                        GROUP_OUTPUT,
                    ),
                ] {
                    let [label, absent, length, member_label] = labels;
                    let members = MANIFEST
                        .array(item.get(key).ok_or_else(|| MANIFEST.bad(absent))?, label)?;
                    columns[count_column].i32(as_i32(members.len() as i64, length)?);
                    for member in members {
                        columns[flat_column].i32(as_i32(
                            MANIFEST.integer(Some(member), member_label)?,
                            "group member",
                        )?);
                    }
                }
            }
            let roots = MANIFEST.array(
                structure
                    .get("roots")
                    .ok_or_else(|| MANIFEST.bad("primitive.structure.roots is absent"))?,
                "primitive.structure.roots",
            )?;
            for root in roots {
                columns[STRUCTURE_ROOT].i32(as_i32(
                    MANIFEST.integer(Some(root), "structure root")?,
                    "structure root",
                )?);
            }
            binary.insert("structure".into(),json!({"version":MANIFEST.integer(structure.get("version"),"primitive.structure.version")?,"groups":groups.len(),"roots":roots.len()}));
        }
    }
    if let Some(value) = entry.get("streams") {
        let streams = MANIFEST.object(value, "primitive.streams")?;
        let bundles = MANIFEST.array(
            streams
                .get("pages")
                .ok_or_else(|| MANIFEST.bad("primitive.streams.pages is absent"))?,
            "primitive.streams.pages",
        )?;
        for bundle in bundles {
            let item = MANIFEST.object(bundle, "stream bundle")?;
            columns[BUNDLE_SHA].sha(MANIFEST.text(item.get("sha256"), "bundle.sha256")?)?;
            let file = as_u32(
                MANIFEST.integer(item.get("file"), "bundle.file")?,
                "bundle.file",
            )?;
            if file as usize >= files {
                return Err(
                    MANIFEST.bad("A bundle lies in a geometry file the manifest does not name")
                );
            }
            columns[BUNDLE_U32].u32(file);
            for (key, label) in [
                ("offset", "bundle.offset"),
                ("bytes", "bundle.bytes"),
                ("count", "bundle.count"),
            ] {
                columns[BUNDLE_U32].u32(as_u32(MANIFEST.integer(item.get(key), label)?, label)?);
            }
            let dependencies = MANIFEST.array(
                item.get("dependencies")
                    .ok_or_else(|| MANIFEST.bad("bundle.dependencies is absent"))?,
                "bundle.dependencies",
            )?;
            columns[BUNDLE_DEPENDENCY_COUNT].u32(as_u32(
                dependencies.len() as i64,
                "bundle.dependencies length",
            )?);
            for dependency in dependencies {
                let index = MANIFEST.integer(Some(dependency), "bundle dependency")?;
                if index < 0 || index as usize >= bundles.len() {
                    return Err(MANIFEST.bad("A bundle depends on a bundle outside its primitive"));
                }
                columns[BUNDLE_DEPENDENCY].u32(index as u32);
            }
        }
        binary.insert(
            "streams".into(),
            json!({"version":MANIFEST.integer(streams.get("version"),"primitive.streams.version")?,
     "pinned":MANIFEST.integer(streams.get("pinned"),"primitive.streams.pinned")?,
     "bundleBytes":MANIFEST.integer(streams.get("bundleBytes"),"primitive.streams.bundleBytes")?,
     "dependencyBound":MANIFEST.integer(streams.get("dependencyBound"),"primitive.streams.dependencyBound")?,
     "maxDependencies":MANIFEST.integer(streams.get("maxDependencies"),"primitive.streams.maxDependencies")?,
     "pages":bundles.len()}),
        );
    }
    slim.insert("binary".into(), Value::Object(binary));
    Ok(Value::Object(slim))
}
