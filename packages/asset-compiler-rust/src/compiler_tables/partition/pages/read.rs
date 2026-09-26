//! The reader of the paged index: every page a slot names, proven by its size, fingerprint and
//! version, walked down to the region pages in record order.
use super::*;

/// Every cell record under `root`, of `CELL_PAGES`' version, in cell order.
pub(crate) fn read_records(
    directory: &Path,
    root: &Value,
) -> std::result::Result<Vec<Value>, String> {
    if root["version"] != json!(CELL_PAGES.version) {
        return Err("the partition root is of another version".into());
    }
    let mut pages = Vec::new();
    read_leaves(
        &CELL_PAGES,
        directory,
        &root["pages"],
        "the root",
        &mut pages,
    )?;
    let mut records = Vec::new();
    for mut page in pages {
        if let Value::Array(cells) = page[CELL_PAGES.records].take() {
            records.extend(cells);
        }
    }
    Ok(records)
}

/// The page of `kind` that `slot` names — read from `directory`, proven by its size and
/// fingerprint, of `kind`'s version — and its file; `None` for an empty slot. `what` names the
/// page that lists it.
pub(crate) fn read_slot(
    kind: &Kind,
    directory: &Path,
    slot: &Value,
    what: &str,
) -> std::result::Result<Option<(String, Value)>, String> {
    let text = slot.as_str().unwrap_or_default();
    if text.len() != SLOT_WIDTH || !crate::manifest_binary::is_lower_hex(text) {
        return Err(format!("{what} lists a slot that is not fixed-width hex"));
    }
    let bytes = usize::from_str_radix(&text[64..72], 16).expect("eight hex digits");
    if bytes == 0 {
        return Ok(None);
    }
    let name = format!("{}{}.json", kind.prefix, &text[..64]);
    let data = fs::read(directory.join(&name)).map_err(|e| format!("{name}: {e}"))?;
    if data.len() != bytes || hash(&data) != text[..64] {
        return Err(format!("{name} is not the page its slot names"));
    }
    let page: Value = serde_json::from_slice(&data).map_err(|e| format!("{name}: {e}"))?;
    if page["version"] != json!(kind.version) {
        return Err(format!("{name} is of another version"));
    }
    Ok(Some((name, page)))
}

/// Appends to `into` every region page under `slots` (listed by `what`), in record order, each
/// read by `read_slot`.
pub(crate) fn read_leaves(
    kind: &Kind,
    directory: &Path,
    slots: &Value,
    what: &str,
    into: &mut Vec<Value>,
) -> std::result::Result<(), String> {
    let slots = slots.as_array().ok_or(format!("{what} lists no page"))?;
    for slot in slots {
        let Some((name, page)) = read_slot(kind, directory, slot, what)? else {
            continue;
        };
        if page["pages"].is_array() {
            read_leaves(kind, directory, &page["pages"], &name, into)?;
        } else if page[kind.records].is_array() {
            into.push(page);
        } else {
            return Err(format!("{name} lists neither pages nor records"));
        }
    }
    Ok(())
}
