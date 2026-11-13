/* oxlint-disable no-await-in-loop -- Ordered pagination, retry and content checks deliberately bound archive I/O. */
/* oxlint-disable no-undefined -- Missing archive objects are distinguished from stored JSON values. */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";

const execute = promisify(execFile);

export const MAX_EVIDENCE_BYTES = 128 * 1024 * 1024;
const MAX_INDEX_BYTES = 1024 * 1024;
const MAX_FILES = 4096;
const DIGEST = /^sha256:[a-f0-9]{64}$/;
const HEX = /^[a-f0-9]{64}$/;
type JsonObject = Record<string, unknown>;

export interface ObjectReference {
  uri: string;
  sha256: string;
  bytes: number;
}
export interface InventoryRecord {
  schemaVersion: 1;
  kind: "image" | "sdk";
  subject: { digest: string; name?: string; version?: string; integrity?: string };
  sbomSha256: string;
  evidenceObject: ObjectReference;
  binding: JsonObject;
  [key: string]: unknown;
}
export interface ArchiveStore {
  bucket: string;
  read(key: string, maxBytes?: number): Promise<Buffer | undefined>;
  create(key: string, bytes: Uint8Array, contentType?: string): Promise<ObjectReference>;
  content(bytes: Uint8Array, suffix?: string, contentType?: string): Promise<ObjectReference>;
  list(prefix: string): Promise<{ name: string; generation: string; size: string }[]>;
}
export const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

export function npmComponentName(component: JsonObject): string {
  const { name, group } = component;
  if (typeof name !== "string" || (group !== undefined && typeof group !== "string")) {
    throw new Error("Invalid npm component identity");
  }
  return group === undefined || group.length === 0 ? name : `${group}/${name}`;
}

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => sorted(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .toSorted(([a], [b]) => {
          if (a === b) {
            return 0;
          }
          return a < b ? -1 : 1;
        })
        .map(([key, item]) => [key, sorted(item)]),
    );
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return value;
  }
  throw new Error("Invalid archive JSON value");
}
export const canonical = (value: unknown): Buffer =>
  Buffer.from(`${JSON.stringify(sorted(value))}\n`);

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function object(value: unknown): JsonObject {
  if (!isObject(value)) {
    throw new Error("Invalid archive object");
  }
  return value;
}
function validKey(key: string): string {
  if (
    !key ||
    key.length > 2048 ||
    /[\p{Cc}\\]/u.test(key) ||
    key.startsWith("/") ||
    key.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid archive object key");
  }
  return key;
}
function digest(value: unknown): string {
  if (typeof value !== "string" || !DIGEST.test(value)) {
    throw new Error("Invalid artifact digest");
  }
  return value;
}
function filename(value: string): string {
  validKey(value);
  if (
    !/\.(?:json|md)$/.test(value) ||
    /(?:^|\/)(?:\.env|credentials|state|secrets?)(?:[./-]|$)/i.test(value)
  ) {
    throw new Error("Unsupported inventory evidence file");
  }
  return value;
}
export const imageIndexKey = (value: string): string =>
  `inventories/images/sha256/${digest(value).slice(7)}.json`;
export function sdkReleaseKey(name: string, version: string): string {
  if (
    !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) ||
    !/^[0-9][a-zA-Z0-9.+-]{0,127}$/.test(version)
  ) {
    throw new Error("Invalid SDK release identity");
  }
  return `releases/sdk/${encodeURIComponent(name)}/${encodeURIComponent(version)}.json`;
}

export async function googleAccessToken(): Promise<string> {
  const { stdout } = await execute("gcloud", ["auth", "print-access-token"], { encoding: "utf8" });
  const token = stdout.trim();
  if (!token || /\s/.test(token)) {
    throw new Error("Google access token is unavailable");
  }
  return token;
}

async function boundedBytes(response: Response, maxBytes: number): Promise<Buffer> {
  const length = Number(response.headers.get("content-length"));
  if (Number.isFinite(length) && length > maxBytes) {
    await response.body?.cancel();
    throw new Error("Archive response exceeds size limit");
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Archive response has no body");
  }
  const pieces: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const item = await reader.read();
    if (item.done) {
      break;
    }
    total += item.value.length;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Archive response exceeds size limit");
    }
    pieces.push(item.value);
  }
  return Buffer.concat(pieces, total);
}

