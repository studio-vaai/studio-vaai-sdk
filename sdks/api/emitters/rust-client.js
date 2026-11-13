// TypeSpec emitter: the public HTTP contract as the Rust API client in sdks/core-rs/api.
//
// It reads the TypeSpec program itself (through @typespec/http), not the OpenAPI document, and
// writes one file, `generated.rs`: every model, enum and error the client's operations reach, and
// per operation a request builder, a response parser and an async method on `ApiClient`. The
// hand-written rest of the crate (transport, client, runtime helpers) is what the generated code
// calls; UniFFI then gives Swift, Kotlin and the web (WebAssembly) the same client.
//
// Mapping, in short:
// - A model becomes a struct; inherited properties are flattened in, HTTP metadata and
//   `x-internal` properties are left out. A property whose type is a single string literal is a
//   constant of the wire format, not a field: it is checked when decoding and written when
//   encoding.
// - A union of string literals (or an enum) becomes a Rust enum with an `Unknown { value }`
//   variant, so a client built today keeps decoding values the server adds later.
// - Error responses become `ApiProblem` variants, one per error model; a response whose status
//   allows several is matched by the literals each model fixes (`kind`, `reason`).
// - `x-internal` operations and parameters are skipped, as are the operations of the tags listed
//   in the `exclude-tags` option.
import {
  createTypeSpecLibrary,
  getDoc,
  getTags,
  getTypeName,
  isErrorModel,
  resolvePath,
} from "@typespec/compiler";
import {
  getAllHttpServices,
  isHeader,
  isPathParam,
  isQueryParam,
  isStatusCode,
} from "@typespec/http";
import { getExtensions, getInfo } from "@typespec/openapi";

/** @typedef {import("@typespec/compiler").Program} Program */
/** @typedef {import("@typespec/compiler").Type} Type */
/** @typedef {import("@typespec/compiler").Model} Model */
/** @typedef {import("@typespec/compiler").ModelProperty} ModelProperty */
/** @typedef {import("@typespec/compiler").Scalar} Scalar */
/** @typedef {import("@typespec/compiler").Union} Union */
/** @typedef {import("@typespec/http").HttpOperation} HttpOperation */
/** @typedef {import("@typespec/http").HttpService} HttpService */

/**
 * @typedef {object} EmitterOptions
 * @property {string} [output-file] File name in the output directory; `generated.rs` by default.
 * @property {string[]} [include-internal-tags] Internal operations used by the example storefront.
 * @property {string[]} [include-internal-fields] Diagnostic response fields kept for SDK tooling.
 * @property {string[]} [exclude-tags] Operations under these tags are not generated.
 * @property {Record<string, string>} [client-headers] Request headers the client fills in itself,
 *   by header name → `RequestContext` field.
 */

/**
 * @typedef {object} Field
 * @property {string} wire The JSON name.
 * @property {string} ident The Rust field name.
 * @property {string} type The Rust type.
 * @property {boolean} optional Whether the JSON may omit it
 * @property {boolean} wireModel Whether to add a nested model’s fixed wire fields.
 * @property {string | undefined} doc
 */

/**
 * @typedef {object} Named A Rust type the output declares.
 * @property {string} name
 * @property {string} body Its declaration.
 * @property {Field[]} fields A struct's fields; none for an enum.
 * @property {[string, string][]} constants Properties the model fixes to one literal.
 * @property {[string, string][]} unions Properties typed as a union of literals, and the Rust
 *   path of their known values.
 */

/**
 * @typedef {object} Argument
 * @property {string} ident
 * @property {string} type The Rust type the async method takes.
 * @property {string | undefined | null} doc
 */

/**
 * @typedef {object} Parameter
 * @property {string} name The HTTP name.
 * @property {string} ident
 * @property {boolean} optional
 * @property {string} type The Rust type of its value.
 */

/**
 * @typedef {object} Header
 * @property {string} name
 * @property {string | null} field The `RequestContext` field it comes from, if the client
 *   fills it in.
 * @property {Parameter | null} argument The argument it comes from, otherwise.
 */

/**
 * @typedef {object} Operation
 * @property {string} opName
 * @property {string} ident
 * @property {string} verb
 * @property {string} path
 * @property {Argument[]} args
 * @property {Parameter[]} pathArgs
 * @property {Parameter[]} queryArgs
 * @property {Header[]} headers
 * @property {boolean} analytics Whether the operation targets the collector.
 * @property {boolean} hasBody
 * @property {boolean} bearer
 * @property {boolean} cookie
 * @property {{ code: number, type: string }[]} successes
 * @property {string} successType
 * @property {Map<number, string[]>} problems Problem models by status.
 * @property {string | undefined} doc
 */

