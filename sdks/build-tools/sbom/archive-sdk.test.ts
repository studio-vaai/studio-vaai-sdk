import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { archiveSdkRelease } from "./archive-sdk.mts";
import { canonical, sdkReleaseKey, sha256 } from "./archive.mts";

class MemoryStore {
  bucket = "sdk-evidence";
  objects = new Map<string, Buffer>();
  writes = 0;

  async read(key: string) {
    const value = this.objects.get(key);
    return value ? Buffer.from(value) : undefined;
  }

  async create(key: string, bytes: Uint8Array) {
    const value = Buffer.from(bytes);
    const existing = this.objects.get(key);
    if (existing && !existing.equals(value)) {
      throw new Error("Immutable archive conflict");
    }
    this.objects.set(key, value);
    this.writes += 1;
    return {
      uri: `gs://${this.bucket}/${key}`,
      sha256: sha256(value),
      bytes: value.length,
    };
  }

  async content(bytes: Uint8Array, suffix = "json") {
    return await this.create(`artifacts/sha256/${sha256(bytes)}.${suffix}`, bytes);
  }
}

const temporaryDirectories: string[] = [];
const sourceRevision = "1".repeat(40);
interface Entry {
  name: string;
  version: string;
  archive: string;
  sha256: string;
  integrity: string;
  sbom: string;
}

async function fixture(packages = ["@studio-vaai/client"], version = "1.0.0") {
  const directory = await mkdtemp(join(tmpdir(), "sdk-release-test-"));
  temporaryDirectories.push(directory);
  const entries: Entry[] = [];
  await Promise.all(
    packages.map(async (name, index) => {
      const packageDirectory = join(directory, `package-${index}`);
      const scopeEnd = name.indexOf("/");
      const group = scopeEnd === -1 ? {} : { group: name.slice(0, scopeEnd) };
      const componentName = scopeEnd === -1 ? name : name.slice(scopeEnd + 1);
      await mkdir(packageDirectory);
      const bytes = Buffer.from(`${name}@${version}: exact prepared archive`);
      const digest = sha256(bytes);
      const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
      const entry = {
        name,
        version,
        archive: `package-${index}/package.tgz`,
        sha256: digest,
        integrity,
        sbom: `package-${index}/sbom.cdx.json`,
      };
      await writeFile(join(directory, entry.archive), bytes);
      await writeFile(
        join(directory, entry.sbom),
        canonical({
          bomFormat: "CycloneDX",
          specVersion: "1.6",
          serialNumber: "urn:uuid:initial",
          metadata: {
            component: {
              ...group,
              name: componentName,
              version,
              hashes: [{ alg: "SHA-256", content: digest }],
            },
          },
          components: [],
        }),
      );
      await writeFile(
        join(packageDirectory, "osv-scanner.json"),
        canonical({ packageSources: [] }),
      );
      entries[index] = entry;
    }),
  );
  await writeFile(
    join(directory, "release.json"),
    canonical({ sourceRevision, packages: entries }),
  );
  const publications = entries.map((entry) => ({
    name: entry.name,
    version: entry.version,
    candidateIntegrity: entry.integrity,
    registryIntegrity: entry.integrity,
    status: "published",
  }));
  await writeFile(join(directory, "publication.json"), canonical({ packages: publications }));
  const registry = async (name: string, requestedVersion: string) => {
    const entry = entries.find((item) => item.name === name && item.version === requestedVersion);
    if (!entry) {
      throw new Error("Unknown test release");
    }
    return {
      name,
      version: requestedVersion,
      dist: { integrity: entry.integrity },
    };
  };
  return { directory, entries, publications, registry };
}

