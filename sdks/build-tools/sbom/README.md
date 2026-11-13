# Shared SBOM tools

These tools are self-contained within the SDK tree. `sbom.py` is the entry point:

```sh
python sdks/build-tools/sbom/sbom.py release prepare --bundles BUNDLES --output RELEASE
python sdks/build-tools/sbom/sbom.py native --output INVENTORIES
python sdks/build-tools/sbom/sbom.py scan --input INVENTORIES --output REPORTS --cache CACHE
```

- `sbomlib/inventory/`: composition of upstream Cargo/Rollup inventories, installed npm packages and file artifacts.
- `sbomlib/scanning/`: pinned scanner installation, caching and report-only findings.
- `sbomlib/release/`: npm packing, archive binding and publication.
- `vite/`: rollup-plugin-sbom adapter routing output outside release bundles.
- `action/`: GitHub scanner action; callers may supply another CLI entry point.
- `resources/`: scanner pins.

rollup-plugin-sbom 5.0.1 generates CycloneDX 1.6 during Vite builds when
`STUDIO_VAAI_SBOM_DIR` is set. cargo-cyclonedx 0.5.9 generates CycloneDX 1.5
for each Rust target without compiling. Install it with
`cargo install cargo-cyclonedx --version 0.5.9 --locked`.
Python helpers use only the standard library. Native inventories are source-only
unless a binary is supplied with `native --artifact TARGET=FILE`.
External npm requirements remain metadata rather than versionless components.

The custom SBOM schema/content validation layer has been removed. Vulnerability
findings never fail `scan`; diagnostics remain in reports. Scanner, input and
coverage errors still fail.

Scans retain full deduplicated findings in local `notification.json`, job summaries
and logs. The scanner action does not upload or download GitHub Artifacts.
Caching is optional. Repository-specific Chat delivery is outside these SDK tools.
