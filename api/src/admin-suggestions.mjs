import { readFileSync } from "node:fs";

const STATUS_VALUES = new Set(["pending", "accepted", "rejected"]);
const TYPE_VALUES = new Set(["text", "graph"]);
const SUGGESTION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REVIEW_NOTE_LENGTH = 2_000;
const MAX_PATCH_BODY_BYTES = 16 * 1024;
const DEFAULT_LIST_LIMIT = 25;
const MAX_LIST_LIMIT = 50;

let runtimeHandler;
let runtimeRevision;
let runtimeStore;

export async function handler(event) {
  if (!runtimeHandler) {
    runtimeHandler = createAdminSuggestionsHandler({
      expectedClientId: process.env.ADMIN_USER_POOL_CLIENT_ID,
      revision: loadRuntimeRevision(),
      store: getRuntimeStore()
    });
  }
  return runtimeHandler(event);
}

export function createAdminSuggestionsHandler({
  expectedClientId,
  revision,
  store,
  logger = console,
  now = () => new Date()
}) {
  if (typeof expectedClientId !== "string" || !expectedClientId) {
    throw new Error("ADMIN_USER_POOL_CLIENT_ID must be configured.");
  }
  validateRevisionArtifact(revision);
  for (const method of ["query", "get", "update"]) {
    if (typeof store?.[method] !== "function") throw new Error(`Admin store.${method} must be a function.`);
  }

  return async function adminSuggestions(event) {
    const requestId = safeRequestId(event?.requestContext?.requestId);
    const routeKey = safeRouteKey(event?.routeKey);
    const auth = authorize(event, expectedClientId);
    if (!auth.ok) {
      logSafe(logger, "info", { requestId, routeKey, result: auth.category });
      return response(auth.statusCode, { error: auth.message });
    }

    try {
      if (event.routeKey === "GET /admin/suggestions") {
        const result = await listSuggestions(event, store);
        logSafe(logger, "info", { requestId, routeKey, result: "listed", count: result.items.length });
        return response(200, result);
      }

      const suggestionId = validateSuggestionId(event?.pathParameters?.id);
      if (event.routeKey === "GET /admin/suggestions/{id}") {
        const item = await store.get(suggestionId);
        if (!item) throw new AdminRequestError(404, "Suggestion not found", "not_found");
        logSafe(logger, "info", { requestId, routeKey, result: "retrieved" });
        return response(200, { suggestion: sanitizeSuggestion(item) });
      }

      if (event.routeKey === "PATCH /admin/suggestions/{id}") {
        const request = parseReviewRequest(event);
        const current = await store.get(suggestionId);
        if (!current) throw new AdminRequestError(404, "Suggestion not found", "not_found");
        if (request.status === "accepted" && normalizeSuggestionType(current) === "graph") {
          assertCurrentGraphRevision(current, revision);
        }

        const reviewedAt = now().toISOString();
        const updated = await store.update({
          id: suggestionId,
          expectedStatus: current.status,
          expectedUpdatedAt: current.updatedAt,
          status: request.status,
          updatedAt: reviewedAt,
          review: {
            reviewerId: auth.subject,
            reviewedAt,
            note: request.reviewerNote
          }
        });
        if (!updated) throw new AdminRequestError(409, "Suggestion changed; reload and try again", "concurrent_update");
        logSafe(logger, "info", { requestId, routeKey, result: "reviewed", status: request.status });
        return response(200, { suggestion: sanitizeSuggestion(updated) });
      }

      throw new AdminRequestError(404, "Not found", "unknown_route");
    } catch (error) {
      if (error instanceof AdminRequestError) {
        logSafe(logger, "info", { requestId, routeKey, result: "request_rejected", category: error.category });
        return response(error.statusCode, { error: error.message });
      }
      logSafe(logger, "error", {
        requestId,
        routeKey,
        result: "failed",
        ...safeAwsError(error)
      });
      return response(500, { error: "Admin request failed" });
    }
  };
}