export class GcsStore implements ArchiveStore {
  bucket: string;
  private readonly fetcher: typeof fetch;
  private readonly token: () => Promise<string>;
  constructor(
    bucket: string,
    options: { token?: string | (() => Promise<string>); fetch?: typeof fetch } = {},
  ) {
    bucket = bucket.replace(/^gs:\/\//, "").replace(/\/$/, "");
    if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(bucket)) {
      throw new Error("Invalid archive bucket");
    }
    this.bucket = bucket;
    this.fetcher = options.fetch ?? fetch;
    const provided = options.token;
    const load = typeof provided === "function" ? provided : googleAccessToken;
    let cached = typeof provided === "string" ? provided : undefined;
    let expires = typeof provided === "string" ? Number.POSITIVE_INFINITY : 0;
    this.token = async () => {
      if (cached === undefined || cached.length === 0 || Date.now() >= expires) {
        cached = await load();
        expires = Date.now() + 45 * 60 * 1000;
      }
      return cached;
    };
  }
  private async request(url: URL, options: RequestInit = {}): Promise<Response> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const headers = new Headers(options.headers);
      headers.set("Authorization", `Bearer ${await this.token()}`);
      const response = await this.fetcher(url, {
        ...options,
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers,
      });
      if (![408, 429, 500, 502, 503, 504].includes(response.status) || attempt === 3) {
        return response;
      }
      await response.body?.cancel();
      await delay(250 * 2 ** attempt);
    }
    throw new Error("Archive request retries exhausted");
  }
  async read(key: string, maxBytes = MAX_EVIDENCE_BYTES): Promise<Buffer | undefined> {
    const url = new URL(
      `https://storage.googleapis.com/storage/v1/b/${this.bucket}/o/${encodeURIComponent(validKey(key))}`,
    );
    url.searchParams.set("alt", "media");
    const response = await this.request(url);
    if (response.status === 404) {
      await response.body?.cancel();
      return undefined;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Archive read failed (${response.status})`);
    }
    return await boundedBytes(response, maxBytes);
  }
  async create(
    key: string,
    bytes: Uint8Array,
    contentType = "application/json",
  ): Promise<ObjectReference> {
    validKey(key);
    if (bytes.length > MAX_EVIDENCE_BYTES) {
      throw new Error("Archive input exceeds size limit");
    }
    const url = new URL(`https://storage.googleapis.com/upload/storage/v1/b/${this.bucket}/o`);
    url.searchParams.set("uploadType", "media");
    url.searchParams.set("name", key);
    url.searchParams.set("ifGenerationMatch", "0");
    const response = await this.request(url, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: Buffer.from(bytes),
    });
    const { status } = response;
    await response.body?.cancel();
    if (!response.ok && status !== 412) {
      throw new Error(`Archive create failed (${status})`);
    }
    const retained = await this.read(key, bytes.length);
    if (!retained || !retained.equals(Buffer.from(bytes))) {
      throw new Error("Append-only archive conflict or readback mismatch");
    }
    return { uri: `gs://${this.bucket}/${key}`, sha256: sha256(bytes), bytes: bytes.length };
  }
  async content(
    bytes: Uint8Array,
    suffix = "json",
    contentType = "application/json",
  ): Promise<ObjectReference> {
    if (!/^[a-z0-9.]{1,16}$/.test(suffix)) {
      throw new Error("Invalid content-addressed suffix");
    }
    return await this.create(`artifacts/sha256/${sha256(bytes)}.${suffix}`, bytes, contentType);
  }
  async list(prefix: string): Promise<{ name: string; generation: string; size: string }[]> {
    validKey(prefix.replace(/\/$/, ""));
    const result: { name: string; generation: string; size: string }[] = [];
    let pageToken: string | undefined;
    do {
      const url = new URL(`https://storage.googleapis.com/storage/v1/b/${this.bucket}/o`);
      url.searchParams.set("prefix", prefix);
      url.searchParams.set("maxResults", "1000");
      url.searchParams.set("fields", "items(name,generation,size),nextPageToken");
      if (pageToken !== undefined && pageToken.length > 0) {
        url.searchParams.set("pageToken", pageToken);
      }
      const response = await this.request(url);
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`Archive list failed (${response.status})`);
      }
      const pageBytes = await boundedBytes(response, MAX_INDEX_BYTES);
      const page = object(JSON.parse(pageBytes.toString()));
      const entries = page["items"] ?? [];
      if (!Array.isArray(entries)) {
        throw new Error("Invalid archive listing");
      }
      for (const entry of entries) {
        const item = object(entry);
        if (
          typeof item["name"] !== "string" ||
          !item["name"].startsWith(prefix) ||
          typeof item["generation"] !== "string" ||
          typeof item["size"] !== "string"
        ) {
          throw new Error("Invalid archive listing entry");
        }
        result.push({
          name: validKey(item["name"]),
          generation: item["generation"],
          size: item["size"],
        });
      }
      if (result.length > 100000) {
        throw new Error("Archive listing exceeds supported inventory limit");
      }
      if (page["nextPageToken"] !== undefined && typeof page["nextPageToken"] !== "string") {
        throw new Error("Invalid archive pagination");
      }
      const nextPage = page["nextPageToken"];
      if (nextPage !== undefined && typeof nextPage !== "string") {
        throw new Error("Invalid archive pagination");
      }
      pageToken = nextPage;
    } while (pageToken !== undefined && pageToken.length > 0);
    return result;
  }
}

