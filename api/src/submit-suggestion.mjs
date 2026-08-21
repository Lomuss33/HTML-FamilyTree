import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  GraphSuggestionValidationError,
  validateGraphSuggestion
} from "./validate-graph-suggestion.mjs";

export const MAX_BODY_BYTES = 64 * 1024;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_RELATIONSHIP_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 2_000;
const LEGACY_TEXT_KEYS = new Set([
  "accessCode",
  "submitterName",
  "email",
  "relationship",
  "message"
]);
const V1_TEXT_KEYS = new Set([...LEGACY_TEXT_KEYS, "schemaVersion", "type"]);

let runtimeHandler;
let runtimeAllowlist;

export async function handler(event) {
  if (!runtimeHandler) {
    runtimeHandler = createHandler({
      accessCode: process.env.SUBMISSION_ACCESS_CODE,
      retentionDays: process.env.SUGGESTION_RETENTION_DAYS,
      anchorAllowlist: loadRuntimeAllowlist(),
      putSuggestion: putSuggestionInDynamo
    });
  }

  return runtimeHandler(event);
}

export function createHandler({
  accessCode,
  retentionDays = 365,
  anchorAllowlist = { catalogVersion: "sha256:" + "0".repeat(64), anchorIds: [] },
  putSuggestion,
  logger = console,
  now = () => new Date(),
  createId = randomUUID
}) {
  if (typeof putSuggestion !== "function") throw new Error("putSuggestion must be a function.");
  const expectedCodeDigest = digestAccessCode(accessCode);
  const retentionNumber = Number(retentionDays);
  if (!Number.isFinite(retentionNumber) || retentionNumber <= 0) {
    throw new Error("SUGGESTION_RETENTION_DAYS must be a positive number.");
  }
  const retentionSeconds = retentionNumber * 24 * 60 * 60;

  return async function submitSuggestion(event) {
    const requestId = safeRequestId(event?.requestContext?.requestId);
    let suggestionType = "unknown";
    try {
      const request = parseRequestBody(event);
      suggestionType = request.type === "graph" ? "graph" : "text";

      // Authenticate before validating anchor membership so this endpoint cannot
      // be used to probe which canonical ids are approved.
      if (!hasValidAccessCode(request.accessCode, expectedCodeDigest)) {
        logSafe(logger, "info", { requestId, suggestionType, result: "authorization_failed" });
        return response(403, { error: "Invalid access code" });
      }

      const normalized = request.type === "graph"
        ? validateGraphSuggestion(request, anchorAllowlist)
        : validateTextSuggestion(request);
      const clock = now();
      const createdAt = clock.toISOString();
      const item = {
        id: createId(),
        schemaVersion: 1,
        type: suggestionType,
        status: "pending",
        createdAt,
        updatedAt: createdAt,
        expiresAt: Math.floor(clock.getTime() / 1000) + retentionSeconds,
        submitter: normalized.submitter,
        payload: normalized.payload
      };

      await putSuggestion(item);
      logSafe(logger, "info", { requestId, suggestionType, result: "stored" });
      return response(201, { ok: true, id: item.id });
    } catch (error) {
      if (error instanceof RequestError || error instanceof GraphSuggestionValidationError) {
        logSafe(logger, "info", {
          requestId,
          suggestionType,
          result: "validation_failed",
          category: error.category ?? "request"
        });
        return response(error.statusCode, { error: error.message });
      }

      logSafe(logger, "error", { requestId, suggestionType, result: "storage_failed" });
      return response(500, { error: "Submission failed" });
    }
  };
}

async function putSuggestionInDynamo(item) {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { PutCommand, DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({}));

  await client.send(new PutCommand({
    TableName: process.env.SUGGESTIONS_TABLE_NAME,
    Item: item,
    ConditionExpression: "attribute_not_exists(id)"
  }));
}

function loadRuntimeAllowlist() {
  if (!runtimeAllowlist) {
    runtimeAllowlist = JSON.parse(readFileSync(
      new URL("../generated/public-anchor-allowlist.json", import.meta.url),
      "utf8"
    ));
  }
  return runtimeAllowlist;
}

function parseRequestBody(event) {
  const body = event?.body ?? "";
  if (typeof body !== "string") throw new RequestError(400, "Invalid request", "invalid_json");
  let text;
  try {
    text = event?.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
  } catch {
    throw new RequestError(400, "Invalid request", "invalid_encoding");
  }

  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new RequestError(413, "Payload too large", "payload_too_large");
  }

  try {
    const parsed = JSON.parse(text);
    if (!isPlainObject(parsed)) throw new Error("Invalid request shape");
    return parsed;
  } catch {
    throw new RequestError(400, "Invalid request", "invalid_json");
  }
}

function validateTextSuggestion(request) {
  const isV1 = request.schemaVersion !== undefined || request.type !== undefined;
  if (isV1 && (request.schemaVersion !== 1 || request.type !== "text")) {
    throw new RequestError(400, "Invalid request", "unsupported_text_schema");
  }
  rejectUnknownKeys(request, isV1 ? V1_TEXT_KEYS : LEGACY_TEXT_KEYS);

  const name = cleanField(request.submitterName, MAX_NAME_LENGTH, true);
  const email = cleanField(request.email, MAX_EMAIL_LENGTH, false);
  const relationship = cleanField(request.relationship, MAX_RELATIONSHIP_LENGTH, false);
  const message = cleanField(request.message, MAX_MESSAGE_LENGTH, true);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new RequestError(400, "Invalid request", "invalid_email");
  }

  return {
    submitter: { name, email, relationship },
    payload: { message }
  };
}

function rejectUnknownKeys(value, allowedKeys) {
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw new RequestError(400, "Invalid request", "unknown_key");
  }
}

function cleanField(value, maxLength, required) {
  if (value === undefined || value === null) {
    if (required) throw new RequestError(400, "Invalid request", "missing_field");
    return "";
  }
  if (typeof value !== "string") throw new RequestError(400, "Invalid request", "invalid_field");
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if ((required && !cleaned) || cleaned.length > maxLength) {
    throw new RequestError(400, "Invalid request", "invalid_field");
  }
  return cleaned;
}

function digestAccessCode(value) {
  if (!value || typeof value !== "string") {
    throw new Error("SUBMISSION_ACCESS_CODE is not configured.");
  }
  return createHmac("sha256", "family-tree-submission-code-v1").update(value, "utf8").digest();
}

function hasValidAccessCode(value, expectedDigest) {
  if (!value || typeof value !== "string") return false;
  const receivedDigest = createHmac("sha256", "family-tree-submission-code-v1")
    .update(value, "utf8")
    .digest();
  return receivedDigest.length === expectedDigest.length && timingSafeEqual(receivedDigest, expectedDigest);
}

function logSafe(logger, level, metadata) {
  const method = typeof logger?.[level] === "function" ? logger[level].bind(logger) : null;
  method?.("suggestion_request", metadata);
}

function safeRequestId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : "unknown";
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    },
    body: JSON.stringify(body)
  };
}

class RequestError extends Error {
  constructor(statusCode, message, category) {
    super(message);
    this.name = "RequestError";
    this.statusCode = statusCode;
    this.category = category;
  }
}
