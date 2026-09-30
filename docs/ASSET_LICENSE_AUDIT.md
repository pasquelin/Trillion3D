# Asset license manifest audit

Run `pnpm audit:assets path/to/licenses.json` before using a corpus. This offline tool checks
asset and evidence SHA-256 hashes and compares **declared** license and usage with the repository's
[content policy](COMPILER.md#content-licenses--independent-of-format). It does not fetch assets,
follow source URLs, send documents, infer a license from a marketplace, or certify legal compliance.
Authenticity, contract interpretation and whether a document actually grants a claimed right remain
human review responsibilities. A hash proves which document was supplied, not what it permits.

## Manifest version 1

Place the manifest at the common root of its assets and local evidence. Paths must stay inside
that root, including through symlinks. Asset IDs and paths must be unique. No assets or evidence
are copied into the repository by this tool; keep purchases and private documents off git.

```json
{
  "version": 1,
  "assets": [
    {
      "id": "tree",
      "path": "assets/tree.glb",
      "sha256": "<64 lowercase hexadecimal characters>",
      "source": "https://example.org/original-listing-or-source-revision",
      "license": "fab-standard",
      "licenseVersion": "exact terms edition from the acquisition record",
      "usage": "embedded-product",
      "evidence": {
        "terms": { "path": "evidence/terms.txt", "sha256": "<sha256>" },
        "acquisition": { "path": "evidence/acquisition.txt", "sha256": "<sha256>" }
      }
    }
  ]
}
```

The example placeholders must be replaced with actual hashes. `terms` identifies the actual
license or ownership evidence; `acquisition` links the asset/source to that license edition or
records original authorship. Retain historical purchase terms; a current listing is not proof
of the license under which an earlier asset was acquired. Unknown license IDs remain unresolved.

| Declaration | Documented checks |
| --- | --- |
| `fab-standard`, `unity-asset-store` | Internal/embedded-product use only; reject standalone redistribution |
| `quixel-epic-engine` | Reject use in Trillion3D |
| `cc-by` | Require `attribution` and `changes` evidence (state explicitly if unchanged) |
| `owned` | Require ownership and authorship evidence, through `terms` and `acquisition` |
| Any other license | Human review required; no inferred commercial allowlist |

`usage` is `internal`, `embedded-product`, `public-demo`, or `raw-distribution`. `public-demo`
means publishing the underlying assets in a demo or public repository, not merely showing pixels
of a finished product; both it and `raw-distribution` require `redistribution` evidence. The tool
checks the presence/integrity of that document, not its legal meaning. A special negotiated license
must use its own license ID and remain under review rather than override a standard-license rule.

## Results and exit status

JSON output separates `technical` integrity findings, `policy` contradictions and `review`
requirements. An empty manifest, malformed declaration or unreadable manifest exits **2**.
A documented prohibition produces `rejected`; an unknown license, missing/corrupt evidence,
invalid source URL or changed asset produces `review-required`. Either exits **1**.
Only all `matches-documented-criteria` results exit **0**; this means the declared criteria and
local hashes matched, never that copyright ownership or legal compliance was established.

The manifest version governs parsing. The report identifies the documented policy being used;
keep the report with the reviewed source revision and re-audit after policy or evidence changes.