function reference(value: unknown, bucket: string): ObjectReference {
  const ref = object(value);
  if (
    typeof ref["sha256"] !== "string" ||
    !HEX.test(ref["sha256"]) ||
    typeof ref["bytes"] !== "number" ||
    !Number.isSafeInteger(ref["bytes"]) ||
    ref["bytes"] < 1 ||
    ref["bytes"] > MAX_EVIDENCE_BYTES ||
    typeof ref["uri"] !== "string"
  ) {
    throw new Error("Invalid content-addressed evidence reference");
  }
  if (ref["uri"] !== `gs://${bucket}/artifacts/sha256/${ref["sha256"]}.json`) {
    throw new Error("Evidence reference is outside the expected content-addressed object");
  }
  return { uri: ref["uri"], sha256: ref["sha256"], bytes: ref["bytes"] };
}

export function validateInventory(value: unknown, key: string, bucket: string): InventoryRecord {
  const record = object(value);
  const subject = object(record["subject"]);
  const binding = object(record["binding"]);
  const artifactDigest = digest(subject["digest"]);
  if (
    record["schemaVersion"] !== 1 ||
    typeof record["sbomSha256"] !== "string" ||
    !HEX.test(record["sbomSha256"])
  ) {
    throw new Error("Invalid inventory index");
  }
  const evidenceObject = reference(record["evidenceObject"], bucket);
  const verifiedSubject: InventoryRecord["subject"] = { digest: artifactDigest };
  const { kind } = record;
  if (kind === "image") {
    if (
      imageIndexKey(artifactDigest) !== key ||
      binding["method"] !== "oci-manifest-equivalence" ||
      typeof binding["localManifestSha256"] !== "string" ||
      !HEX.test(binding["localManifestSha256"]) ||
      binding["publishedManifestSha256"] !== artifactDigest.slice(7) ||
      !DIGEST.test(String(binding["configDigest"])) ||
      !Array.isArray(binding["layerDigests"]) ||
      !binding["layerDigests"].every((item) => typeof item === "string" && DIGEST.test(item))
    ) {
      throw new Error("Image inventory index does not match its verified subject");
    }
  } else if (kind === "sdk") {
    if (
      typeof subject["name"] !== "string" ||
      typeof subject["version"] !== "string" ||
      sdkReleaseKey(subject["name"], subject["version"]) !== key ||
      binding["method"] !== "exact-sdk-tarball" ||
      typeof subject["integrity"] !== "string" ||
      !/^sha512-[A-Za-z0-9+/]+={0,2}$/.test(subject["integrity"]) ||
      Buffer.from(subject["integrity"].slice(7), "base64").length !== 64
    ) {
      throw new Error("SDK inventory index does not match its verified subject");
    }
  } else {
    throw new Error("Unknown inventory index kind");
  }
  if (kind === "sdk") {
    if (
      typeof subject["name"] !== "string" ||
      typeof subject["version"] !== "string" ||
      typeof subject["integrity"] !== "string"
    ) {
      throw new Error("Invalid SDK identity");
    }
    verifiedSubject.name = subject["name"];
    verifiedSubject.version = subject["version"];
    verifiedSubject.integrity = subject["integrity"];
  }
  return {
    ...record,
    schemaVersion: 1,
    kind,
    subject: verifiedSubject,
    sbomSha256: record["sbomSha256"],
    evidenceObject,
    binding,
  };
}

