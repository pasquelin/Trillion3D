use super::*;

pub(super) fn share_bootstrap_bundles(o: &Options, primitives: &mut [Value]) -> Result<usize> {
    // (primitive, bundle) of every pinned bundle, in manifest order: the packing is deterministic.
    let mut members: Vec<(usize, usize)> = Vec::new();
    for (index, primitive) in primitives.iter().enumerate() {
        let Some(streams) = primitive.get("streams").and_then(Value::as_object) else {
            continue;
        };
        let pinned = streams.get("pinned").and_then(Value::as_u64).unwrap_or(0) as usize;
        let bundles = streams
            .get("pages")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        for bundle in 0..pinned.min(bundles) {
            members.push((index, bundle));
        }
    }
    if members.len() < 2 {
        return Ok(members.len());
    }
    let mut payloads: Vec<Vec<u8>> = Vec::new();
    let mut clusters: Vec<u64> = Vec::new();
    let mut placed: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    let mut slots: Vec<(usize, usize)> = Vec::with_capacity(members.len());
    for &(primitive, bundle) in &members {
        let entry = &primitives[primitive]["streams"]["pages"][bundle];
        let digest = entry["sha256"]
            .as_str()
            .ok_or_else(|| invalid("Stream bundle has no digest"))?
            .to_string();
        let bytes = entry["bytes"]
            .as_u64()
            .ok_or_else(|| invalid("Stream bundle has no byte length"))?
            as usize;
        let count = entry["count"].as_u64().unwrap_or(0);
        if let Some(&slot) = placed.get(&digest) {
            slots.push(slot);
            continue;
        }
        if payloads.last().is_none_or(|payload| {
            !payload.is_empty() && payload.len() + bytes > BOOTSTRAP_BUNDLE_BYTES
        }) {
            payloads.push(Vec::new());
            clusters.push(0);
        }
        let chunk = payloads.len() - 1;
        let offset = payloads[chunk].len();
        let source = fs::read(object_path(o, &digest))?;
        if source.len() != bytes {
            return Err(CompilerError::new(
                "INVALID_CLUSTER_PARTITION",
                "A stream bundle object does not match its declared size",
            ));
        }
        payloads[chunk].extend_from_slice(&source);
        clusters[chunk] += count;
        placed.insert(digest, (chunk, offset));
        slots.push((chunk, offset));
    }
    let mut names = Vec::with_capacity(payloads.len());
    for payload in &payloads {
        let digest = hash(payload);
        let target = object_path(o, &digest);
        if object_intact(&target, &digest)?.is_none() {
            store_object(&target, payload)?;
        }
        names.push(digest);
    }
    // Patch every pinned entry and shift the offsets of the clusters it carries.
    for (member, &(chunk, offset)) in members.iter().zip(slots.iter()) {
        let (primitive, bundle) = *member;
        {
            // A pinned bundle holds roots and depends on nothing: its empty list stays as it is.
            let entry = &mut primitives[primitive]["streams"]["pages"][bundle];
            entry["url"] = json!(format!("../../objects/{}.bin", names[chunk]));
            entry["sha256"] = json!(names[chunk]);
            entry["bytes"] = json!(payloads[chunk].len());
            entry["count"] = json!(clusters[chunk]);
        }
        if offset == 0 {
            continue;
        }
        let pages = primitives[primitive]["pages"]
            .as_array_mut()
            .ok_or_else(|| invalid("primitive.pages is required"))?;
        for page in pages {
            if page.get("stream").and_then(Value::as_u64) != Some(bundle as u64) {
                continue;
            }
            let previous = page
                .get("streamOffset")
                .and_then(Value::as_u64)
                .ok_or_else(|| invalid("A bundled cluster has no offset"))?
                as usize;
            page["streamOffset"] = json!(previous + offset);
        }
    }
    Ok(payloads.len())
}