export const $lib = createTypeSpecLibrary({
  name: "studio-vaai-rust-client",
  diagnostics: {},
  emitter: {
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        "emitter-output-dir": { type: "string", nullable: true },
        "output-file": { type: "string", nullable: true },
        "include-internal-tags": { type: "array", items: { type: "string" }, nullable: true },
        "include-internal-fields": { type: "array", items: { type: "string" }, nullable: true },
        "exclude-tags": { type: "array", items: { type: "string" }, nullable: true },
        "client-headers": {
          type: "object",
          additionalProperties: { type: "string" },
          nullable: true,
        },
      },
    },
  },
});

const RUST_KEYWORDS = new Set(
  [
    "as break const continue crate else enum extern false fn for if impl in let loop match mod",
    "move mut pub ref return self Self static struct super trait true type unsafe use where while",
    "async await dyn abstract become box do final macro override priv typeof unsized virtual yield try",
  ]
    .join(" ")
    .split(" "),
);

/** Rust's standard type for each TypeSpec standard scalar. */
const SCALARS = new Map([
  ["string", "String"],
  ["url", "String"],
  ["utcDateTime", "String"],
  ["offsetDateTime", "String"],
  ["plainDate", "String"],
  ["plainTime", "String"],
  ["duration", "String"],
  ["boolean", "bool"],
  ["int8", "i8"],
  ["int16", "i16"],
  ["int32", "i32"],
  ["int64", "i64"],
  ["safeint", "i64"],
  ["integer", "i64"],
  ["uint8", "u8"],
  ["uint16", "u16"],
  ["uint32", "u32"],
  ["uint64", "u64"],
  ["float32", "f32"],
  ["float64", "f64"],
  ["float", "f64"],
  ["numeric", "f64"],
  ["decimal", "f64"],
  ["decimal128", "f64"],
]);

/**
 * @param {string} name camelCase, kebab-case or snake_case
 * @returns {string[]}
 */
function words(name) {
  return name
    .replaceAll(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "");
}

/** @param {string} name */
function snake(name) {
  const s = words(name)
    .map((w) => w.toLowerCase())
    .join("_");
  if (RUST_KEYWORDS.has(s)) {
    return `${s}_`;
  }
  return /^[0-9]/.test(s) ? `_${s}` : s;
}

/** @param {string} name */
function pascal(name) {
  const s = words(name)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
  return /^[0-9]/.test(s) ? `V${s}` : s;
}

/** @param {string} s */
function rustString(s) {
  return JSON.stringify(s);
}

/**
 * @param {string | undefined | null} doc
 * @param {string} [indent]
 */
function docLines(doc, indent = "") {
  if (typeof doc !== "string" || doc.trim() === "") {
    return "";
  }
  const lines = doc
    .trim()
    .split("\n")
    .map((line) => (line.trim() === "" ? `${indent}///` : `${indent}/// ${line.trim()}`));
  return `${lines.join("\n")}\n`;
}

/**
 * Flattened string-literal members of a union, or null when it has other members.
 * @param {Type} type
 * @returns {string[] | null}
 */
function stringLiterals(type) {
  /** @type {string[]} */
  const out = [];
  /** @type {(t: Type) => boolean} */
  const walk = (t) => {
    if (t.kind === "Union") {
      return [...t.variants.values()].every((v) => walk(v.type));
    }
    if (t.kind === "UnionVariant") {
      return walk(t.type);
    }
    if (t.kind === "String") {
      out.push(t.value);
      return true;
    }
    return false;
  };
  return walk(type) ? [...new Set(out)] : null;
}

/**
 * The single string literal a type fixes, if it fixes one.
 * @param {Type} type
 * @returns {string | null}
 */
function constValue(type) {
  if (type.kind === "String") {
    return type.value;
  }
  if (type.kind === "Union") {
    const literals = stringLiterals(type);
    if (literals?.length === 1) {
      return literals[0];
    }
  }
  return null;
}

/** @param {Type | undefined} type */
function isVoid(type) {
  return (
    typeof type === "undefined" ||
    (type.kind === "Intrinsic" && (type.name === "void" || type.name === "never"))
  );
}

/** @param {Type} type */
function isNull(type) {
  return type.kind === "Intrinsic" && type.name === "null";
}

/**
 * The nearest standard scalar a scalar derives from: `int64` itself, not `integer` or `numeric`
 * further down its chain.
 * @param {Scalar} scalar
 */
function stdScalar(scalar) {
  let s = scalar;
  while (!SCALARS.has(s.name) && typeof s.baseScalar !== "undefined") {
    s = s.baseScalar;
  }
  return s.name;
}