export async function readInventory(
  store: Pick<ArchiveStore, "bucket" | "read">,
  key: string,
): Promise<InventoryRecord | undefined> {
  const bytes = await store.read(key, MAX_INDEX_BYTES);
  return bytes === undefined
    ? undefined
    : validateInventory(JSON.parse(bytes.toString()), key, store.bucket);
}

export async function retainEvidence(
  store: Pick<ArchiveStore, "content">,
  directory: string,
): Promise<{ evidenceObject: ObjectReference; sbomSha256: string }> {
  const root = resolve(directory);
  const files: Record<string, string> = {};
  let count = 0;
  let total = 0;
  async function visit(relative: string): Promise<void> {
    const full = join(root, relative);
    const stat = await lstat(full);
    if (stat.isSymbolicLink()) {
      throw new Error("Inventory evidence cannot contain symlinks");
    }
    if (stat.isDirectory()) {
      const children = await readdir(full);
      for (const child of children.toSorted()) {
        await visit(relative ? `${relative}/${child}` : child);
      }
      return;
    }
    if (!stat.isFile()) {
      throw new Error("Inventory evidence must contain regular files");
    }
    // Package archives have their own content-addressed object; include scanner inputs here.
    if (!/\.(?:json|md)$/.test(relative)) {
      return;
    }
    filename(relative);
    count += 1;
    if (count > MAX_FILES || stat.size > MAX_EVIDENCE_BYTES - total) {
      throw new Error("Inventory evidence exceeds size limit");
    }
    const bytes = await readFile(full);
    total += bytes.length;
    if (bytes.length !== stat.size || total > MAX_EVIDENCE_BYTES) {
      throw new Error("Inventory evidence changed or exceeds size limit");
    }
    files[relative] = bytes.toString("base64");
  }
  await visit("");
  const sbom = files["sbom.cdx.json"];
  if (sbom === undefined || sbom.length === 0) {
    throw new Error("Inventory evidence has no root SBOM");
  }
  const bytes = canonical({ schemaVersion: 1, kind: "sbom-evidence", files });
  if (bytes.length > MAX_EVIDENCE_BYTES) {
    throw new Error("Encoded inventory evidence exceeds size limit");
  }
  return {
    evidenceObject: await store.content(bytes),
    sbomSha256: sha256(Buffer.from(sbom, "base64")),
  };
}

