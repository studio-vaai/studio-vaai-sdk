#!/usr/bin/env node
/* oxlint-disable no-await-in-loop -- Archive each package in order to bound memory and cloud I/O; evidence checks precede immutable publication. */
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

import {
  GcsStore,
  canonical,
  npmComponentName,
  readInventory,
  restoreEvidence,
  retainEvidence,
  sdkReleaseKey,
  sha256,
} from "./archive.mts";

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_PACKAGE_BYTES = 128 * 1024 * 1024;
const PACKAGE = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SHA256 = /^[a-f0-9]{64}$/;
const SHA512 = /^sha512-[A-Za-z0-9+/]{86}==$/;

interface ReleaseEntry {
  name: string;
  version: string;
  archive: string;
  sha256: string;
  integrity: string;
  sbom: string;
}

interface Publication {
  name: string;
  version: string;
  status: string;
  candidateIntegrity?: unknown;
  registryIntegrity?: unknown;
  candidateMatchesRegistry?: unknown;
}

interface PackageResult {
  name: string;
  version: string;
  status: "archived" | "already-archived" | "coverage-gap" | "dry-run";
  reason?: string;
  inventoryKey?: string;
}

interface ArchiveResult {
  schemaVersion: 1;
  sourceRevision: string;
  coverageComplete: boolean;
  dryRun: boolean;
  packages: PackageResult[];
}

type Store = Pick<GcsStore, "bucket" | "read" | "create" | "content">;
type RegistryVersion = (name: string, version: string) => Promise<unknown>;
type Metadata = Record<string, unknown>;

function isObject(value: unknown): value is Metadata {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function object(value: unknown, label: string): Metadata {
  if (!isObject(value)) {
    throw new Error(`Invalid ${label}`);
  }
  return value;
}

function identity(value: unknown): { name: string; version: string } {
  const record = object(value, "package identity");
  if (
    typeof record["name"] !== "string" ||
    !PACKAGE.test(record["name"]) ||
    typeof record["version"] !== "string" ||
    !VERSION.test(record["version"])
  ) {
    throw new Error("Invalid package name or version");
  }
  return { name: record["name"], version: record["version"] };
}

async function inside(directory: string, path: unknown, maxBytes: number): Promise<string> {
  if (typeof path !== "string" || isAbsolute(path) || path.includes("\\")) {
    throw new Error("Invalid release evidence path");
  }
  const candidate = resolve(directory, path);
  const local = relative(directory, candidate);
  if (!local || local.startsWith(`..${sep}`) || local === "..") {
    throw new Error("Release evidence path escapes its directory");
  }
  for (const part of local.split(sep)) {
    if (!part || part === "." || part === "..") {
      throw new Error("Invalid release evidence path");
    }
  }
  const stat = await lstat(candidate);
  if (!stat.isFile() || stat.size > maxBytes || (await realpath(candidate)) !== candidate) {
    throw new Error("Release evidence must be a bounded regular file without symlinks");
  }
  return candidate;
}

async function json(directory: string, path: string): Promise<Metadata> {
  const file = await inside(directory, path, MAX_JSON_BYTES);
  return object(JSON.parse(await readFile(file, "utf8")), path);
}

function releaseEntry(value: unknown): ReleaseEntry {
  const record = object(value, "release entry");
  const entry = identity(record);
  if (
    typeof record["archive"] !== "string" ||
    typeof record["sbom"] !== "string" ||
    typeof record["sha256"] !== "string" ||
    !SHA256.test(record["sha256"]) ||
    typeof record["integrity"] !== "string" ||
    !SHA512.test(record["integrity"])
  ) {
    throw new Error("Invalid SDK release artifact metadata");
  }
  return {
    ...entry,
    archive: record["archive"],
    sbom: record["sbom"],
    sha256: record["sha256"],
    integrity: record["integrity"],
  };
}

function publication(value: unknown): Publication {
  const record = object(value, "publication entry");
  const entry = identity(record);
  if (typeof record["status"] !== "string") {
    throw new Error("Invalid SDK publication status");
  }
  return {
    ...entry,
    status: record["status"],
    candidateIntegrity: record["candidateIntegrity"],
    registryIntegrity: record["registryIntegrity"],
    candidateMatchesRegistry: record["candidateMatchesRegistry"],
  };
}

function matchesPublication(entry: ReleaseEntry, result: Publication | undefined): boolean {
  return (
    typeof result !== "undefined" &&
    result.candidateIntegrity === entry.integrity &&
    result.registryIntegrity === entry.integrity &&
    (result.status === "published" ||
      (result.status === "already-published" && result.candidateMatchesRegistry === true))
  );
}

async function registryVersion(name: string, version: string): Promise<unknown> {
  const response = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(name)}/${encodeURIComponent(version)}`,
    { signal: AbortSignal.timeout(30_000) },
  );
  if (!response.ok || !response.body) {
    throw new Error(`Registry metadata request failed (${response.status})`);
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > MAX_JSON_BYTES) {
      throw new Error("Registry metadata exceeds its size bound");
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function verifiedExisting(store: Store, key: string, entry: ReleaseEntry): Promise<boolean> {
  const record = await readInventory(store, key);
  if (!record) {
    return false;
  }
  const subject = object(record.subject, "retained SDK subject");
  if (
    record.kind !== "sdk" ||
    subject["name"] !== entry.name ||
    subject["version"] !== entry.version ||
    subject["digest"] !== `sha256:${entry.sha256}` ||
    subject["integrity"] !== entry.integrity
  ) {
    throw new Error("Retained SDK version is bound to different published bytes");
  }
  if (object(record["support"], "retained SDK support status")["status"] !== "supported") {
    throw new Error("Retained SDK release lacks its default monitored support status");
  }
  const temporary = await mkdtemp(join(tmpdir(), "sdk-archive-verify-"));
  try {
    await restoreEvidence(store, record, temporary);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
  const artifact = object(record["artifactObject"], "retained SDK package reference");
  if (
    artifact["sha256"] !== entry.sha256 ||
    artifact["uri"] !== `gs://${store.bucket}/artifacts/sha256/${entry.sha256}.tgz`
  ) {
    throw new Error("Retained SDK package reference does not match the release");
  }
  const packageBytes = await store.read(`artifacts/sha256/${entry.sha256}.tgz`, MAX_PACKAGE_BYTES);
  if (
    !packageBytes ||
    sha256(packageBytes) !== entry.sha256 ||
    artifact["bytes"] !== packageBytes.length
  ) {
    throw new Error("Retained SDK package is missing or has a different hash");
  }
  return true;
}

