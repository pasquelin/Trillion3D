//! Shared XML data admission; DTDs/external entities are never evaluated by an importer.
use super::*;
use roxmltree::{Document, Node, ParsingOptions};

pub(in crate::plugins::scene) fn parse<'a>(
    bytes: &'a [u8],
    request: &SceneRequest<'_>,
    format: &str,
) -> Result<Document<'a>> {
    let text = std::str::from_utf8(bytes).map_err(|_| invalid(format, "XML must be UTF-8"))?;
    let nodes = (request.ram_budget / 512).min(u32::MAX as usize) as u32;
    Document::parse_with_options(
        text,
        ParsingOptions {
            allow_dtd: false,
            nodes_limit: nodes,
        },
    )
    .map_err(|e| invalid(format, e))
}
pub(in crate::plugins::scene) fn child<'a, 'd>(
    node: Node<'a, 'd>,
    name: &str,
) -> Option<Node<'a, 'd>> {
    node.children().find(|n| {
        n.is_element()
            && n.tag_name().name() == name
            && n.tag_name().namespace() == node.tag_name().namespace()
    })
}
pub(in crate::plugins::scene) fn required<'a, 'd>(
    node: Node<'a, 'd>,
    name: &str,
    format: &str,
) -> Result<Node<'a, 'd>> {
    child(node, name).ok_or_else(|| {
        invalid(
            format,
            format!("{} is missing {name}", node.tag_name().name()),
        )
    })
}
pub(in crate::plugins::scene) fn numbers(node: Node<'_, '_>, format: &str) -> Result<Vec<f64>> {
    node.text()
        .unwrap_or("")
        .split_whitespace()
        .map(|s| {
            s.parse::<f64>()
                .ok()
                .filter(|v| v.is_finite())
                .ok_or_else(|| invalid(format, "invalid/non-finite number"))
        })
        .collect()
}
pub(in crate::plugins::scene) fn usize_attribute(
    node: Node<'_, '_>,
    name: &str,
    format: &str,
) -> Result<usize> {
    node.attribute(name)
        .and_then(|v| v.parse().ok())
        .ok_or_else(|| invalid(format, format!("missing/invalid {name}")))
}
pub(in crate::plugins::scene) fn fragment<'a>(uri: &'a str, format: &str) -> Result<&'a str> {
    uri.strip_prefix('#')
        .filter(|s| !s.is_empty())
        .ok_or_else(|| unsupported(format, format!("external or empty reference {uri:?}")))
}
