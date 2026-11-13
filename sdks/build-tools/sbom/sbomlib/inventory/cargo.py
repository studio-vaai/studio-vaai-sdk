"""Supplement upstream Cargo inventories with the selected standard library."""
from ..model import component, prop


def rust_std(bom, compiler):
    fields = dict(line.split(": ", 1) for line in compiler.splitlines() if ": " in line)
    c = component("rust-std", fields["release"], "generic")
    c["licenses"] = [{"expression": "MIT OR Apache-2.0"}]
    c["properties"] = [prop("rust:commit", fields["commit-hash"]),
                       prop("inventory:evidence", "standard library from the selected Rust toolchain")]
    bom["components"].append(c)
    root_ref = bom["metadata"]["component"]["bom-ref"]
    edge = next((e for e in bom["dependencies"] if e["ref"] == root_ref), None)
    if edge is None:
        edge = {"ref": root_ref, "dependsOn": []}
        bom["dependencies"].append(edge)
    edge["dependsOn"] = sorted(set(edge["dependsOn"]) | {c["bom-ref"]})
    return bom