export async function restoreEvidence(
  store: Pick<ArchiveStore, "bucket" | "read">,
  record: InventoryRecord,
  directory: string,
): Promise<void> {
  const ref = reference(record.evidenceObject, store.bucket);
  const key = ref.uri.slice(`gs://${store.bucket}/`.length);
  const bytes = await store.read(key, ref.bytes);
  if (!bytes || bytes.length !== ref.bytes || sha256(bytes) !== ref.sha256) {
    throw new Error("Retained evidence content hash mismatch");
  }
  const bundle = object(JSON.parse(bytes.toString()));
  if (bundle["schemaVersion"] !== 1 || bundle["kind"] !== "sbom-evidence") {
    throw new Error("Unsupported retained inventory evidence");
  }
  const files = object(bundle["files"]);
  const names = Object.keys(files);
  if (names.length > MAX_FILES || !names.includes("sbom.cdx.json")) {
    throw new Error("Invalid retained inventory file set");
  }
  const decoded = new Map<string, Buffer>();
  let total = 0;
  for (const name of names) {
    filename(name);
    const value = files[name];
    if (typeof value !== "string") {
      throw new Error("Invalid retained inventory bytes");
    }
    const content = Buffer.from(value, "base64");
    if (content.toString("base64") !== value || (total += content.length) > MAX_EVIDENCE_BYTES) {
      throw new Error("Invalid or excessive retained inventory bytes");
    }
    decoded.set(name, content);
  }
  const sbomBytes = decoded.get("sbom.cdx.json");
  if (!sbomBytes) {
    throw new Error("Retained inventory has no root SBOM");
  }
  if (sha256(sbomBytes) !== record.sbomSha256) {
    throw new Error("Retained SBOM hash mismatch");
  }
  const bom = object(JSON.parse(sbomBytes.toString()));
  const metadata = object(bom["metadata"]);
  const component = object(metadata["component"]);
  const hashes = Array.isArray(component["hashes"])
    ? component["hashes"]
        .map((item) => object(item))
        .filter((item) => item["alg"] === "SHA-256")
        .map((item) => item["content"])
    : [];
  const expected =
    record.kind === "image"
      ? record.binding["localManifestSha256"]
      : record.subject.digest.slice(7);
  if (
    record.kind === "sdk" &&
    (npmComponentName(component) !== record.subject.name ||
      component["version"] !== record.subject.version ||
      record.subject.name === undefined ||
      record.subject.version === undefined ||
      record.subject.name.length === 0 ||
      record.subject.version.length === 0)
  ) {
    throw new Error("Retained SBOM SDK identity mismatch");
  }
  if (!hashes.includes(expected)) {
    throw new Error("Retained SBOM does not bind to the approved artifact");
  }
  if (record.kind === "image") {
    const local = decoded.get("image-manifest.json");
    const published = decoded.get("published-image-manifest.json");
    if (
      !local ||
      !published ||
      sha256(local) !== record.binding["localManifestSha256"] ||
      sha256(published) !== record.binding["publishedManifestSha256"]
    ) {
      throw new Error("Retained image publication manifests are missing or mismatched");
    }
    const configBytes = decoded.get("image-config.json");
    const compressionBytes = decoded.get("layer-compression-proof.json");
    let compression: { configBytes: Uint8Array; layers: unknown } | undefined;
    if (configBytes || compressionBytes) {
      if (!configBytes || !compressionBytes) {
        throw new Error("Retained compression evidence is incomplete");
      }
      const receipt = object(JSON.parse(compressionBytes.toString()));
      if (receipt["schemaVersion"] !== 1) {
        throw new Error("Unsupported retained compression evidence");
      }
      compression = { configBytes, layers: receipt["layers"] };
    }
    const proof = verifyImageManifests(local, published, compression);
    if (canonical(proof).toString() !== canonical(record.binding).toString()) {
      throw new Error("Retained image binding proof differs");
    }
    const inventory = decoded.get("runtime-file-inventory.json");
    if (!inventory) {
      throw new Error("Retained image has no runtime file inventory");
    }
    const native = object(JSON.parse(inventory.toString()));
    if (
      native["schemaVersion"] !== 1 ||
      native["inputSha256"] !== record.sbomSha256 ||
      !Array.isArray(native["missingRoots"]) ||
      native["missingRoots"].length > 0
    ) {
      throw new Error("Retained runtime file inventory is not bound or complete");
    }
  }
  const root = resolve(directory);
  await mkdir(root, { recursive: true });
  const rootStat = await lstat(root);
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    throw new Error("Inventory destination must be a regular directory");
  }
  for (const [name, content] of decoded) {
    const destination = resolve(root, name);
    if (!destination.startsWith(root + sep)) {
      throw new Error("Retained inventory path escapes its destination");
    }
    let parent = root;
    for (const segment of name.split("/").slice(0, -1)) {
      parent = join(parent, segment);
      try {
        await mkdir(parent, { mode: 0o700 });
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error) || error.code !== "EEXIST") {
          throw error;
        }
      }
      const stat = await lstat(parent);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error("Inventory destination contains a symlink or special directory");
      }
    }
    // Never replace arbitrary existing local files or follow a previously planted symlink.
    await writeFile(destination, content, { flag: "wx", mode: 0o600 });
  }
}

export interface LayerCompressionProof {
  index: number;
  sourceDigest: string;
  publishedDigest: string;
  compression: "gzip";
  compressedSha256: string;
  uncompressedSha256: string;
  compressedBytes: number;
  uncompressedBytes: number;
}
export class CompressionEvidenceRequiredError extends Error {
  override name = "CompressionEvidenceRequiredError";
}
const TAR_TYPES = new Set([
  "application/vnd.oci.image.layer.v1.tar",
  "application/vnd.docker.image.rootfs.diff.tar",
]);
const GZIP_TYPES = new Set([
  "application/vnd.oci.image.layer.v1.tar+gzip",
  "application/vnd.docker.image.rootfs.diff.tar.gzip",
]);

