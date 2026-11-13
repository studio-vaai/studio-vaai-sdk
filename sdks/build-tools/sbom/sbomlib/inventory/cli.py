"""Compose artifact-specific CycloneDX fragments."""
import argparse
from pathlib import Path
from ..model import digest, prop, read, write
from .artifact import artifact_fragment
from .cargo import rust_std
from .npm import npm_fragment, prune_npm


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)
    rust = sub.add_parser("rust")
    rust.add_argument("--input", required=True)
    rust.add_argument("--compiler")
    rust.add_argument("--source-only", action="store_true")
    rust.add_argument("--artifact")
    rust.add_argument("--output", required=True)
    npm = sub.add_parser("npm")
    npm.add_argument("--root", required=True)
    npm.add_argument("--bundle", action="append", default=[])
    npm.add_argument("--bundle-dir")
    npm.add_argument("--embedded-sboms", action="append", default=[])
    npm.add_argument("--artifact")
    npm.add_argument("--output", required=True)
    prune = sub.add_parser("prune-npm")
    prune.add_argument("root")
    artifact = sub.add_parser("artifact")
    for name in ["root", "name", "version", "output"]:
        artifact.add_argument("--" + name, required=True)
    artifact.add_argument("--property", action="append", default=[])
    artifact.add_argument("--source-sbom")
    bind = sub.add_parser("bind-image")
    bind.add_argument("--sbom", required=True)
    bind.add_argument("--manifest", required=True)
    args = parser.parse_args(argv)
    if args.command == "rust":
        bom = read(args.input)
        if args.compiler:
            rust_std(bom, Path(args.compiler).read_text())
        c = bom["metadata"]["component"]
        if args.source_only:
            c.setdefault("properties", []).append(prop("inventory:evidence", "resolved-source-dependencies; platform binary not inspected"))
        if args.artifact:
            c["hashes"] = [{"alg": "SHA-256", "content": digest(args.artifact)}]
            c.setdefault("properties", []).append(prop("inventory:artifact", Path(args.artifact).name))
        write(args.output, bom)
    elif args.command == "npm":
        bundles = args.bundle + (list(Path(args.bundle_dir).glob("*.json")) if args.bundle_dir else [])
        bom = npm_fragment(args.root, bundles, args.embedded_sboms)
        if args.artifact:
            bom["metadata"]["component"]["hashes"] = [{"alg": "SHA-256", "content": digest(args.artifact)}]
        write(args.output, bom)
    elif args.command == "artifact":
        write(args.output, artifact_fragment(args.root, args.name, args.version, args.property, args.source_sbom))
    elif args.command == "prune-npm":
        print("Pruned deployment build packages:", ", ".join(prune_npm(args.root)))
    elif args.command == "bind-image":
        bom = read(args.sbom)
        root = bom["metadata"]["component"]
        checksum = digest(args.manifest)
        root["hashes"] = [{"alg": "SHA-256", "content": checksum}]
        root.setdefault("properties", []).append(prop("oci:source-manifest-digest", "sha256:" + checksum))
        write(args.sbom, bom)
