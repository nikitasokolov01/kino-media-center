// Manifest validation. Per the MVP spec we require: id, name, resources, types.

import type { StremioManifest } from "./types.js";

export interface ManifestValidationError {
  field: string;
  message: string;
}

export class InvalidManifestError extends Error {
  errors: ManifestValidationError[];
  constructor(errors: ManifestValidationError[]) {
    super(
      "Invalid Stremio manifest: " +
        errors.map((e) => `${e.field} — ${e.message}`).join("; "),
    );
    this.name = "InvalidManifestError";
    this.errors = errors;
  }
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isResourceArray(v: unknown): boolean {
  if (!Array.isArray(v) || v.length === 0) return false;
  return v.every((r) => {
    if (typeof r === "string") return r.length > 0;
    if (r && typeof r === "object" && typeof (r as { name?: unknown }).name === "string") {
      return ((r as { name: string }).name).length > 0;
    }
    return false;
  });
}

/**
 * Validate that a value is a Stremio manifest with the required MVP fields.
 * Throws InvalidManifestError on failure; returns a typed manifest on success.
 */
export function validateManifest(raw: unknown): StremioManifest {
  const errors: ManifestValidationError[] = [];

  if (!raw || typeof raw !== "object") {
    throw new InvalidManifestError([
      { field: "(root)", message: "manifest is not an object" },
    ]);
  }

  const obj = raw as Record<string, unknown>;

  if (!isNonEmptyString(obj.id)) {
    errors.push({ field: "id", message: "must be a non-empty string" });
  }
  if (!isNonEmptyString(obj.name)) {
    errors.push({ field: "name", message: "must be a non-empty string" });
  }
  if (!isResourceArray(obj.resources)) {
    errors.push({
      field: "resources",
      message: "must be a non-empty array of strings or {name} objects",
    });
  }
  if (!isStringArray(obj.types) || (obj.types as string[]).length === 0) {
    errors.push({
      field: "types",
      message: "must be a non-empty array of strings",
    });
  }

  if (errors.length > 0) {
    throw new InvalidManifestError(errors);
  }

  return obj as unknown as StremioManifest;
}
