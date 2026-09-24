use super::*;

pub(super) fn encode_primitive(
    entry: &Map<String, Value>,
    page_count: usize,
    columns: &mut [Column],
    templates: &Templates,
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
            let culling = object(value, "primitive.culling")?;
            let stride = integer(culling.get("stride"), "primitive.culling.stride")? as usize;
            let count = integer(culling.get("count"), "primitive.culling.count")? as usize;
            let nodes = array(
                culling
                    .get("nodes")
                    .ok_or_else(|| bad("primitive.culling.nodes is absent"))?,
                "primitive.culling.nodes",
            )?;
            if stride != crate::CULLING_STRIDE {
                return Err(bad(format!(
                    "primitive.culling.stride is {stride}, expected {}",
                    crate::CULLING_STRIDE
                )));
            }
            if nodes.len() != count * stride {
                return Err(bad("primitive.culling.nodes does not match its count"));
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
            let structure = object(value, "primitive.structure")?;
            let groups = array(
                structure
                    .get("groups")
                    .ok_or_else(|| bad("primitive.structure.groups is absent"))?,
                "primitive.structure.groups",
            )?;
            for group in groups {
                let item = object(group, "structure group")?;
                columns[GROUP_LEVEL].i32(as_i32(
                    integer(item.get("level"), "group.level")?,
                    "group.level",
                )?);
                columns[GROUP_ERROR].f64(number(item.get("error"), "group.error")?);
                vector_into(
                    item.get("sphere"),
                    4,
                    "group.sphere",
                    &mut columns[GROUP_SPHERE],
                )?;
                // Labels for both keys are literals: no longer formatted
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
                    let members = array(item.get(key).ok_or_else(|| bad(absent))?, label)?;
                    columns[count_column].i32(as_i32(members.len() as i64, length)?);
                    for member in members {
                        columns[flat_column].i32(as_i32(
                            integer(Some(member), member_label)?,
                            "group member",
                        )?);
                    }
                }
            }
            let roots = array(
                structure
                    .get("roots")
                    .ok_or_else(|| bad("primitive.structure.roots is absent"))?,
                "primitive.structure.roots",
            )?;
            for root in roots {
                columns[STRUCTURE_ROOT].i32(as_i32(
                    integer(Some(root), "structure root")?,
                    "structure root",
                )?);
            }
            binary.insert("structure".into(),json!({"version":integer(structure.get("version"),"primitive.structure.version")?,"groups":groups.len(),"roots":roots.len()}));
        }
    }
    match entry.get("streams") {
        None => {}
        Some(Value::Null) => {
            binary.insert("streams".into(), Value::Null);
        }
        Some(value) => {
            let streams = object(value, "primitive.streams")?;
            let bundles = array(
                streams
                    .get("pages")
                    .ok_or_else(|| bad("primitive.streams.pages is absent"))?,
                "primitive.streams.pages",
            )?;
            for bundle in bundles {
                let item = object(bundle, "stream bundle")?;
                let digest = text(item.get("sha256"), "bundle.sha256")?;
                templated(
                    templates.bundle,
                    text(item.get("url"), "bundle.url")?,
                    digest,
                )?;
                columns[BUNDLE_SHA].sha(digest)?;
                columns[BUNDLE_U32].u32(as_u32(
                    integer(item.get("bytes"), "bundle.bytes")?,
                    "bundle.bytes",
                )?);
                columns[BUNDLE_U32].u32(as_u32(
                    integer(item.get("count"), "bundle.count")?,
                    "bundle.count",
                )?);
                let dependencies = array(
                    item.get("dependencies")
                        .ok_or_else(|| bad("bundle.dependencies is absent"))?,
                    "bundle.dependencies",
                )?;
                columns[BUNDLE_DEPENDENCY_COUNT].u32(as_u32(
                    dependencies.len() as i64,
                    "bundle.dependencies length",
                )?);
                for dependency in dependencies {
                    let index = integer(Some(dependency), "bundle dependency")?;
                    if index < 0 || index as usize >= bundles.len() {
                        return Err(bad("A bundle depends on a bundle outside its primitive"));
                    }
                    columns[BUNDLE_DEPENDENCY].u32(index as u32);
                }
            }
            binary.insert(
                "streams".into(),
                json!({"version":integer(streams.get("version"),"primitive.streams.version")?,
     "pinned":integer(streams.get("pinned"),"primitive.streams.pinned")?,
     "bundleBytes":integer(streams.get("bundleBytes"),"primitive.streams.bundleBytes")?,
     "maxDependencies":integer(streams.get("maxDependencies"),"primitive.streams.maxDependencies")?,
     "pages":bundles.len()}),
            );
        }
    }
    slim.insert("binary".into(), Value::Object(binary));
    Ok(Value::Object(slim))
}