async function listSuggestions(event, store) {
  const query = event?.queryStringParameters ?? {};
  rejectQueryKeys(query, new Set(["status", "type", "limit", "nextToken"]));
  const status = query.status ?? "pending";
  if (!STATUS_VALUES.has(status)) throw new AdminRequestError(400, "Invalid status filter", "invalid_status");
  const type = query.type ?? "";
  if (type && !TYPE_VALUES.has(type)) throw new AdminRequestError(400, "Invalid type filter", "invalid_type");
  const limit = parseLimit(query.limit);
  const exclusiveStartKey = query.nextToken ? decodeNextToken(query.nextToken) : undefined;
  const result = await store.query({ status, type: type || undefined, limit, exclusiveStartKey });
  return {
    items: (result.items ?? []).map(sanitizeSuggestionSummary),
    nextToken: result.lastEvaluatedKey ? encodeNextToken(result.lastEvaluatedKey) : null
  };
}

function parseReviewRequest(event) {
  const body = decodeBody(event, MAX_PATCH_BODY_BYTES);
  let request;
  try {
    request = JSON.parse(body || "{}");
  } catch {
    throw new AdminRequestError(400, "Invalid request", "invalid_json");
  }
  if (!isPlainObject(request)) throw new AdminRequestError(400, "Invalid request", "invalid_shape");
  rejectObjectKeys(request, new Set(["status", "reviewerNote"]));
  if (!STATUS_VALUES.has(request.status)) throw new AdminRequestError(400, "Invalid status", "invalid_status");
  const reviewerNote = cleanString(request.reviewerNote, MAX_REVIEW_NOTE_LENGTH);
  return { status: request.status, reviewerNote };
}

function authorize(event, expectedClientId) {
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (!isPlainObject(claims) || typeof claims.sub !== "string" || !claims.sub) {
    return { ok: false, statusCode: 401, message: "Authentication required", category: "unauthenticated" };
  }
  if (claims.token_use !== "access" || claims.client_id !== expectedClientId) {
    return { ok: false, statusCode: 403, message: "Access denied", category: "invalid_token_claims" };
  }
  return { ok: true, subject: claims.sub };
}

function assertCurrentGraphRevision(item, revision) {
  const payload = isPlainObject(item?.payload) ? item.payload : {};
  if (payload.anchorCatalogVersion !== revision.catalogVersion || payload.sourceRevision !== revision.sourceRevision) {
    throw new AdminRequestError(409, "Suggestion uses a stale family revision", "stale_revision");
  }
}

function sanitizeSuggestionSummary(item) {
  const suggestion = sanitizeSuggestion(item);
  return {
    id: suggestion.id,
    schemaVersion: suggestion.schemaVersion,
    type: suggestion.type,
    status: suggestion.status,
    createdAt: suggestion.createdAt,
    updatedAt: suggestion.updatedAt,
    submitter: suggestion.submitter,
    review: suggestion.review
  };
}

export function sanitizeSuggestion(item) {
  const type = normalizeSuggestionType(item);
  const result = {
    id: safeStoredString(item?.id),
    schemaVersion: item?.schemaVersion === 1 ? 1 : 0,
    type,
    status: STATUS_VALUES.has(item?.status) ? item.status : "pending",
    createdAt: safeStoredString(item?.createdAt),
    updatedAt: safeStoredString(item?.updatedAt),
    submitter: sanitizeSubmitter(item),
    payload: type === "graph" ? sanitizeGraphPayload(item?.payload) : sanitizeTextPayload(item),
    review: sanitizeReview(item?.review)
  };
  return result;
}

function normalizeSuggestionType(item) {
  return item?.type === "graph" ? "graph" : "text";
}

function sanitizeSubmitter(item) {
  const source = isPlainObject(item?.submitter) ? item.submitter : item ?? {};
  return {
    name: safeStoredString(source.name ?? source.submitterName),
    email: safeStoredString(source.email),
    relationship: safeStoredString(source.relationship)
  };
}

function sanitizeTextPayload(item) {
  const source = isPlainObject(item?.payload) ? item.payload : item ?? {};
  return { message: safeStoredString(source.message) };
}

function sanitizeGraphPayload(payload) {
  const source = isPlainObject(payload) ? payload : {};
  return {
    anchorPersonId: safeStoredString(source.anchorPersonId),
    anchorCatalogVersion: safeStoredString(source.anchorCatalogVersion),
    sourceRevision: safeStoredString(source.sourceRevision),
    people: Array.isArray(source.people) ? source.people.map((person) => ({
      id: safeStoredString(person?.id),
      firstName: safeStoredString(person?.firstName),
      lastName: safeStoredString(person?.lastName),
      birthday: safeStoredString(person?.birthday),
      gender: safeStoredString(person?.gender)
    })) : [],
    relationships: Array.isArray(source.relationships) ? source.relationships.map((relationship) => ({
      from: safeStoredString(relationship?.from),
      to: safeStoredString(relationship?.to),
      type: safeStoredString(relationship?.type)
    })) : [],
    comment: safeStoredString(source.comment)
  };
}