export async function archiveSdkRelease(options: {
  directory: string;
  store: Store;
  dryRun?: boolean;
  registry?: RegistryVersion;
}): Promise<ArchiveResult> {
  const directory = await realpath(options.directory);
  const release = await json(directory, "release.json");
  if (
    typeof release["sourceRevision"] !== "string" ||
    !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(release["sourceRevision"])
  ) {
    throw new Error("Invalid SDK release source revision");
  }
  if (
    !Array.isArray(release["packages"]) ||
    release["packages"].length === 0 ||
    release["packages"].length > 128
  ) {
    throw new Error("Invalid SDK release package list");
  }
  const entries = release["packages"].map(releaseEntry);
  const unique = new Set(entries.map((entry) => `${entry.name}@${entry.version}`));
  if (unique.size !== entries.length) {
    throw new Error("Duplicate SDK release identity");
  }
  const report: ArchiveResult = {
    schemaVersion: 1,
    sourceRevision: release["sourceRevision"],
    coverageComplete: true,
    dryRun: options.dryRun ?? false,
    packages: [],
  };
  if (options.dryRun === true) {
    report.packages = entries.map((entry) => ({
      name: entry.name,
      version: entry.version,
      status: "dry-run",
    }));
    return report;
  }
  const published = await json(directory, "publication.json");
  if (!Array.isArray(published["packages"]) || published["packages"].length > 128) {
    throw new Error("Invalid SDK publication package list");
  }
  const publications = published["packages"].map(publication);
  const byIdentity = new Map(
    publications.map((entry) => [`${entry.name}@${entry.version}`, entry]),
  );
  if (byIdentity.size !== publications.length) {
    throw new Error("Duplicate SDK publication identity");
  }
  for (const entry of entries) {
    const result: PackageResult = {
      name: entry.name,
      version: entry.version,
      status: "coverage-gap",
    };
    report.packages.push(result);
    try {
      if (!matchesPublication(entry, byIdentity.get(`${entry.name}@${entry.version}`))) {
        throw new Error(
          "Publication does not establish matching registry bytes for this candidate",
        );
      }
      const archivePath = await inside(directory, entry.archive, MAX_PACKAGE_BYTES);
      const sbomPath = await inside(directory, entry.sbom, MAX_JSON_BYTES);
      if (dirname(archivePath) !== dirname(sbomPath)) {
        throw new Error("SDK archive and inventory must share their prepared package directory");
      }
      const bytes = await readFile(archivePath);
      const integrity = `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
      if (sha256(bytes) !== entry.sha256 || integrity !== entry.integrity) {
        throw new Error("SDK package bytes differ from the prepared release hashes");
      }
      const bom = object(JSON.parse(await readFile(sbomPath, "utf8")), "SDK inventory");
      const component = object(
        object(bom["metadata"], "SDK inventory metadata")["component"],
        "SDK inventory subject",
      );
      const { hashes } = component;
      if (
        npmComponentName(component) !== entry.name ||
        component["version"] !== entry.version ||
        !Array.isArray(hashes) ||
        !hashes.some((value) => {
          const hash = object(value, "SDK inventory hash");
          return hash["alg"] === "SHA-256" && hash["content"] === entry.sha256;
        })
      ) {
        throw new Error("SDK inventory is not bound to this package and archive hash");
      }
      const registry = object(
        await (options.registry ?? registryVersion)(entry.name, entry.version),
        "registry metadata",
      );
      if (
        registry["name"] !== entry.name ||
        registry["version"] !== entry.version ||
        object(registry["dist"], "registry distribution")["integrity"] !== entry.integrity
      ) {
        throw new Error("Current registry integrity does not match the prepared SDK archive");
      }
      const key = sdkReleaseKey(entry.name, entry.version);
      if (await verifiedExisting(options.store, key, entry)) {
        result.status = "already-archived";
        result.inventoryKey = key;
        continue;
      }
      const evidence = await retainEvidence(options.store, dirname(sbomPath));
      const artifactObject = await options.store.content(bytes, "tgz", "application/gzip");
      const record = {
        schemaVersion: 1 as const,
        kind: "sdk" as const,
        subject: {
          name: entry.name,
          version: entry.version,
          digest: `sha256:${entry.sha256}`,
          integrity: entry.integrity,
        },
        ...evidence,
        artifactObject,
        binding: { method: "exact-sdk-tarball" },
        sourceRevision: release["sourceRevision"],
        support: { status: "supported" },
      };
      // Check the exact retained snapshot; preparation files may have changed
      // after the earlier local validation and before bundle creation.
      const captured = await mkdtemp(join(tmpdir(), "sdk-archive-captured-"));
      try {
        await restoreEvidence(options.store, record, captured);
      } finally {
        await rm(captured, { recursive: true, force: true });
      }
      try {
        await options.store.create(key, canonical(record), "application/json");
      } catch (error) {
        if (!(await verifiedExisting(options.store, key, entry))) {
          throw error;
        }
      }
      result.status = "archived";
      result.inventoryKey = key;
    } catch (error) {
      report.coverageComplete = false;
      result.reason = error instanceof Error ? error.message : "SDK archive verification failed";
    }
  }
  await writeFile(join(directory, "archive.json"), canonical(report));
  return report;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      directory: { type: "string" },
      bucket: { type: "string" },
      "dry-run": { type: "boolean", default: false },
    },
  });
  if (typeof values.directory === "undefined" || values.directory.length === 0) {
    throw new Error("--directory is required");
  }
  const bucket = values.bucket ?? process.env["COMPLIANCE_ARCHIVE_BUCKET"];
  if (typeof bucket === "undefined" || bucket.length === 0) {
    throw new Error("--bucket or COMPLIANCE_ARCHIVE_BUCKET is required");
  }
  const report = await archiveSdkRelease({
    directory: values.directory,
    store: new GcsStore(bucket),
    dryRun: values["dry-run"],
  });
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.coverageComplete) {
    process.exitCode = 1;
  }
}

if (
  typeof process.argv[1] !== "undefined" &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "SDK archival failed"}\n`);
    process.exitCode = 1;
  }
}
