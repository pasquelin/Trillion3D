# Local instance-definition CRC correction

Source: `cadmpeg-codec-rhino` 0.5.5, Apache-2.0, crates.io release from
cadmpeg/cadmpeg commit `57a2e7ba8c82c6a587154b1592d7f54e0d44c060`.
The published `src/`, normalized `Cargo.toml`, and README are retained. LICENSE
is copied from that upstream revision. No generated artifacts or external
fixtures are vendored. The source delta is one match arm in
`src/container.rs::checksum_warning`: add `TCODE_INSTANCE_DEFINITION_RECORD`
to the record wrappers whose own CRC covers no direct payload bytes.

OpenNURBS reference:
https://github.com/mcneel/opennurbs/blob/8.x/opennurbs_archive.cpp

- `Write3dmInstanceDefinition` starts this record and writes one nested object.
- `UpdateCRC` updates only `m_chunk.Last()`, never ancestor chunks.
- `BeginRead3dmBigChunk` disables CRC while reading chunk headers.
- `EndRead3dmChunk` pops the child and restores the parent's CRC state.

Thus the wrapper's CRC is zero for its empty direct payload; nested object
chunks retain their own CRC checks. Hashing all child bytes as parent data
rejects valid official McNeel archives. This change keeps strict mode and all
checksum verification enabled, including the parent's stored checksum.
The parent adapter additionally refuses `container.instance-definition-degraded`,
because upstream strict mode otherwise tolerates nested CRC warnings represented
by this diagnostic. This is an adapter policy, not another vendor source patch.

Repository regression coverage uses our own fixtures written by the official
`rhino3dm` 8.17.0 package: a valid reflected block-instance archive imports;
changing the wrapper checksum, a child checksum, or child UUID bytes is refused.
See `src/plugins/scene/rhino/integrity_tests.rs` in the parent compiler package.