describe("SDK publication evidence", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map(async (directory) => {
        await rm(directory, { recursive: true, force: true });
      }),
    );
  });
  it("retains the exact published package and original inventory with monitored support", async () => {
    const { directory, entries, registry } = await fixture();
    const store = new MemoryStore();
    const result = await archiveSdkRelease({ directory, store, registry });
    const entry = entries[0]!;
    expect(result.coverageComplete).toBe(true);
    expect(result.packages[0]?.status).toBe("archived");
    const index = JSON.parse(
      store.objects.get(sdkReleaseKey(entry.name, entry.version))!.toString(),
    );
    expect(index.subject).toEqual({
      name: entry.name,
      version: entry.version,
      digest: `sha256:${entry.sha256}`,
      integrity: entry.integrity,
    });
    expect(index.support).toEqual({ status: "supported" });
    expect(index.binding).toEqual({ method: "exact-sdk-tarball" });
    expect(index.artifactObject.sha256).toBe(entry.sha256);
    expect(store.objects.get(`artifacts/sha256/${entry.sha256}.tgz`)).toEqual(
      await readFile(join(directory, entry.archive)),
    );
    const evidenceUri: string = index.evidenceObject.uri;
    const evidenceKey = evidenceUri.slice(`gs://${store.bucket}/`.length);
    const evidence: { files: Record<string, string> } = JSON.parse(
      store.objects.get(evidenceKey)!.toString(),
    );
    expect(Buffer.from(evidence.files["sbom.cdx.json"]!, "base64")).toEqual(
      await readFile(join(directory, entry.sbom)),
    );
    expect(evidence.files["osv-scanner.json"]).toBeDefined();
    expect(evidence.files["package.tgz"]).toBeUndefined();
  });

  it("archives successful packages in a partial release and exposes mismatched candidates", async () => {
    const { directory, entries, publications, registry } = await fixture([
      "@studio-vaai/client",
      "@studio-vaai/react",
    ]);
    await writeFile(
      join(directory, "publication.json"),
      canonical({
        packages: [
          publications[0],
          {
            ...publications[1],
            status: "already-published",
            candidateMatchesRegistry: false,
            registryIntegrity: "different",
          },
        ],
      }),
    );
    const store = new MemoryStore();
    const result = await archiveSdkRelease({ directory, store, registry });
    expect(result.coverageComplete).toBe(false);
    expect(result.packages.map((item) => item.status)).toEqual(["archived", "coverage-gap"]);
    expect(result.packages[1]?.reason).toContain("matching registry bytes");
    expect(store.objects.has(sdkReleaseKey(entries[1]!.name, entries[1]!.version))).toBe(false);
    expect(
      JSON.parse(await readFile(join(directory, "archive.json"), "utf8")).coverageComplete,
    ).toBe(false);
  });

  it("does not invent successful publication after the publisher stopped early", async () => {
    const { directory, publications, registry } = await fixture([
      "@studio-vaai/client",
      "@studio-vaai/react",
    ]);
    await writeFile(
      join(directory, "publication.json"),
      canonical({ packages: [publications[0]] }),
    );
    const result = await archiveSdkRelease({ directory, store: new MemoryStore(), registry });
    expect(result.packages.map((item) => item.status)).toEqual(["archived", "coverage-gap"]);
  });

  it("reuses verified matching publication evidence even if a rebuilt SBOM has a new UUID", async () => {
    const { directory, entries, publications, registry } = await fixture();
    const store = new MemoryStore();
    await archiveSdkRelease({ directory, store, registry });
    const entry = entries[0]!;
    const indexBytes = store.objects.get(sdkReleaseKey(entry.name, entry.version));
    const sbomPath = join(directory, entry.sbom);
    const bom = JSON.parse(await readFile(sbomPath, "utf8"));
    bom.serialNumber = "urn:uuid:rebuilt";
    await writeFile(sbomPath, canonical(bom));
    await writeFile(
      join(directory, "publication.json"),
      canonical({
        packages: [
          { ...publications[0], status: "already-published", candidateMatchesRegistry: true },
        ],
      }),
    );
    const result = await archiveSdkRelease({ directory, store, registry });
    expect(result.packages[0]?.status).toBe("already-archived");
    expect(store.objects.get(sdkReleaseKey(entry.name, entry.version))).toEqual(indexBytes);
  });

  it("checks current registry integrity before writing any evidence", async () => {
    const { directory, entries } = await fixture();
    const store = new MemoryStore();
    const result = await archiveSdkRelease({
      directory,
      store,
      registry: async (name, version) => ({
        name,
        version,
        dist: { integrity: `${entries[0]!.integrity}changed` },
      }),
    });
    expect(result.coverageComplete).toBe(false);
    expect(store.writes).toBe(0);
    expect(result.packages[0]?.reason).toContain("Current registry integrity");
  });

  it("rejects package or inventory bytes changed after preparation", async () => {
    const first = await fixture();
    await writeFile(join(first.directory, first.entries[0]!.archive), "altered package");
    const firstStore = new MemoryStore();
    const firstResult = await archiveSdkRelease({ ...first, store: firstStore });
    expect(firstResult.coverageComplete).toBe(false);
    expect(firstStore.writes).toBe(0);
    const second = await fixture();
    const sbomPath = join(second.directory, second.entries[0]!.sbom);
    const bom = JSON.parse(await readFile(sbomPath, "utf8"));
    bom.metadata.component.hashes[0].content = "0".repeat(64);
    await writeFile(sbomPath, canonical(bom));
    const secondStore = new MemoryStore();
    const secondResult = await archiveSdkRelease({ ...second, store: secondStore });
    expect(secondResult.packages[0]?.reason).toContain("not bound");
    expect(secondStore.writes).toBe(0);
  });

  it("rejects a matching short name from another npm scope", async () => {
    const { directory, entries, registry } = await fixture();
    const sbomPath = join(directory, entries[0]!.sbom);
    const bom = JSON.parse(await readFile(sbomPath, "utf8"));
    bom.metadata.component.group = "@other";
    await writeFile(sbomPath, canonical(bom));
    const store = new MemoryStore();
    const result = await archiveSdkRelease({ directory, store, registry });
    expect(result.coverageComplete).toBe(false);
    expect(result.packages[0]?.reason).toContain("not bound");
    expect(store.writes).toBe(0);
  });

  it("checks the captured inventory before publishing its immutable release link", async () => {
    const { directory, entries, registry } = await fixture();
    const store = new MemoryStore();
    const result = await archiveSdkRelease({
      directory,
      store,
      registry: async (name, version) => {
        const sbomPath = join(directory, entries[0]!.sbom);
        const bom = JSON.parse(await readFile(sbomPath, "utf8"));
        bom.metadata.component.hashes[0].content = "0".repeat(64);
        await writeFile(sbomPath, canonical(bom));
        return await registry(name, version);
      },
    });
    expect(result.coverageComplete).toBe(false);
    expect(store.objects.has(sdkReleaseKey(entries[0]!.name, entries[0]!.version))).toBe(false);
    expect(result.packages[0]?.reason).toContain("does not bind");
  });

  it("dry runs make no cloud or registry requests", async () => {
    const { directory } = await fixture();
    await rm(join(directory, "publication.json"));
    const store = new MemoryStore();
    const result = await archiveSdkRelease({
      directory,
      store,
      dryRun: true,
      registry: async () => {
        throw new Error("Unexpected network request");
      },
    });
    expect(result.packages[0]?.status).toBe("dry-run");
    expect(store.objects.size).toBe(0);
  });

  it("does not end support for a prior version when a newer one is archived", async () => {
    const first = await fixture();
    const second = await fixture(["@studio-vaai/client"], "2.0.0");
    const store = new MemoryStore();
    await archiveSdkRelease({ ...first, store });
    await archiveSdkRelease({ ...second, store });
    for (const version of ["1.0.0", "2.0.0"]) {
      expect(
        JSON.parse(store.objects.get(sdkReleaseKey("@studio-vaai/client", version))!.toString())
          .support.status,
      ).toBe("supported");
    }
  });

  it("rejects escaped and symlinked prepared artifacts", async () => {
    const first = await fixture();
    await writeFile(
      join(first.directory, "release.json"),
      canonical({ sourceRevision, packages: [{ ...first.entries[0], archive: "../outside.tgz" }] }),
    );
    const firstStore = new MemoryStore();
    const firstResult = await archiveSdkRelease({ ...first, store: firstStore });
    expect(firstResult.coverageComplete).toBe(false);
    expect(firstStore.writes).toBe(0);
    const second = await fixture();
    const archivePath = join(second.directory, second.entries[0]!.archive);
    await rm(archivePath);
    await symlink(join(first.directory, first.entries[0]!.archive), archivePath);
    const secondStore = new MemoryStore();
    const secondResult = await archiveSdkRelease({ ...second, store: secondStore });
    expect(secondResult.coverageComplete).toBe(false);
    expect(secondStore.writes).toBe(0);
  });

  it("refuses to reuse corrupted retained inventory or package bytes", async () => {
    const { directory, entries, registry } = await fixture();
    const store = new MemoryStore();
    await archiveSdkRelease({ directory, store, registry });
    const entry = entries[0]!;
    store.objects.set(`artifacts/sha256/${entry.sha256}.tgz`, Buffer.from("corrupt"));
    const result = await archiveSdkRelease({ directory, store, registry });
    expect(result.coverageComplete).toBe(false);
    expect(result.packages[0]?.reason).toContain("missing or has a different hash");
  });
});