function sanitizeReview(review) {
  if (!isPlainObject(review)) return null;
  return {
    reviewedAt: safeStoredString(review.reviewedAt),
    reviewerId: safeStoredString(review.reviewerId),
    note: safeStoredString(review.note)
  };
}

function validateRevisionArtifact(revision) {
  const pattern = /^sha256:[a-f0-9]{64}$/;
  if (!isPlainObject(revision)
    || revision.schemaVersion !== 1
    || !pattern.test(revision.catalogVersion)
    || !pattern.test(revision.sourceRevision)) {
    throw new Error("Generated canonical revision artifact is invalid.");
  }
}

function loadRuntimeRevision() {
  if (!runtimeRevision) {
    runtimeRevision = JSON.parse(readFileSync(
      new URL("../generated/canonical-revision.json", import.meta.url),
      "utf8"
    ));
  }
  return runtimeRevision;
}

export function createDynamoStore({ getClient = createDefaultDynamoClient, commands = {} } = {}) {
  let documentClient;

  async function resolveClient() {
    if (!documentClient) {
      documentClient = await getClient();
    }
    return documentClient;
  }

  return {
    async query({ status, type, limit, exclusiveStartKey }) {
      const QueryCommand = commands.QueryCommand ?? (await import("@aws-sdk/lib-dynamodb")).QueryCommand;
      const names = { "#status": "status" };
      const values = { ":status": status };
      const input = {
        TableName: process.env.SUGGESTIONS_TABLE_NAME,
        IndexName: "status-createdAt-index",
        KeyConditionExpression: "#status = :status",
        ExpressionAttributeNames: names,
        ExpressionAttributeValues: values,
        Limit: limit,
        ScanIndexForward: false,
        ExclusiveStartKey: exclusiveStartKey
      };
      if (type) {
        names["#type"] = "type";
        values[":type"] = type;
        input.FilterExpression = "#type = :type";
      }
      const result = await (await resolveClient()).send(new QueryCommand(input));
      return { items: result.Items ?? [], lastEvaluatedKey: result.LastEvaluatedKey };
    },

    async get(id) {
      const GetCommand = commands.GetCommand ?? (await import("@aws-sdk/lib-dynamodb")).GetCommand;
      const result = await (await resolveClient()).send(new GetCommand({
        TableName: process.env.SUGGESTIONS_TABLE_NAME,
        Key: { id },
        ConsistentRead: true
      }));
      return result.Item ?? null;
    },

    async update({ id, expectedStatus, expectedUpdatedAt, status, updatedAt, review }) {
      const UpdateCommand = commands.UpdateCommand ?? (await import("@aws-sdk/lib-dynamodb")).UpdateCommand;
      const hasExpectedUpdatedAt = typeof expectedUpdatedAt === "string" && expectedUpdatedAt;
      try {
        const result = await (await resolveClient()).send(new UpdateCommand({
          TableName: process.env.SUGGESTIONS_TABLE_NAME,
          Key: { id },
          UpdateExpression: "SET #status = :status, #updatedAt = :updatedAt, #review = :review",
          ConditionExpression: hasExpectedUpdatedAt
            ? "#status = :expectedStatus AND #updatedAt = :expectedUpdatedAt"
            : "#status = :expectedStatus AND attribute_not_exists(#updatedAt)",
          ExpressionAttributeNames: {
            "#status": "status",
            "#updatedAt": "updatedAt",
            "#review": "review"
          },
          ExpressionAttributeValues: {
            ":status": status,
            ":updatedAt": updatedAt,
            ":review": review,
            ":expectedStatus": expectedStatus,
            ...(hasExpectedUpdatedAt ? { ":expectedUpdatedAt": expectedUpdatedAt } : {})
          },
          ReturnValues: "ALL_NEW"
        }));
        return result.Attributes ?? null;
      } catch (error) {
        if (error?.name === "ConditionalCheckFailedException") return null;
        throw error;
      }
    }
  };
}

