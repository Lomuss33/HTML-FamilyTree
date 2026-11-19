import { AdminApiError } from "./api-client.js";

export function createLocalReviewClients({ api, getPassword, getSnapshotId, getDraftNodes, onLogout }) {
  let signedOut = true;
  const revisions = new Map();
  async function request(action, body = {}) {
    const password = getPassword();
    if (signedOut || !password) throw new AdminApiError(401, "Otključaj privatno stablo za pregled prijedloga.");
    try { return await (action === "photo" ? api.readSuggestionPhoto({ ...body, password }) : api.suggestionRequest(action, { ...body, password })); }
    catch (error) { throw new AdminApiError(error.status ?? 500, error.message ?? "Pregled prijedloga trenutačno nije dostupan."); }
  }
  return {
    authClient: {
      onFamilyUnlocked() { signedOut = false; },
      getSession: () => !signedOut && getPassword() ? { email: "Vlasnik lokalnog stabla" } : null,
      completeRedirect: async () => ({ handled: false }),
      clearLocalSession() { signedOut = true; revisions.clear(); },
      beginLogin: onLogout,
      beginLogout: onLogout
    },
    apiClient: {
      list: query => request("list", { query }),
      async get(id) { const result = await request("get", { id }); revisions.set(id, result.reviewRevision); return result; },
      async review(id, review, acceptedProfileFields) {
        const result = await request("review", { id, review, expectedReviewRevision: revisions.get(id), expectedSnapshotId: getSnapshotId(),
          ...(acceptedProfileFields ? { acceptedProfileFields } : {}) });
        revisions.set(id, result.reviewRevision); return result;
      },
      draft: id => request("draft", { id, expectedReviewRevision: revisions.get(id), expectedSnapshotId: getSnapshotId() }),
      photo: (id, photoId) => request("photo", { id, photoId }),
      async photoDraft(id, assignments) {
        const nodes = getDraftNodes();
        const result = await request("photo-draft", { id, assignments, nodes, expectedReviewRevision: revisions.get(id), expectedSnapshotId: getSnapshotId() });
        return { draft: { ...result.draft, expectedNodes: nodes } };
      }
    }
  };
}
