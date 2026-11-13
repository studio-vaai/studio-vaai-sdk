import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  canonical,
  GcsStore,
  imageIndexKey,
  readInventory,
  restoreEvidence,
  retainEvidence,
  sdkReleaseKey,
  sha256,
  validateInventory,
  verifyImageManifests,
  type ArchiveStore,
  type InventoryRecord,
} from "./archive.mts";

class MemoryStore implements ArchiveStore {
  bucket = "test-archive";
  objects = new Map<string, Buffer>();
  async read(key: string) {
    return this.objects.get(key);
  }
  async create(key: string, bytes: Uint8Array) {
    const old = this.objects.get(key);
    if (old && !old.equals(Buffer.from(bytes))) {
      throw new Error("conflict");
    }
    this.objects.set(key, Buffer.from(bytes));
    return { uri: `gs://${this.bucket}/${key}`, sha256: sha256(bytes), bytes: bytes.length };
  }
  async content(bytes: Uint8Array, suffix = "json") {
    return await this.create(`artifacts/sha256/${sha256(bytes)}.${suffix}`, bytes);
  }
  async list(prefix: string) {
    return [...this.objects]
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, bytes]) => ({ name, generation: "1", size: String(bytes.length) }));
  }
}
const artifactDigest = `sha256:${"a".repeat(64)}`;
function sbom(hash: string) {
  return canonical({
    bomFormat: "CycloneDX",
    metadata: {
      component: {
        name: "@studio-vaai/core",
        version: "1.0.0",
        hashes: [{ alg: "SHA-256", content: hash }],
      },
    },
    components: [],
  });
}
function manifest(layer = "b", mediaType = "application/vnd.oci.image.manifest.v1+json") {
  return canonical({
    schemaVersion: 2,
    mediaType,
    config: { digest: `sha256:${"c".repeat(64)}`, size: 2 },
    layers: [{ digest: `sha256:${layer.repeat(64)}`, size: 3 }],
  });
}
const directories: string[] = [];
async function temporary() {
  const dir = await mkdtemp(join(tmpdir(), "sbom-cas-test-"));
  directories.push(dir);
  return dir;
}