/**
 * Whether an API version is a calendar date in `YYYY-MM-DD` form.
 * @param {string} version
 */
function isApiVersionDate(version) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(version)) {
    return false;
  }
  const date = new Date(`${version}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(version);
}

/**
 * A builder argument: strings and models by reference, options by value.
 * @param {string} type
 */
function borrowed(type) {
  if (type === "String") {
    return "&str";
  }
  return type.startsWith("Option<") ? type : `&${type}`;
}

/** @param {import("@typespec/compiler").EmitContext<EmitterOptions>} context */
export async function $onEmit(context) {
  const { program, options } = context;
  const excludeTags = new Set(options["exclude-tags"]);
  const internalTags = new Set(options["include-internal-tags"]);
  const internalFields = new Set(options["include-internal-fields"]);
  const clientHeaders = new Map(
    Object.entries(options["client-headers"] ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
  );
  const [services, diagnostics] = getAllHttpServices(program);
  if (diagnostics.length > 0) {
    program.reportDiagnostics(diagnostics);
  }
  const service = services.find(({ operations }) =>
    operations.some((operation) => operation.operation.name === "getSession"),
  );
  if (typeof service === "undefined") {
    throw new Error("expected a session service in the client contract");
  }
  // One client speaks one API version: a date the contract names (`YYYY-MM-DD`, see the API
  // docs' versioning page), sent as `X-Api-Version`. A contract versioned with
  // @typespec/versioning describes several dates at once; generating from it would mix them.
  if (service.namespace.decorators.some((d) => d.decorator.name === "$versioned")) {
    throw new Error(
      "the contract is @versioned: the emitter does not yet project it onto a single API version",
    );
  }
  const apiVersion = getInfo(program, service.namespace)?.version;
  if (typeof apiVersion === "undefined") {
    throw new Error("the service has no @OpenAPI.info version");
  }
  if (!isApiVersionDate(apiVersion)) {
    throw new Error(`the API version ${apiVersion} is not a YYYY-MM-DD date`);
  }

  /** @param {Type} type */
  const isInternal = (type) => getExtensions(program, type).get("x-internal") === true;
  /** @param {HttpOperation} op */
  const tagsOf = (op) => [
    ...getTags(program, op.operation),
    ...(op.container.kind === "Interface" ? getTags(program, op.container) : []),
  ];

  // ---- type registry -------------------------------------------------------------------------
  /** @type {Map<Type, Named>} */
  const named = new Map();
  const usedNames = new Set([
    "ApiClient",
    "ApiError",
    "ApiProblem",
    "HttpRequest",
    "HttpResponse",
    "HttpHeader",
    "RequestContext",
  ]);
  /** @type {Type[]} emission order of named types */
  const order = [];
  /** @type {Model[]} error models, in emission order */
  const problemModels = [];

  /** @param {string} base */
  const claimName = (base) => {
    let name = base;
    for (let i = 2; usedNames.has(name); i += 1) {
      name = `${base}${i}`;
    }
    usedNames.add(name);
    return name;
  };

  /** @param {Type} type */
  const entryOf = (type) => {
    const entry = named.get(type);
    if (typeof entry === "undefined") {
      throw new Error(`no Rust type for ${getTypeName(type)}`);
    }
    return entry;
  };

  /**
   * Properties of a model, inherited ones first, overrides replacing them.
   * @param {Model} model
   */
  const allProperties = (model) => {
    /** @type {Model[]} */
    const chain = [];
    for (
      let m = /** @type {Model | undefined} */ (model);
      typeof m !== "undefined";
      m = m.baseModel
    ) {
      chain.unshift(m);
    }
    /** @type {Map<string, ModelProperty>} */
    const props = new Map();
    for (const m of chain) {
      for (const [k, p] of m.properties) {
        props.set(k, p);
      }
    }
    return [...props.values()].filter(
      (p) =>
        !isHeader(program, p) &&
        !isStatusCode(program, p) &&
        !isQueryParam(program, p) &&
        !isPathParam(program, p) &&
        (!isInternal(p) || internalFields.has(p.name)),
    );
  };

  /** @param {Model} model @returns {Model["indexer"]} */
  const indexerOf = (model) => model.indexer ?? (model.baseModel && indexerOf(model.baseModel));

  /**
   * An enum for a union of string literals (or an enum), with an `Unknown` fallback.
   * @param {Type} type
   * @param {string[]} values
   * @param {string} contextName
   */
  const literalEnum = (type, values, contextName) => {
    const existing = named.get(type);
    if (typeof existing !== "undefined") {
      return existing.name;
    }
    const typeName =
      "name" in type && typeof type.name === "string" && type.name !== ""
        ? pascal(type.name)
        : contextName;
    const name = claimName(typeName);
    const variants = values.map((v) => ({ wire: v, ident: pascal(v) }));
    let s = `${docLines(getDoc(program, type))}#[derive(Debug, Clone, PartialEq, Eq, Hash)]\n#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]\npub enum ${name} {\n`;
    for (const v of variants) {
      s += `    /// \`${v.wire}\`\n    ${v.ident},\n`;
    }
    s += `    /// A value this client does not know yet.\n    Unknown { value: String },\n}\n\n`;
    s += `impl ${name} {\n    /// The value on the wire.\n    pub fn as_str(&self) -> &str {\n        match self {\n`;
    for (const v of variants) {
      s += `            Self::${v.ident} => ${rustString(v.wire)},\n`;
    }
    s += `            Self::Unknown { value } => value,\n        }\n    }\n\n`;
    s += `    pub(crate) const KNOWN: &'static [&'static str] = &[${variants.map((v) => rustString(v.wire)).join(", ")}];\n\n`;
    s += `    pub fn from_wire(value: &str) -> Self {\n        match value {\n`;
    for (const v of variants) {
      s += `            ${rustString(v.wire)} => Self::${v.ident},\n`;
    }
    s += `            other => Self::Unknown { value: other.to_owned() },\n        }\n    }\n}\n\n`;
    s += `impl serde::Serialize for ${name} {\n    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {\n        serializer.serialize_str(self.as_str())\n    }\n}\n\n`;
    s += `impl<'de> serde::Deserialize<'de> for ${name} {\n    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {\n        let value = <std::borrow::Cow<'de, str>>::deserialize(deserializer)?;\n        Ok(Self::from_wire(&value))\n    }\n}\n`;
    named.set(type, { name, body: s, fields: [], constants: [], unions: [] });
    order.push(type);
    return name;
  };

  /**
   * The Rust type for a TypeSpec type. `contextName` names an anonymous model or union after
   * where it is used.
   * @param {Type} type
   * @param {string} contextName
   * @returns {string}
   */
  const rustType = (type, contextName) => {
    if (type.kind === "Scalar") {
      const rust = SCALARS.get(stdScalar(type));
      if (typeof rust === "undefined") {
        throw new Error(`unsupported scalar ${getTypeName(type)}`);
      }
      return rust;
    }
    if (type.kind === "Boolean") {
      return "bool";
    }
    if (type.kind === "Number") {
      return Number.isInteger(type.value) ? "i64" : "f64";
    }
    if (type.kind === "String") {
      return "String";
    }
    if (type.kind === "Model") {
      if (typeof type.indexer !== "undefined" && allProperties(type).length === 0) {
        const value = rustType(type.indexer.value, `${contextName}Item`);
        if (type.indexer.key.name === "integer") {
          return `Vec<${value}>`;
        }
        if (type.indexer.key.name === "string") {
          return `std::collections::HashMap<String, ${value}>`;
        }
      }
      return modelName(type, contextName);
    }
    if (type.kind === "Enum") {
      return literalEnum(
        type,
        [...type.members.values()].map((m) => String(m.value ?? m.name)),
        contextName,
      );
    }
    if (type.kind === "Union") {
      const members = [...type.variants.values()].map((v) => v.type);
      const nonNull = members.filter((m) => !isNull(m));
      if (nonNull.length < members.length) {
        if (nonNull.length !== 1) {
          throw new Error(`nullable union with several members (${contextName}) is unsupported`);
        }
        return `Option<${rustType(nonNull[0], contextName)}>`;
      }
      if (members.every((member) => member.kind === "Model")) {
        const name = claimName(type.name ?? contextName);
        const variants = members.map((member) => {
          const typeName = modelName(member, contextName);
          const discriminator = entryOf(member).constants.find(([key]) => key === "name");
          if (typeof discriminator === "undefined") {
            throw new Error(`model union ${name} requires a fixed name discriminator`);
          }
          const [, wire] = discriminator;
          return { typeName, wire };
        });
        const body = `#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ${name} {
${variants.map(({ typeName }) => `    ${typeName} { event: ${typeName} },`).join("\n")}
}

impl serde::Serialize for ${name} {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let value = match self {
${variants.map(({ typeName }) => `            Self::${typeName} { event } => runtime::wire_value(event),`).join("\n")}
        }.map_err(serde::ser::Error::custom)?;
        serde::Serialize::serialize(&value, serializer)
    }
}

impl<'de> serde::Deserialize<'de> for ${name} {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = <serde_json::Value as serde::Deserialize>::deserialize(deserializer)?;
        match value.get("name").and_then(serde_json::Value::as_str) {
${variants
  .map(
    ({ typeName, wire }) =>
      `            Some(${rustString(wire)}) => serde_json::from_value(value).map(|event| Self::${typeName} { event }).map_err(serde::de::Error::custom),`,
  )
  .join("\n")}
            _ => Err(serde::de::Error::custom("unknown event name")),
        }
    }
}
`;
        named.set(type, { name, body, fields: [], constants: [], unions: [] });
        order.push(type);
        return name;
      }
      const literals = stringLiterals(type);
      if (literals === null) {
        throw new Error(
          `union ${getTypeName(type)} (${contextName}) is unsupported: only string-literal unions are mapped`,
        );
      }
      return literalEnum(type, literals, contextName);
    }
    throw new Error(`unsupported type kind ${type.kind} (${contextName})`);
  };

  /**
   * The struct for a model.
   * @param {Model} model
   * @param {string} contextName
   * @returns {string}
   */
  const modelName = (model, contextName) => {
    const existing = named.get(model);
    if (typeof existing !== "undefined") {
      return existing.name;
    }
    const base =
      model.name !== "" && typeof model.templateMapper === "undefined"
        ? pascal(model.name)
        : contextName;
    const name = claimName(base);
    /** @type {Named} */
    const entry = { name, body: "", fields: [], constants: [], unions: [] };
    named.set(model, entry);
    for (const p of allProperties(model)) {
      const fixed = constValue(p.type);
      if (fixed !== null) {
        entry.constants.push([p.name, fixed]);
        continue;
      }
      let type = rustType(p.type, `${name}${pascal(p.name)}`);
      if (p.type.kind === "Union" && stringLiterals(p.type) !== null) {
        entry.unions.push([p.name, `${type}::KNOWN`]);
      }
      if (p.optional && !type.startsWith("Option<")) {
        type = `Option<${type}>`;
      }
      entry.fields.push({
        wire: p.name,
        ident: snake(p.name),
        type,
        optional: type.startsWith("Option<"),
        wireModel: p.type.kind === "Model" && (named.get(p.type)?.constants.length ?? 0) > 0,
        doc: getDoc(program, p),
      });
    }
    let s = docLines(getDoc(program, model));
    s += `#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]\n#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]\npub struct ${name} {\n`;
    for (const f of entry.fields) {
      s += docLines(f.doc, "    ");
      const attrs = [`rename = ${rustString(f.wire)}`];
      if (f.wireModel) {
        const serializer = f.optional ? "serialize_optional_wire_model" : "serialize_wire_model";
        attrs.push(`serialize_with = "runtime::${serializer}"`);
      }
      if (f.optional) {
        attrs.push(`default`, `skip_serializing_if = "Option::is_none"`);
      }
      s += `    #[serde(${attrs.join(", ")})]\n`;
      if (f.optional) {
        s += `    #[cfg_attr(feature = "uniffi", uniffi(default))]\n`;
      }
      s += `    pub ${f.ident}: ${f.type},\n`;
    }
    const indexer = indexerOf(model);
    if (indexer?.key.name === "string") {
      const value = rustType(indexer.value, `${name}AdditionalValue`);
      s += `    #[serde(flatten)]\n    #[cfg_attr(feature = "uniffi", uniffi(default))]\n    pub additional: std::collections::HashMap<String, ${value}>,\n`;
    }
    const constants = entry.constants
      .map(([k, v]) => `(${rustString(k)}, ${rustString(v)})`)
      .join(", ");
    const unions = entry.unions.map(([k, v]) => `(${rustString(k)}, ${v})`).join(", ");
    s += `}\n\nimpl crate::runtime::WireModel for ${name} {\n`;
    s += `    const CONSTANTS: &'static [(&'static str, &'static str)] = &[${constants}];\n`;
    s += `    const LITERAL_UNIONS: &'static [(&'static str, &'static [&'static str])] = &[${unions}];\n}\n`;
    entry.body = s;
    order.push(model);
    if (isErrorModel(program, model)) {
      problemModels.push(model);
    }
    return name;
  };

  // ---- operations ----------------------------------------------------------------------------
  /**
   * Every (status, body type) an operation declares; ranges and wildcards are not mapped.
   * @param {HttpOperation} op
   * @returns {[number, Type | undefined][]}
   */
  const responseBodies = (op) =>
    op.responses.flatMap((r) => {
      const code = r.statusCodes;
      if (typeof code !== "number") {
        throw new TypeError(`${op.operation.name}: status ranges and wildcards are unsupported`);
      }
      return r.responses.map(
        (c) => /** @type {[number, Type | undefined]} */ ([code, c.body?.type]),
      );
    });

  /**
   * The problem models an error status allows: one, or each member of a union of them.
   * @param {Type | undefined} type
   * @param {number} code
   * @param {string} opName
   * @param {string} Op
   * @returns {string[]}
   */
  const problemNames = (type, code, opName, Op) => {
    if (typeof type === "undefined" || isVoid(type)) {
      return [];
    }
    const members = type.kind === "Union" ? [...type.variants.values()].map((v) => v.type) : [type];
    return members.map((m) => {
      if (m.kind !== "Model" || !isErrorModel(program, m)) {
        throw new Error(`${opName}: ${code} body ${getTypeName(m)} is not an @error model`);
      }
      const name = modelName(m, `${Op}Problem${code}`);
      if (!problemModels.includes(m)) {
        problemModels.push(m);
      }
      return name;
    });
  };

  /**
   * @param {HttpOperation} op
   * @param {HttpService} service
   * @returns {Operation}
   */
  const operation = (op, service) => {
    const opName = op.operation.name;
    const Op = pascal(opName);
    /** @type {Argument[]} */
    const args = [];
    /** @type {Parameter[]} */
    const pathArgs = [];
    /** @type {Parameter[]} */
    const queryArgs = [];
    /** @type {Header[]} */
    const headers = [];
    for (const p of op.parameters.parameters) {
      if (isInternal(p.param)) {
        continue;
      }
      const field = p.type === "header" ? (clientHeaders.get(p.name.toLowerCase()) ?? null) : null;
      if (field !== null) {
        headers.push({ name: p.name, field, argument: null });
        continue;
      }
      if (p.type === "cookie") {
        throw new Error(`${opName}: cookie parameters are unsupported`);
      }
      const type = rustType(p.param.type, `${Op}${pascal(p.param.name)}`);
      if (p.type === "path" && type !== "String") {
        throw new Error(`${opName}: path parameter ${p.name} must be a string`);
      }
      const { optional } = p.param;
      args.push({
        ident: snake(p.param.name),
        type: optional ? `Option<${type}>` : type,
        doc: getDoc(program, p.param),
      });
      /** @type {Parameter} */
      const parameter = { name: p.name, ident: snake(p.param.name), optional, type };
      if (p.type === "path") {
        pathArgs.push(parameter);
      } else if (p.type === "query") {
        queryArgs.push(parameter);
      } else {
        headers.push({ name: p.name, field: null, argument: parameter });
      }
    }
    const { body } = op.parameters;
    if (typeof body !== "undefined") {
      if (body.bodyKind !== "single") {
        throw new Error(`${opName}: ${body.bodyKind} bodies are unsupported`);
      }
      if (!body.contentTypes.every((c) => c === "application/json")) {
        throw new Error(`${opName}: body content types ${body.contentTypes.join(", ")}`);
      }
      args.push({ ident: "body", type: rustType(body.type, `${Op}Body`), doc: null });
    }

    // Credentialed browser requests also allow unauthenticated endpoints to set cookies.
    const auth = op.authentication ?? service.authentication;
    const schemes = new Set(
      (auth?.options ?? []).flatMap((o) =>
        o.schemes.map((s) => {
          if (s.type === "http") {
            return `http:${s.scheme.toLowerCase()}`;
          }
          return s.type === "apiKey" ? `apiKey:${s.in}` : s.type;
        }),
      ),
    );

    /** @type {{ code: number, type: string }[]} */
    const successes = [];
    /** @type {Map<number, string[]>} */
    const problems = new Map();
    for (const [code, type] of responseBodies(op)) {
      if (code >= 200 && code < 300) {
        successes.push({
          code,
          type:
            typeof type === "undefined" || isVoid(type) ? "()" : rustType(type, `${Op}Response`),
        });
      } else {
        problems.set(code, [
          ...(problems.get(code) ?? []),
          ...problemNames(type, code, opName, Op),
        ]);
      }
    }
    if (successes.length === 0) {
      throw new Error(`${opName}: no success response`);
    }
    const bodySuccesses = successes.filter(({ type }) => type !== "()");
    if (bodySuccesses.length > 1) {
      throw new Error(`${opName}: several success body responses are unsupported`);
    }
    const optionalBody = successes.length > 1 && bodySuccesses.length === 1;
    const successType = optionalBody ? `Option<${bodySuccesses[0].type}>` : successes[0].type;
    return {
      opName,
      ident: snake(opName),
      verb: op.verb.toUpperCase(),
      path: op.path,
      args,
      pathArgs,
      queryArgs,
      headers,
      analytics: tagsOf(op).includes("analytics"),
      hasBody: typeof body !== "undefined",
      bearer: schemes.has("http:bearer"),
      cookie:
        schemes.has("apiKey:cookie") ||
        op.responses.some(
          (response) =>
            typeof response.statusCodes === "number" &&
            response.statusCodes >= 200 &&
            response.statusCodes < 300 &&
            response.responses.some((content) =>
              Object.keys(content.headers ?? {}).some(
                (name) => name.toLowerCase() === "set-cookie",
              ),
            ),
        ),
      successes,
      successType,
      problems,
      doc: getDoc(program, op.operation),
    };
  };

  const ops = services.flatMap((service) =>
    service.operations
      .filter((op) => {
        const tags = tagsOf(op);
        return (
          !tags.some((tag) => excludeTags.has(tag)) &&
          (!isInternal(op.operation) || tags.some((tag) => internalTags.has(tag)))
        );
      })
      .map((op) => operation(op, service)),
  );

  // ---- output --------------------------------------------------------------------------------
  const base = problemModels.find(
    (m) => m.name === "ProblemDetails" && typeof m.baseModel === "undefined",
  );
  if (typeof base === "undefined") {
    throw new Error("no operation declares the base ProblemDetails model");
  }
  const genericType = entryOf(base).name;

  /**
   * How `ApiProblem::kind` reads a problem model's `kind`: a field, an enum, or a fixed literal.
   * @param {Named} entry
   */
  const kindExpression = (entry) => {
    const field = entry.fields.find((f) => f.wire === "kind");
    if (typeof field !== "undefined") {
      return field.type === "String" ? "problem.kind.clone()" : "problem.kind.as_str().to_owned()";
    }
    const fixed = entry.constants.find(([k]) => k === "kind");
    return `{ let _ = problem; ${typeof fixed === "undefined" ? "String::new()" : `${rustString(fixed[1])}.to_owned()`} }`;
  };

  /** @param {Operation} op */
  const requestBuilder = (op) => {
    const sigRef = op.args.map((a) => `${a.ident}: ${borrowed(a.type)}`).join(", ");
    let s = `/// Builds the \`${op.opName}\` request (\`${op.verb} ${op.path}\`).\npub fn ${op.ident}_request(context: &RequestContext${sigRef === "" ? "" : `, ${sigRef}`}) -> Result<HttpRequest, ApiError> {\n`;
    let pathExpr = op.path;
    const pathFmt = op.pathArgs.map((p) => {
      pathExpr = pathExpr.replace(`{${p.name}}`, "{}");
      return `runtime::encode_path_segment(${p.ident})`;
    });
    s +=
      pathFmt.length > 0
        ? `    let path = format!(${rustString(pathExpr)}, ${pathFmt.join(", ")});\n`
        : `    let path = ${rustString(pathExpr)}.to_owned();\n`;
    s += `    let ${op.queryArgs.length > 0 ? "mut " : ""}query: Vec<(&str, String)> = Vec::new();\n`;
    for (const q of op.queryArgs) {
      const owned = q.type === "String" ? "to_owned" : "to_string";
      s += q.optional
        ? `    if let Some(value) = &${q.ident} {\n        query.push((${rustString(q.name)}, ${q.type === "String" ? "value.clone()" : "value.to_string()"}));\n    }\n`
        : `    query.push((${rustString(q.name)}, ${q.ident}.${owned}()));\n`;
    }
    const mutates = op.headers.length > 0 || op.bearer || op.cookie || op.hasBody;
    s += `    let ${mutates ? "mut " : ""}request = context.request(${rustString(op.verb)}, &path, &query);\n`;
    for (const h of op.headers) {
      if (h.argument !== null) {
        s += h.argument.optional
          ? `    if let Some(value) = &${h.argument.ident} {\n        request.header(${rustString(h.name)}, value.to_string());\n    }\n`
          : `    request.header(${rustString(h.name)}, ${h.argument.ident}.to_string());\n`;
      } else if (h.field !== null) {
        s += `    request.header(${rustString(h.name)}, context.${h.field}.clone());\n`;
      }
    }
    if (op.analytics) {
      s += '    request.headers.retain(|header| header.name != "X-Client-Version");\n';
    }
    if (op.bearer) {
      s += `    context.authorize_bearer(&mut request);\n`;
    }
    if (op.cookie) {
      s += `    request.with_credentials = true;\n`;
    }
    if (op.hasBody) {
      s += `    request.json_body(body)?;\n`;
    }
    return `${s}    Ok(request)\n}\n\n`;
  };

  /** @param {Operation} op */
  const responseParser = (op) => {
    let s = `/// Reads the \`${op.opName}\` response.\npub fn ${op.ident}_response(response: &HttpResponse) -> Result<${op.successType}, ApiError> {\n    match response.status {\n`;
    const optionalBody = op.successType.startsWith("Option<");
    for (const { code, type } of op.successes) {
      s +=
        type === "()"
          ? `        ${code} => Ok(${optionalBody ? "None" : "()"}),\n`
          : `        ${code} => runtime::decode_json::<${type}>(response)${optionalBody ? ".map(Some)" : ""},\n`;
    }
    // In the order the contract declares the statuses.
    for (const [code, models] of op.problems) {
      const candidates = models
        .map(
          (n) =>
            `runtime::candidate::<${n}>(|problem| ApiProblem::${n === genericType ? "Other" : n} { problem })`,
        )
        .join(", ");
      s += `        ${code} => Err(runtime::decode_problem(response, &[${candidates}], |problem: ${genericType}| ApiProblem::Other { problem })),\n`;
    }
    return `${s}        _ => Err(runtime::unexpected_status(response, |problem: ${genericType}| ApiProblem::Other { problem })),\n    }\n}\n\n`;
  };

  /** @param {Operation} op */
  const clientMethod = (op) => {
    const sig = op.args.map((a) => `${a.ident}: ${a.type}`).join(", ");
    const callArgs = op.args
      .map((a) => (a.type.startsWith("Option<") ? a.ident : `&${a.ident}`))
      .join(", ");
    let s = docLines(op.doc, "    ");
    s += `    pub async fn ${op.ident}(&self${sig === "" ? "" : `, ${sig}`}) -> Result<${op.successType}, ApiError> {\n`;
    s += `        let request = ${op.ident}_request(&self.context()${callArgs === "" ? "" : `, ${callArgs}`})?;\n`;
    return `${s}        let response = self.send(request).await?;\n        ${op.ident}_response(&response)\n    }\n\n`;
  };

  let out = `// @generated by sdks/api/emitters/rust-client.js from the TypeSpec contract in sdks/api/public.\n// Do not edit: change the contract or the emitter and run \`pnpm --filter @studio-vaai/api generate\`.\n\n`;
  out += `#![allow(clippy::all, clippy::pedantic, unused_imports)]\n\n`;
  out += `use crate::client::ApiClient;\nuse crate::runtime::{self, ApiError, HttpRequest, HttpResponse, RequestContext, WireModel};\n\n`;
  out += `/// The API version (\`YYYY-MM-DD\`) this client was generated from; sent as \`X-Api-Version\`.\npub const API_VERSION: &str = ${rustString(apiVersion)};\n\n`;
  for (const t of order) {
    out += `${entryOf(t).body}\n`;
  }

  // ApiProblem: every error model, plus the generic one for bodies no model matches.
  const specific = problemModels
    .filter((m) => m !== base)
    .map((m) => ({ model: m, entry: entryOf(m) }));
  out += `/// An error response's body (\`application/problem+json\`), by the error model it matched.\n#[derive(Debug, Clone, PartialEq)]\n#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]\npub enum ApiProblem {\n`;
  for (const { model, entry } of specific) {
    out += `${docLines(getDoc(program, model), "    ")}    ${entry.name} { problem: ${entry.name} },\n`;
  }
  out += `    /// A problem no error model of the operation matched (a newer server, a proxy).\n    Other { problem: ${genericType} },\n}\n\n`;
  out += `#[cfg_attr(feature = "uniffi", uniffi::export)]\nimpl ApiProblem {\n    /// The problem's \`kind\`, whichever model it matched.\n    pub fn kind(&self) -> String {\n        match self {\n`;
  for (const { entry } of specific) {
    out += `            Self::${entry.name} { problem } => ${kindExpression(entry)},\n`;
  }
  out += `            Self::Other { problem } => problem.kind.clone(),\n        }\n    }\n}\n\n`;

  for (const op of ops) {
    out += requestBuilder(op) + responseParser(op);
  }
  out += `#[cfg_attr(feature = "uniffi", uniffi::export)]\nimpl ApiClient {\n`;
  out += ops
    .map((op) => clientMethod(op))
    .join("")
    .replace(/\n\n$/, "\n");
  out += `}\n`;

  const file = resolvePath(context.emitterOutputDir, options["output-file"] ?? "generated.rs");
  await context.program.host.mkdirp(context.emitterOutputDir);
  await context.program.host.writeFile(file, out);
}
