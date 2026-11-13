"""Inventory actual artifact files and link supporting source evidence."""
from ..model import component, digest, document, file_inventory, prop, read


def artifact_fragment(root, name, version, properties=(), source_sbom=None):
    main = component(name, version, "generic")
    main["properties"] = [prop("inventory:evidence", "artifact-files")]
    main["properties"] += [prop(*p.split("=", 1)) for p in properties]
    files = [{"type": "file", "name": entry["path"], "bom-ref": "sha256:" + entry["sha256"],
              "hashes": [{"alg": "SHA-256", "content": entry["sha256"]}]}
             for entry in file_inventory(root)]
    # The same bytes can appear under two filenames; keep a single identity.
    files = list({c["bom-ref"]: c for c in files}.values())
    if not files:
        raise ValueError(f"No artifact files in {root}")
    if source_sbom:
        source = read(source_sbom)
        serial = source["serialNumber"].removeprefix("urn:uuid:")
        main["externalReferences"] = [{"type": "bom", "url": f"urn:cdx:{serial}/1",
                                       "hashes": [{"alg": "SHA-256", "content": digest(source_sbom)}],
                                       "comment": "Resolved source build dependencies; not a linked-code inventory of device kernels"}]
    return document(main, files, {main["bom-ref"]: {c["bom-ref"] for c in files}})