function parseLimit(value) {
  if (value === undefined || value === "") return DEFAULT_LIST_LIMIT;
  if (!/^\d{1,2}$/.test(value)) throw new AdminRequestError(400, "Invalid limit", "invalid_limit");
  const limit = Number(value);
  if (limit < 1 || limit > MAX_LIST_LIMIT) throw new AdminRequestError(400, "Invalid limit", "invalid_limit");
  return limit;
}

function encodeNextToken(key) {
  const safe = {
    id: safeStoredString(key.id),
    status: safeStoredString(key.status),
    createdAt: safeStoredString(key.createdAt)
  };
  return Buffer.from(JSON.stringify(safe), "utf8").toString("base64url");
}

function decodeNextToken(value) {
  try {
    if (typeof value !== "string" || value.length > 1_024 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error();
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    rejectObjectKeys(parsed, new Set(["id", "status", "createdAt"]));
    for (const key of ["id", "status", "createdAt"]) {
      if (typeof parsed[key] !== "string" || !parsed[key]) throw new Error();
    }
    return parsed;
  } catch {
    throw new AdminRequestError(400, "Invalid pagination token", "invalid_next_token");
  }
}

function validateSuggestionId(value) {
  if (typeof value !== "string" || !SUGGESTION_ID_PATTERN.test(value)) {
    throw new AdminRequestError(400, "Invalid suggestion id", "invalid_id");
  }
  return value;
}

function decodeBody(event, maxBytes) {
  const body = event?.body ?? "";
  if (typeof body !== "string") throw new AdminRequestError(400, "Invalid request", "invalid_body");
  let text;
  try {
    text = event?.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;
  } catch {
    throw new AdminRequestError(400, "Invalid request", "invalid_encoding");
  }
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new AdminRequestError(413, "Payload too large", "payload_too_large");
  return text;
}

function cleanString(value, maxLength) {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") throw new AdminRequestError(400, "Invalid request", "invalid_field");
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (cleaned.length > maxLength) throw new AdminRequestError(400, "Invalid request", "invalid_field");
  return cleaned;
}

function rejectQueryKeys(value, allowed) {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new AdminRequestError(400, "Invalid query", "unknown_query");
  }
}

function rejectObjectKeys(value, allowed) {
  if (!isPlainObject(value) || Object.keys(value).some((key) => !allowed.has(key))) {
    throw new AdminRequestError(400, "Invalid request", "unknown_key");
  }
}

function safeStoredString(value) {
  return typeof value === "string" ? value : "";
}

function safeRequestId(value) {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value) ? value : "unknown";
}

function safeRouteKey(value) {
  return typeof value === "string" && /^[A-Z]+ \/[A-Za-z0-9{}\/_-]{1,128}$/.test(value) ? value : "unknown";
}

function safeAwsError(error) {
  const metadata = isPlainObject(error?.$metadata) ? error.$metadata : {};
  const safe = {
    errorName: safeLogString(error?.name, "UnknownError"),
    errorMessage: safeLogMessage(error?.message)
  };
  if (Number.isInteger(metadata.httpStatusCode)) safe.httpStatusCode = metadata.httpStatusCode;
  const awsRequestId = safeRequestId(metadata.requestId);
  if (awsRequestId !== "unknown") safe.awsRequestId = awsRequestId;
  return safe;
}

function safeLogString(value, fallback) {
  if (typeof value !== "string" || !value) return fallback;
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 128);
}

function safeLogMessage(value) {
  if (typeof value !== "string" || !value) return "Unknown AWS error";
  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-token]")
    .replace(/\bbearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\b(?:password|access\s*code|submission\s*code|family\s*password)\s*[:=]\s*[^\s,;]+/gi, "[redacted-secret]")
    .slice(0, 512);
}

function logSafe(logger, level, metadata) {
  const method = typeof logger?.[level] === "function" ? logger[level].bind(logger) : null;
  method?.("admin_suggestion_request", metadata);
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

async function createDefaultDynamoClient() {
  const { DynamoDBClient } = await import("@aws-sdk/client-dynamodb");
  const { DynamoDBDocumentClient } = await import("@aws-sdk/lib-dynamodb");
  return DynamoDBDocumentClient.from(new DynamoDBClient({}));
}

function getRuntimeStore() {
  if (!runtimeStore) runtimeStore = createDynamoStore();
  return runtimeStore;
}

class AdminRequestError extends Error {
  constructor(statusCode, message, category) {
    super(message);
    this.name = "AdminRequestError";
    this.statusCode = statusCode;
    this.category = category;
  }
}
