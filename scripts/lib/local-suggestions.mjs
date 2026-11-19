import { randomUUID, createHash, randomBytes } from "node:crypto";
import { mkdir, open, readFile, readdir, rename, link, unlink } from "node:fs/promises";
import path from "node:path";
import { FamilyWorkflowError, assertSafePath, readJson, fileExists } from "./project-paths.mjs";
import { withWriterLock } from "./file-transaction.mjs";
import { createHandler, digestAccessCode, hasValidAccessCode } from "../../api/src/submit-suggestion.mjs";
import { listSuggestions, parseReviewRequest, assertCurrentGraphRevision, sanitizeSuggestion, validateSuggestionId } from "../../api/src/admin-suggestions.mjs";
import { createFamilyAdditionsPatch } from "../../assets/admin/patch-model.js";
import { applyFamilyAdditions } from "../apply-family-additions.mjs";
import { readFamilySnapshot } from "./family-workflow.mjs";
import { createMediaStore } from "./media-store.mjs";
import { validateFamilyData } from "../validate-family-data.mjs";
import { MAX_GALLERY_IMAGES } from "../../assets/viewer/media-data.js";
import { MAX_SUGGESTION_PHOTOS, PHOTO_TOKEN, safePhotoName, validSuggestionPhoto } from "../../assets/suggestions/photo-data.js";
import { validateProfileChange, validateProfileSelection, applyProfileChange } from "../../assets/suggestions/profile-change.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function createLocalSuggestions(paths, { logger = console, now = () => new Date() } = {}) {
  const directory = path.join(paths.privateDir, "suggestions");
  const records = path.join(directory, "records");
  const settingsFile = path.join(directory, "settings.json");
  const uploads = path.join(directory, "uploads");
  const pendingMedia = createMediaStore({ ...paths, media: path.join(directory, "media") });
  const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/;
  async function atomicWrite(file, value, isNew = false) {
    await assertSafePath(paths.root, file);
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(JSON.stringify(value, null, 2) + "\n");
    if (!isNew && await fileExists(file)) {
      const before = await readFile(file);
      const recovery = path.join(directory, "history", randomUUID() + ".json");
      await assertSafePath(paths.root, recovery);
      await mkdir(path.dirname(recovery), { recursive: true, mode: 0o700 });
      await writeVerified(recovery, before);
    }
    const temporary = await assertSafePath(paths.root, path.join(path.dirname(file), "write-" + randomUUID()));
    await writeVerified(temporary, bytes);
    try {
      if (isNew) await link(temporary, file);
      else await rename(temporary, file);
    } finally { if (await fileExists(temporary)) await unlink(temporary); }
  }
  async function writeVerified(file, bytes) {
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    if (hash(await readFile(file)) !== hash(bytes)) throw new Error("Suggestion write verification failed.");
  }
  async function settings() {
    await assertSafePath(paths.root, settingsFile);
    if (!await fileExists(settingsFile)) return { schemaVersion: 1, enabled: false };
    const value = await readJson(settingsFile);
    if (!value || value.schemaVersion !== 1 || typeof value.enabled !== "boolean"
      || (value.codeDigest !== undefined && !/^[a-f0-9]{64}$/.test(value.codeDigest))
      || (value.enabled && !value.codeDigest)) throw new FamilyWorkflowError("SUGGESTIONS_UNAVAILABLE", "Local suggestion settings need inspection.", 503);
    return value;
  }
  async function get(id) {
    validateSuggestionId(id);
    const file = await assertSafePath(paths.root, path.join(records, id + ".json"));
    if (!await fileExists(file)) return null;
    const item = await readJson(file);
    if (!item || item.id !== id || item.schemaVersion !== 1 || !["text", "graph"].includes(item.type)
      || !["pending", "accepted", "rejected"].includes(item.status)
      || typeof item.createdAt !== "string") throw new FamilyWorkflowError("SUGGESTIONS_UNAVAILABLE", "A local suggestion record needs inspection.", 503);
    return item;
  }
  const store = { get, async query({ status, type, limit, exclusiveStartKey }) {
    const items = [];
    await assertSafePath(paths.root, records);
    if (await fileExists(records)) for (const name of await readdir(records)) {
      if (!idPattern.test(name)) continue;
      const item = await get(name.slice(0, -5));
      if (item.status === status && (!type || item.type === type)) items.push(item);
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
    let remaining = items;
    if (exclusiveStartKey) {
      if (exclusiveStartKey.status !== status) throw new FamilyWorkflowError("INVALID_REQUEST", "The suggestion cursor does not match this filter.");
      remaining = items.filter(item => item.createdAt < exclusiveStartKey.createdAt
        || (item.createdAt === exclusiveStartKey.createdAt && item.id < exclusiveStartKey.id));
    }
    const page = remaining.slice(0, limit);
    const last = page.at(-1);
    return { items: page, ...(remaining.length > page.length && last ? { lastEvaluatedKey: { id: last.id, status: last.status, createdAt: last.createdAt } } : {}) };
  } };
  async function wrap(action) {
    try { return await action(); }
    catch (error) {
      if (error.statusCode >= 400 && error.statusCode < 500 && error.category) throw new FamilyWorkflowError("INVALID_SUGGESTION_REQUEST", error.message, error.statusCode);
      throw error;
    }
  }
  function assertReviewRevision(item, expected) {
    if (!item) throw new FamilyWorkflowError("NOT_FOUND", "Suggestion not found.", 404);
    if (!/^[a-f0-9]{64}$/.test(expected ?? "")) throw new FamilyWorkflowError("INVALID_REQUEST", "Load the suggestion before reviewing it.");
    if (hash(JSON.stringify(item)) !== expected) throw new FamilyWorkflowError("STALE_REVIEW", "Suggestion changed; reload it before reviewing.", 409);
  }
  async function requireGuestCode(accessCode) {
    const current = await settings();
    if (!current.enabled || !hasValidAccessCode(accessCode, Buffer.from(current.codeDigest, "hex"))) {
      throw new FamilyWorkflowError("INVALID_CODE", "The submission access code is invalid.", 403);
    }
    return current;
  }
  function attachments(item) {
    const photos = item.attachments ?? [];
    if (!Array.isArray(photos) || photos.length > MAX_SUGGESTION_PHOTOS || photos.some(photo => !validSuggestionPhoto(photo))
      || new Set(photos.map(photo => photo.id)).size !== photos.length) throw new FamilyWorkflowError("INVALID_ATTACHMENTS", "Suggestion photographs need inspection.", 409);
    return photos.map(photo => ({ ...photo }));
  }
  function safeSuggestion(item) {
    const photos = attachments(item);
    const result = { ...sanitizeSuggestion(item), ...(photos.length ? { attachments: photos } : {}) };
    if (item.profileChange) {
      result.profileChange = validateProfileChange(item.profileChange);
      if (item.profileApproval) {
        if (!/^sha256:[a-f0-9]{64}$/.test(item.profileApproval.baseSnapshotId ?? "")) throw new FamilyWorkflowError("INVALID_PROFILE_REVIEW", "Odobrenje ispravka treba provjeriti.", 409);
        result.profileApproval = { fields: validateProfileSelection(result.profileChange, item.profileApproval.fields), baseSnapshotId: item.profileApproval.baseSnapshotId };
      }
    }
    return result;
  }
  async function resolveUploads(values) {
    if (!Array.isArray(values) || values.length > MAX_SUGGESTION_PHOTOS) throw new FamilyWorkflowError("INVALID_ATTACHMENTS", "Choose at most six photographs.");
    const photos = [];
    for (const value of values) {
      if (!value || Object.keys(value).sort().join() !== "caption,token" || typeof value.token !== "string" || !PHOTO_TOKEN.test(value.token)
        || typeof value.caption !== "string" || value.caption.length > 2000) throw new FamilyWorkflowError("INVALID_ATTACHMENTS", "Invalid photo attachment.");
      const file = await assertSafePath(paths.root, path.join(uploads, value.token + ".json"));
      if (!await fileExists(file)) throw new FamilyWorkflowError("INVALID_ATTACHMENTS", "Upload this photograph again.");
      const photo = { ...await readJson(file), caption: value.caption };
      if (!validSuggestionPhoto(photo) || photos.some(previous => previous.id === photo.id)) throw new FamilyWorkflowError("INVALID_ATTACHMENTS", "Invalid or duplicate photo attachment.");
      if ((await pendingMedia.read(photo.id)).type !== photo.type) throw new FamilyWorkflowError("INVALID_ATTACHMENTS", "Photo verification failed.");
      photos.push(photo);
    }
    return photos;
  }
  // Caller holds the same writer lock as a family Save. Prepare a coherent
  // candidate using the existing CLI validator, without replacing any artifact.
  async function prepareDraft(item, expectedSnapshotId) {
    if (item.profileChange) {
      const snapshot = await readFamilySnapshot(paths);
      if (snapshot.snapshotId !== expectedSnapshotId) throw new FamilyWorkflowError("STALE_SNAPSHOT", "Stablo je spremljeno u drugoj sesiji. Ponovno ga otključaj prije prihvaćanja ispravka.", 409);
      if (item.profileApproval && item.profileApproval.baseSnapshotId !== snapshot.snapshotId) throw new FamilyWorkflowError("STALE_PROFILE_APPROVAL", "Stablo je spremljeno nakon ovog odobrenja. Vrati prijedlog na čekanje i ponovno ga pregledaj.", 409);
      const nodes = applyProfileChange(snapshot.nodes, item.profileChange, item.profileApproval?.fields);
      try { validateFamilyData(nodes); }
      catch { throw new FamilyWorkflowError("INVALID_PROFILE_CHANGE", "Predloženi podaci nisu valjani. Stablo nije promijenjeno."); }
      return { nodes, baseSnapshotId: snapshot.snapshotId, suggestionId: item.id };
    }
    const revision = await readJson(paths.revision);
    assertCurrentGraphRevision(item, revision);
    if (!/^sha256:[a-f0-9]{64}$/.test(expectedSnapshotId ?? "")) throw new FamilyWorkflowError("INVALID_REQUEST", "Unlock the current tree before adding a suggestion to its draft.");
    const snapshot = await readFamilySnapshot(paths);
    if (snapshot.snapshotId !== expectedSnapshotId) throw new FamilyWorkflowError("STALE_SNAPSHOT", "A newer tree was saved elsewhere. Reload and unlock before adding this suggestion.", 409);
    try {
      const patch = createFamilyAdditionsPatch(sanitizeSuggestion(item), revision);
      const nodes = applyFamilyAdditions(snapshot.nodes, patch, { catalogVersion: revision.catalogVersion });
      return { nodes, baseSnapshotId: snapshot.snapshotId, suggestionId: item.id };
    } catch {
      // Validation diagnostics can include private ids. Only fixed text crosses
      // the local API boundary or enters operational logs.
      throw new FamilyWorkflowError("INVALID_ADDITIONS", "The proposed people or relationships conflict with the current tree. Nothing was added.");
    }
  }
  return {
    async publicState() { return { submissionCodeConfigured: (await settings()).enabled }; },
    async uploadPhoto(body) {
      await requireGuestCode(body?.accessCode);
      if (!body || Object.keys(body).sort().join() !== "accessCode,content,name,type" || typeof body.name !== "string" || body.name.length > 255) {
        throw new FamilyWorkflowError("INVALID_REQUEST", "Invalid photo upload.");
      }
      return withWriterLock(paths, async () => {
        const result = await pendingMedia.putEncoded(body.content, body.type);
        const photo = { ...result, name: safePhotoName(body.name, result.type), caption: "" };
        const token = randomBytes(32).toString("hex");
        await atomicWrite(path.join(uploads, token + ".json"), photo, true);
        return { ok: true, token, photo };
      });
    },
    async readPhoto(id, photoId) { return wrap(async () => {
      const item = await get(id);
      if (!item || !attachments(item).some(photo => photo.id === photoId)) throw new FamilyWorkflowError("NOT_FOUND", "Photo not found.", 404);
      return pendingMedia.read(photoId);
    }); },
    async configure({ accessCode, enabled = true, password }) {
      if (typeof enabled !== "boolean" || (enabled && (typeof accessCode !== "string" || accessCode.length < 8 || accessCode.length > 200
        || accessCode !== accessCode.trim() || accessCode === password))) throw new FamilyWorkflowError("INVALID_CODE", "Use a separate submission code of 8–200 characters, different from the family password.");
      return withWriterLock(paths, async () => {
        const previous = await settings();
        const value = { schemaVersion: 1, enabled,
          ...(enabled ? { codeDigest: digestAccessCode(accessCode).toString("hex") } : previous.codeDigest ? { codeDigest: previous.codeDigest } : {}) };
        await atomicWrite(settingsFile, value);
        return { submissionCodeConfigured: enabled };
      });
    },
    async submit(body) {
      const current = await settings();
      if (!current.enabled) return { statusCode: 403, body: JSON.stringify({ error: "Submission is not enabled" }) };
      let profileChange = null;
      if (body && Object.hasOwn(body, "profileChange")) {
        await requireGuestCode(body.accessCode);
        if (body.type !== "text" || body.schemaVersion !== 1) throw new FamilyWorkflowError("INVALID_REQUEST", "Ispravak profila pošalji kroz obrazac za ispravke.");
        profileChange = await wrap(async () => validateProfileChange(body.profileChange, await readJson(paths.allowlist)));
        body = { ...body }; delete body.profileChange;
      }
      let photos = [];
      if (body && Object.hasOwn(body, "photoTokens")) {
        await requireGuestCode(body.accessCode);
        photos = await resolveUploads(body.photoTokens);
        body = { ...body }; delete body.photoTokens;
      }
      const submit = createHandler({ accessCodeDigest: Buffer.from(current.codeDigest, "hex"), anchorAllowlist: await readJson(paths.allowlist), logger, now,
        putSuggestion: item => withWriterLock(paths, () => atomicWrite(path.join(records, item.id + ".json"), { ...item,
          ...(photos.length ? { attachments: photos } : {}), ...(profileChange ? { profileChange } : {}) }, true)) });
      return submit({ body: JSON.stringify(body) });
    },
    list: query => wrap(() => listSuggestions({ queryStringParameters: query }, store)),
    async get(id) { return wrap(async () => {
      const item = await get(id);
      if (!item) throw new FamilyWorkflowError("NOT_FOUND", "Suggestion not found.", 404);
      return { suggestion: safeSuggestion(item), reviewRevision: hash(JSON.stringify(item)) };
    }); },
    async photoDraft(id, request) { return wrap(() => withWriterLock(paths, async () => {
      const item = await get(id);
      assertReviewRevision(item, request.expectedReviewRevision);
      if (item.status !== "accepted") throw new FamilyWorkflowError("NOT_ACCEPTED", "Approve the suggestion before adding photographs.", 409);
      const snapshot = await readFamilySnapshot(paths);
      if (snapshot.snapshotId !== request.expectedSnapshotId) throw new FamilyWorkflowError("STALE_SNAPSHOT", "Reload and unlock the current tree before adding photographs.", 409);
      let nodes;
      try { validateFamilyData(request.nodes); nodes = structuredClone(request.nodes); }
      catch { throw new FamilyWorkflowError("INVALID_FAMILY", "Finish the current tree draft before adding photographs."); }
      const photos = new Map(attachments(item).map(photo => [photo.id, photo]));
      if (!Array.isArray(request.assignments) || !request.assignments.length || request.assignments.length > MAX_SUGGESTION_PHOTOS) throw new FamilyWorkflowError("INVALID_REQUEST", "Choose photographs and their target people.");
      const approvedMedia = createMediaStore(paths);
      const seen = new Set();
      const copies = [];
      for (const assignment of request.assignments) {
        if (!assignment || Object.keys(assignment).sort().join() !== "id,personId" || seen.has(assignment.id)) throw new FamilyWorkflowError("INVALID_REQUEST", "Invalid photo assignment.");
        seen.add(assignment.id);
        const photo = photos.get(assignment.id), person = nodes.find(value => value.id === assignment.personId);
        if (!photo || !person) throw new FamilyWorkflowError("INVALID_REQUEST", "Choose a person from the current private draft.");
        const gallery = person.data.gallery ?? [];
        if (!gallery.some(value => value.id === photo.id)) {
          if (gallery.length >= MAX_GALLERY_IMAGES) throw new FamilyWorkflowError("INVALID_REQUEST", "This person's gallery is full.");
          person.data.gallery = [...gallery, photo];
        }
        const stored = await pendingMedia.read(photo.id);
        if (stored.type !== photo.type) throw new FamilyWorkflowError("INVALID_ATTACHMENTS", "Photo verification failed.");
        copies.push(stored);
      }
      // Append-only media copies precede a later owner Save; a failed operation
      // cannot replace existing photos or family artifacts.
      for (const stored of copies) await approvedMedia.put(stored.bytes, stored.type);
      return { draft: { nodes, baseSnapshotId: snapshot.snapshotId, suggestionId: id } };
    })); },
    async draft(id, expectedReviewRevision, expectedSnapshotId) { return wrap(() => withWriterLock(paths, async () => {
      const item = await get(id);
      assertReviewRevision(item, expectedReviewRevision);
      if ((item.type !== "graph" && !item.profileChange) || item.status !== "accepted") throw new FamilyWorkflowError("NOT_ACCEPTED", "Odobri prijedlog prije dodavanja u nacrt.", 409);
      return { draft: await prepareDraft(item, expectedSnapshotId) };
    })); },
    async review(id, request, expectedReviewRevision, expectedSnapshotId, acceptedProfileFields) { return wrap(() => withWriterLock(paths, async () => {
      const parsed = parseReviewRequest({ body: JSON.stringify(request) });
      const item = await get(id);
      assertReviewRevision(item, expectedReviewRevision);
      let draft = null, profileApproval = null;
      if (parsed.status === "accepted" && item.profileChange) {
        if (item.status === "accepted") throw new FamilyWorkflowError("ALREADY_REVIEWED", "Za ponovno odobravanje ispravka prvo ga vrati na čekanje.", 409);
        const fields = validateProfileSelection(validateProfileChange(item.profileChange), acceptedProfileFields);
        profileApproval = { fields, baseSnapshotId: expectedSnapshotId };
        draft = await prepareDraft({ ...item, profileApproval }, expectedSnapshotId);
      } else if (parsed.status === "accepted" && item.type === "graph") draft = await prepareDraft(item, expectedSnapshotId);
      const reviewedAt = now().toISOString();
      const updated = { ...item, status: parsed.status, updatedAt: reviewedAt,
        review: { reviewerId: "local-owner", reviewedAt, note: parsed.reviewerNote } };
      if (profileApproval) updated.profileApproval = profileApproval;
      else if (item.profileChange) delete updated.profileApproval;
      await atomicWrite(path.join(records, item.id + ".json"), updated);
      return { suggestion: safeSuggestion(updated), reviewRevision: hash(JSON.stringify(updated)), ...(draft ? { draft } : {}) };
    })); }
  };
}
