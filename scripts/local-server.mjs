import http from "node:http";
import path from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";

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

server.listen(port, host, () => {
  console.log(`Local family tree server running at http://${host}:${port}`);
});

async function handleSave(request, response) {
  const body = await readJsonBody(request);
  const privateJson = typeof body?.privateJson === "string" ? body.privateJson : "";
  const encryptedJson = typeof body?.encryptedJson === "string" ? body.encryptedJson : "";

  if (!privateJson || !encryptedJson) {
    return sendJson(response, 400, { error: "privateJson and encryptedJson are required." });
  }

  validateJson(privateJson, "Private JSON");
  validateJson(encryptedJson, "Encrypted JSON");

  await writeFile(path.join(rootDir, "data", "family.private.json"), privateJson, "utf8");
  await writeFile(path.join(rootDir, "data", "family.enc.json"), encryptedJson, "utf8");

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

function validateJson(value, label) {
  try {
    JSON.parse(value);
  } catch {
    throw new Error(`${label} is not valid JSON.`);
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(`${JSON.stringify(payload)}\n`);
}
