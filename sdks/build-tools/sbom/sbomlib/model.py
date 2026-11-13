"""Deterministic CycloneDX documents and artifact evidence."""
import hashlib
import json
from pathlib import Path
from urllib.parse import quote
import uuid


def read(path):
    return json.loads(Path(path).read_text())



def write(path, value):
    if isinstance(value, dict) and value.get("bomFormat") == "CycloneDX":
        seed = json.dumps({k: v for k, v in value.items() if k != "serialNumber"},
                          sort_keys=True, separators=(",", ":"))
        value["serialNumber"] = "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, seed))
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(value, indent=2, sort_keys=True) + "\n")



def digest(path):
    with Path(path).open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()



def prop(name, value):
    return {"name": "studio-vaai:" + name, "value": str(value)}



def component(name, version, ecosystem, **extra):
    purl = f"pkg:{ecosystem}/{quote(name, safe='/')}@{quote(version, safe='')}"
    return {"type": "library", "name": name, "version": version,
            "bom-ref": purl, "purl": purl, **extra}



def document(root, components, edges):
    result = {"bomFormat": "CycloneDX", "specVersion": "1.6", "version": 1,
              "metadata": {"component": root},
              "components": sorted(components, key=lambda c: c["bom-ref"]),
              "dependencies": [{"ref": ref, "dependsOn": sorted(deps)}
                               for ref, deps in sorted(edges.items())]}
    # Stable across rebuilds of the same inputs; no wall clock timestamps.
    seed = json.dumps(result, sort_keys=True, separators=(",", ":"))
    result["serialNumber"] = "urn:uuid:" + str(uuid.uuid5(uuid.NAMESPACE_URL, seed))
    return result



def unique(values):
    return [json.loads(s) for s in sorted({json.dumps(v, sort_keys=True) for v in values})]



def file_inventory(artifact):
    artifact = Path(artifact)
    paths = [artifact] if artifact.is_file() else sorted(artifact.rglob("*"))
    return [{"path": path.name if artifact.is_file() else str(path.relative_to(artifact)),
             "sha256": digest(path)} for path in paths if path.is_file() and not path.is_symlink()]
