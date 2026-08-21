import http from "node:http";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { validateFamilyData } from "./validate-family-data.mjs";

const rootDir = path.resolve(".");
const host = "127.0.0.1";
const port = Number(process.env.PORT || 4173);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".ico", "image/x-icon"]
]);

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/status") {
      return sendJson(response, 200, { localSave: true });
    }

    if (request.method === "POST" && url.pathname === "/api/save") {
      return handleSave(request, response);
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Method Not Allowed");
      return;
    }

    return serveStatic(url.pathname, response, request.method === "HEAD");
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Internal Server Error");
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  server.listen(port, host, () => {
    console.log(`Local family tree server running at http://${host}:${port}`);
  });
}

async function handleSave(request, response) {
  let privateJson;
  let encryptedJson;
  try {
    const body = await readJsonBody(request);
    privateJson = typeof body?.privateJson === "string" ? body.privateJson : "";
    encryptedJson = typeof body?.encryptedJson === "string" ? body.encryptedJson : "";
    validateSavePayload(privateJson, encryptedJson);
  } catch (error) {
    return sendJson(response, 400, {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  const privatePath = path.join(rootDir, "data", "family.private.json");
  const encryptedPath = path.join(rootDir, "data", "family.enc.json");
  await saveFamilyFiles({ privateJson, encryptedJson, privatePath, encryptedPath });

  return sendJson(response, 200, { ok: true });
}

async function serveStatic(requestPath, response, headOnly) {
  const normalizedPath = requestPath === "/" ? "/index.html" : requestPath;
  const safePath = path.normalize(normalizedPath).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(rootDir, safePath);

  if (!filePath.startsWith(rootDir)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not Found");
    return;
  }

  if (fileStat.isDirectory()) {
    return serveStatic(path.posix.join(normalizedPath, "index.html"), response, headOnly);
  }

  const extension = path.extname(filePath).toLowerCase();
  const contentType = mimeTypes.get(extension) ?? "application/octet-stream";
  const buffer = await readFile(filePath);
  response.writeHead(200, {
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  });

  if (headOnly) {
    response.end();
    return;
  }

  response.end(buffer);
}

async function readJsonBody(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(body || "{}");
}

export function validateSavePayload(privateJson, encryptedJson) {
  if (!privateJson || !encryptedJson) {
    throw new Error("privateJson and encryptedJson are required.");
  }
  const privateNodes = parseJson(privateJson, "Private JSON");
  validateFamilyData(privateNodes);
  validateEncryptedPayload(parseJson(encryptedJson, "Encrypted JSON"));
  return privateNodes;
}

export async function saveFamilyFiles({ privateJson, encryptedJson, privatePath, encryptedPath }) {
  validateSavePayload(privateJson, encryptedJson);
  await writeFilesFailBeforeReplace([
    [privatePath, privateJson],
    [encryptedPath, encryptedJson]
  ]);
}

function parseJson(value, label) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function validateEncryptedPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("Encrypted JSON must be an encryption payload object.");
  }
  if (payload.version !== 1 || payload.kdf !== "PBKDF2" || payload.hash !== "SHA-256") {
    throw new Error("Encrypted JSON uses an unsupported encryption format.");
  }
  if (!Number.isInteger(payload.iterations) || payload.iterations < 100000) {
    throw new Error("Encrypted JSON has an invalid PBKDF2 iteration count.");
  }
  for (const field of ["salt", "iv", "ciphertext"]) {
    if (typeof payload[field] !== "string" || !payload[field]) {
      throw new Error(`Encrypted JSON field "${field}" must be a non-empty string.`);
    }
  }
}

async function writeFilesFailBeforeReplace(entries) {
  const temporaryFiles = [];
  try {
    for (const [targetPath, content] of entries) {
      const temporaryPath = path.join(
        path.dirname(targetPath),
        `.${path.basename(targetPath)}.${randomUUID()}.tmp`
      );
      await writeFile(temporaryPath, content, "utf8");
      temporaryFiles.push([temporaryPath, targetPath]);
    }

    for (const [temporaryPath, targetPath] of temporaryFiles) {
      await rename(temporaryPath, targetPath);
    }
  } finally {
    await Promise.all(temporaryFiles.map(([temporaryPath]) => rm(temporaryPath, { force: true })));
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