export function verifyImageManifests(
  localBytes: Uint8Array,
  publishedBytes: Uint8Array,
  compression?: { configBytes: Uint8Array; layers: unknown },
): JsonObject {
  function parts(bytes: Uint8Array) {
    const manifest = object(JSON.parse(Buffer.from(bytes).toString()));
    if (
      manifest["schemaVersion"] !== 2 ||
      manifest["manifests"] !== undefined ||
      !Array.isArray(manifest["layers"])
    ) {
      throw new Error("Expected one OCI/Docker image manifest");
    }
    const configDigest = digest(object(manifest["config"])["digest"]);
    const layers = manifest["layers"].map((layer) => object(layer));
    return { configDigest, layers, layerDigests: layers.map((layer) => digest(layer["digest"])) };
  }
  const local = parts(localBytes);
  const published = parts(publishedBytes);
  if (
    local.configDigest !== published.configDigest ||
    local.layers.length !== published.layers.length
  ) {
    throw new Error("Published image config/layer content differs from the inventoried image");
  }
  const common = {
    method: "oci-manifest-equivalence",
    localManifestSha256: sha256(localBytes),
    publishedManifestSha256: sha256(publishedBytes),
    configDigest: local.configDigest,
    layerDigests: local.layerDigests,
  };
  const changed: number[] = [];
  for (let index = 0; index < local.layers.length; index += 1) {
    if (local.layerDigests[index] === published.layerDigests[index]) {
      continue;
    }
    const source = local.layers[index];
    const target = published.layers[index];
    if (
      !source ||
      !target ||
      !TAR_TYPES.has(String(source["mediaType"])) ||
      !GZIP_TYPES.has(String(target["mediaType"]))
    ) {
      throw new Error(
        "Published image config/layer content differs without a supported compression mapping",
      );
    }
    changed.push(index);
  }
  if (changed.length === 0) {
    return common;
  }
  if (!compression) {
    throw new CompressionEvidenceRequiredError(
      "Published layer content differs; verified gzip compression evidence is required",
    );
  }
  if (`sha256:${sha256(compression.configBytes)}` !== local.configDigest) {
    throw new Error("Image config hash does not match both manifests");
  }
  const config = object(JSON.parse(Buffer.from(compression.configBytes).toString()));
  const rootfs = object(config["rootfs"]);
  const rawDiffIds = rootfs["diff_ids"];
  if (
    rootfs["type"] !== "layers" ||
    !Array.isArray(rawDiffIds) ||
    rawDiffIds.length !== local.layers.length
  ) {
    throw new Error("Image config has inconsistent rootfs diffIDs");
  }
  const rootfsDiffIds = rawDiffIds.map((value) => digest(value));
  for (const [index, layer] of local.layers.entries()) {
    if (
      TAR_TYPES.has(String(layer["mediaType"])) &&
      local.layerDigests[index] !== rootfsDiffIds[index]
    ) {
      throw new Error("Local uncompressed layer differs from the shared config diffID");
    }
  }
  if (!Array.isArray(compression.layers) || compression.layers.length !== changed.length) {
    throw new Error("Compression proof does not cover exactly the changed layers");
  }
  const compressionLayers: LayerCompressionProof[] = [];
  for (const [position, index] of changed.entries()) {
    const source = local.layers[index];
    const target = published.layers[index];
    const proof = object(compression.layers[position]);
    if (
      !source ||
      !target ||
      proof["index"] !== index ||
      proof["compression"] !== "gzip" ||
      proof["sourceDigest"] !== source["digest"] ||
      proof["publishedDigest"] !== target["digest"] ||
      source["digest"] !== rootfsDiffIds[index] ||
      proof["compressedSha256"] !== String(target["digest"]).slice(7) ||
      proof["uncompressedSha256"] !== rootfsDiffIds[index]?.slice(7) ||
      typeof source["size"] !== "number" ||
      !Number.isSafeInteger(source["size"]) ||
      source["size"] < 0 ||
      typeof target["size"] !== "number" ||
      !Number.isSafeInteger(target["size"]) ||
      target["size"] < 0 ||
      proof["compressedBytes"] !== target["size"] ||
      proof["uncompressedBytes"] !== source["size"]
    ) {
      throw new Error("Compression proof does not match the manifests and rootfs diffIDs");
    }
    compressionLayers.push({
      index,
      compression: "gzip",
      sourceDigest: digest(source["digest"]),
      publishedDigest: digest(target["digest"]),
      compressedSha256: digest(target["digest"]).slice(7),
      uncompressedSha256: digest(source["digest"]).slice(7),
      compressedBytes: target["size"],
      uncompressedBytes: source["size"],
    });
  }
  return {
    ...common,
    publishedLayerDigests: published.layerDigests,
    rootfsDiffIds,
    compressionLayers,
  };
}