describe("Retained SBOM evidence", () => {
  afterEach(async () => {
    await Promise.all(
      directories.splice(0).map(async (dir) => {
        await rm(dir, { recursive: true, force: true });
      }),
    );
  });
  it("preserves original inventory bytes, component inputs and exact SDK subject binding", async () => {
    const source = await temporary();
    const destination = join(await temporary(), "restored");
    const store = new MemoryStore();
    await mkdir(join(source, "components"));
    const original = sbom(artifactDigest.slice(7));
    await writeFile(join(source, "sbom.cdx.json"), original);
    await writeFile(join(source, "components", "native.cdx.json"), '{"source":true}\n');
    await writeFile(join(source, "package.tgz"), "separate artifact");
    const record: InventoryRecord = {
      schemaVersion: 1,
      kind: "sdk",
      subject: {
        digest: artifactDigest,
        name: "@studio-vaai/core",
        version: "1.0.0",
        integrity: `sha512-${Buffer.alloc(64).toString("base64")}`,
      },
      binding: { method: "exact-sdk-tarball" },
      ...(await retainEvidence(store, source)),
    };
    const key = sdkReleaseKey(record.subject.name!, record.subject.version!);
    await store.create(key, canonical(record));
    await expect(readInventory(store, key)).resolves.toEqual(record);
    await restoreEvidence(store, record, destination);
    await expect(readFile(join(destination, "sbom.cdx.json"))).resolves.toEqual(original);
    await expect(
      readFile(join(destination, "components", "native.cdx.json"), "utf8"),
    ).resolves.toContain("source");
    await expect(readFile(join(destination, "package.tgz"))).rejects.toThrow(/ENOENT/);
    await expect(
      restoreEvidence(store, { ...record, sbomSha256: "f".repeat(64) }, await temporary()),
    ).rejects.toThrow("SBOM hash mismatch");
    await expect(
      restoreEvidence(
        store,
        { ...record, subject: { ...record.subject, digest: `sha256:${"d".repeat(64)}` } },
        await temporary(),
      ),
    ).rejects.toThrow("approved artifact");
    store.objects.set(
      record.evidenceObject.uri.split(`${store.bucket}/`)[1]!,
      Buffer.from("tampered"),
    );
    await expect(restoreEvidence(store, record, await temporary())).rejects.toThrow(
      "content hash mismatch",
    );
  });

  it("rejects traversal and planted destination symlinks before writing", async () => {
    const source = await temporary();
    const store = new MemoryStore();
    await mkdir(join(source, "nested"));
    await writeFile(join(source, "sbom.cdx.json"), sbom(artifactDigest.slice(7)));
    await writeFile(join(source, "nested", "coverage.json"), "{}");
    const record: InventoryRecord = {
      schemaVersion: 1,
      kind: "sdk",
      subject: { digest: artifactDigest, name: "@studio-vaai/core", version: "1.0.0" },
      binding: {},
      ...(await retainEvidence(store, source)),
    };
    const target = await temporary();
    const outside = await temporary();
    await symlink(outside, join(target, "nested"), "dir");
    await expect(restoreEvidence(store, record, target)).rejects.toThrow("symlink");
    await expect(readFile(join(outside, "coverage.json"))).rejects.toThrow(/ENOENT/);
    const bundle = canonical({
      schemaVersion: 1,
      kind: "sbom-evidence",
      files: {
        "sbom.cdx.json": sbom(artifactDigest.slice(7)).toString("base64"),
        "../outside.json": "e30=",
      },
    });
    const bad = { ...record, evidenceObject: await store.content(bundle) };
    await expect(restoreEvidence(store, bad, await temporary())).rejects.toThrow("object key");
    await symlink(join(source, "sbom.cdx.json"), join(source, "linked.json"));
    await expect(retainEvidence(store, source)).rejects.toThrow("symlinks");
  });

  it("verifies original and published manifests independently while keeping original SBOM bytes", async () => {
    const source = await temporary();
    const store = new MemoryStore();
    const local = manifest();
    const published = manifest("b", "application/vnd.docker.distribution.manifest.v2+json");
    const original = sbom(sha256(local));
    await writeFile(join(source, "sbom.cdx.json"), original);
    await writeFile(join(source, "image-manifest.json"), local);
    await writeFile(join(source, "published-image-manifest.json"), published);
    await writeFile(
      join(source, "runtime-file-inventory.json"),
      canonical({
        schemaVersion: 1,
        inputSha256: sha256(original),
        missingRoots: [],
        roots: [],
        entries: [],
      }),
    );
    const record: InventoryRecord = {
      schemaVersion: 1,
      kind: "image",
      subject: { digest: `sha256:${sha256(published)}` },
      binding: verifyImageManifests(local, published),
      ...(await retainEvidence(store, source)),
    };
    const key = imageIndexKey(record.subject.digest);
    validateInventory(record, key, store.bucket);
    await restoreEvidence(store, record, await temporary());
    expect(sha256(local)).not.toBe(sha256(published));
    expect(record.sbomSha256).toBe(sha256(original));
    expect(() => validateInventory(record, imageIndexKey(artifactDigest), store.bucket)).toThrow(
      "subject",
    );
    expect(() =>
      validateInventory(
        {
          ...record,
          evidenceObject: {
            ...record.evidenceObject,
            uri: record.evidenceObject.uri.replace(store.bucket, "foreign"),
          },
        },
        key,
        store.bucket,
      ),
    ).toThrow("outside");
    await expect(
      restoreEvidence(
        store,
        { ...record, binding: { ...record.binding, configDigest: artifactDigest } },
        await temporary(),
      ),
    ).rejects.toThrow("proof differs");
  });

  it("rejects substituted, reordered or multi-platform manifests", () => {
    expect(() => verifyImageManifests(manifest(), manifest("d"))).toThrow("differs");
    expect(() =>
      verifyImageManifests(manifest(), canonical({ schemaVersion: 2, manifests: [] })),
    ).toThrow("one OCI");
    expect(() => imageIndexKey("not-a-digest")).toThrow(/Invalid/);
    expect(() => sdkReleaseKey("../package", "1.0.0")).toThrow(/Invalid/);
  });
});

describe("Create-only GCS storage", () => {
  it("uses content hashes, create preconditions and complete byte readback", async () => {
    const objects = new Map<string, Buffer>();
    const requests: URL[] = [];
    const fetcher: typeof fetch = async (input, options) => {
      let address: string;
      if (typeof input === "string") {
        address = input;
      } else if (input instanceof URL) {
        address = input.href;
      } else {
        address = input.url;
      }
      const url = new URL(address);
      requests.push(url);
      if (options?.method === "POST") {
        expect(url.searchParams.get("ifGenerationMatch")).toBe("0");
        const key = url.searchParams.get("name")!;
        if (objects.has(key)) {
          return new Response("exists", { status: 412 });
        }
        objects.set(key, Buffer.from(options.body as Uint8Array));
        return new Response("{}", { status: 200 });
      }
      const key = decodeURIComponent(url.pathname.split("/o/")[1]!);
      return objects.has(key)
        ? new Response(new Uint8Array(objects.get(key)!))
        : new Response("missing", { status: 404 });
    };
    const store = new GcsStore("gs://test-archive", { token: "test-token", fetch: fetcher });
    const bytes = canonical({ test: true });
    const ref = await store.content(bytes);
    expect(ref.uri).toBe(`gs://test-archive/artifacts/sha256/${sha256(bytes)}.json`);
    await expect(store.content(bytes)).resolves.toEqual(ref);
    await expect(store.create("artifacts/index.json", bytes)).resolves.toMatchObject({
      sha256: sha256(bytes),
    });
    await expect(store.create("artifacts/index.json", canonical({ test: false }))).rejects.toThrow(
      "conflict",
    );
    expect(requests.every((url) => url.hostname === "storage.googleapis.com")).toBe(true);
    await expect(store.read("../escape")).rejects.toThrow("key");
  });
});
