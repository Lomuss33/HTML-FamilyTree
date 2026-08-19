import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const MAX_BODY_BYTES = 8 * 1024;
const MAX_NAME_LENGTH = 100;
const MAX_EMAIL_LENGTH = 254;
const MAX_RELATIONSHIP_LENGTH = 120;
const MAX_MESSAGE_LENGTH = 2_000;

let runtimeHandler;

export async function handler(event) {
  if (!runtimeHandler) {
    runtimeHandler = createHandler({
      accessCode: process.env.SUBMISSION_ACCESS_CODE,
      retentionDays: process.env.SUGGESTION_RETENTION_DAYS,
      putSuggestion: putSuggestionInDynamo
    });
  }

  return runtimeHandler(event);
}

export function createHandler({ accessCode, retentionDays = 365, putSuggestion }) {
  const expectedCodeDigest = digestAccessCode(accessCode);
  const retentionSeconds = Number(retentionDays) * 24 * 60 * 60;

  return async function submitSuggestion(event) {
    try {
      const payload = parseRequestBody(event);
      const suggestion = validateSuggestion(payload);

      if (!hasValidAccessCode(payload.accessCode, expectedCodeDigest)) {
        return response(401, { error: "The submission access code is invalid." });
      }

      const createdAt = new Date().toISOString();
      const item = {
        id: randomUUID(),
        status: "pending",
        createdAt,
        expiresAt: Math.floor(Date.now() / 1000) + retentionSeconds,
        ...suggestion
      };

      await putSuggestion(item);
      return response(201, { ok: true, id: item.id, createdAt });
    } catch (error) {
      if (error instanceof RequestError) {
        return response(error.statusCode, { error: error.message });
      }

      console.error("Unable to store family suggestion.", error);
      return response(500, { error: "Unable to save the suggestion. Please try again later." });
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

function parseRequestBody(event) {
  const body = event?.body ?? "";
  const text = event?.isBase64Encoded ? Buffer.from(body, "base64").toString("utf8") : body;

  if (Buffer.byteLength(text, "utf8") > MAX_BODY_BYTES) {
    throw new RequestError(413, "The suggestion is too large.");
  }

  try {
    const parsed = JSON.parse(text);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("Invalid request shape");
    }
    return parsed;
  } catch {
    throw new RequestError(400, "Enter a valid suggestion before submitting.");
  }
}

function validateSuggestion(payload) {
  const submitterName = cleanField(payload.submitterName, "Your name", MAX_NAME_LENGTH, true);
  const email = cleanField(payload.email, "Email", MAX_EMAIL_LENGTH, false);
  const relationship = cleanField(payload.relationship, "Relationship", MAX_RELATIONSHIP_LENGTH, false);
  const message = cleanField(payload.message, "Suggestion", MAX_MESSAGE_LENGTH, true);

  if (email && !isPlausibleEmail(email)) {
    throw new RequestError(400, "Enter a valid email address or leave it blank.");
  }

  return { submitterName, email, relationship, message };
}

function cleanField(value, label, maxLength, required) {
  if (value === undefined || value === null) {
    if (required) {
      throw new RequestError(400, `${label} is required.`);
    }
    return "";
  }

  if (typeof value !== "string") {
    throw new RequestError(400, `${label} must be text.`);
  }

  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if (required && !cleaned) {
    throw new RequestError(400, `${label} is required.`);
  }
  if (cleaned.length > maxLength) {
    throw new RequestError(400, `${label} must be ${maxLength} characters or fewer.`);
  }
  return cleaned;
}

function isPlausibleEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function digestAccessCode(value) {
  if (!value || typeof value !== "string") {
    throw new Error("SUBMISSION_ACCESS_CODE is not configured.");
  }
  return createHmac("sha256", "family-tree-submission-code-v1").update(value, "utf8").digest();
}

function hasValidAccessCode(value, expectedDigest) {
  if (!value || typeof value !== "string") {
    return false;
  }

  const receivedDigest = createHmac("sha256", "family-tree-submission-code-v1").update(value, "utf8").digest();
  return receivedDigest.length === expectedDigest.length && timingSafeEqual(receivedDigest, expectedDigest);
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
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}
