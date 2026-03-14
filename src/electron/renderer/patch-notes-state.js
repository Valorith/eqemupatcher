(function attachPatchNotesStateModule(globalObject, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
    return;
  }

  globalObject.PatchNotesState = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  function normalizeReadState(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }

    const normalizedState = {};
    for (const [key, entryValue] of Object.entries(value)) {
      const normalizedKey = String(key || "").trim();
      if (!normalizedKey) {
        continue;
      }
      normalizedState[normalizedKey] = String(entryValue || "");
    }

    return normalizedState;
  }

  function hashText(value) {
    let hash = 0;
    const text = String(value || "");
    for (let index = 0; index < text.length; index += 1) {
      hash = (hash * 31 + text.charCodeAt(index)) | 0;
    }
    return (hash >>> 0).toString(16);
  }

  function getPatchNotesSignature(url, contentHash, content) {
    const normalizedUrl = String(url || "").trim();
    const normalizedContentHash = String(contentHash || "").trim();
    const normalizedContent = String(content || "");

    if (!normalizedUrl) {
      return "";
    }

    if (normalizedContentHash) {
      return `${normalizedUrl}::${normalizedContentHash}`;
    }

    if (!normalizedContent) {
      return "";
    }

    return `${normalizedUrl}::${hashText(normalizedContent)}`;
  }

  function createPatchNotesReadTracker(options = {}) {
    const { storage = null, storageKey = "", initializedStorageKey = "" } = options;
    let sessionState = {};
    let sessionInitialized = false;

    function readState() {
      try {
        const raw = storage?.getItem?.(storageKey);
        sessionState = raw ? normalizeReadState(JSON.parse(raw)) : normalizeReadState(sessionState);
      } catch (_error) {
        return { ...sessionState };
      }

      return { ...sessionState };
    }

    function writeState(nextState) {
      sessionState = normalizeReadState(nextState);

      try {
        storage?.setItem?.(storageKey, JSON.stringify(sessionState));
      } catch (_error) {
        // Keep the session copy when persistent storage is unavailable.
      }

      return { ...sessionState };
    }

    function hasInitialized() {
      const readStateValue = readState();
      if (Object.keys(readStateValue).length > 0) {
        sessionInitialized = true;
        return true;
      }

      try {
        const raw = storage?.getItem?.(initializedStorageKey);
        sessionInitialized = raw === "true" || sessionInitialized;
      } catch (_error) {
        return sessionInitialized;
      }

      return sessionInitialized;
    }

    function writeInitialized(value) {
      sessionInitialized = value === true;

      try {
        storage?.setItem?.(initializedStorageKey, sessionInitialized ? "true" : "false");
      } catch (_error) {
        // Keep the session flag when persistent storage is unavailable.
      }

      return sessionInitialized;
    }

    function markRead(url, signature) {
      const normalizedUrl = String(url || "").trim();
      const normalizedSignature = String(signature || "").trim();
      if (!normalizedUrl || !normalizedSignature) {
        return readState();
      }

      const nextState = readState();
      nextState[normalizedUrl] = normalizedSignature;
      return writeState(nextState);
    }

    function isUnread(url, signature) {
      const normalizedUrl = String(url || "").trim();
      const normalizedSignature = String(signature || "").trim();
      if (!normalizedUrl || !normalizedSignature) {
        return false;
      }

      const readStateValue = readState();
      return (readStateValue[normalizedUrl] || "") !== normalizedSignature;
    }

    function initializeBaseline(url, signature) {
      const normalizedUrl = String(url || "").trim();
      const normalizedSignature = String(signature || "").trim();
      if (!normalizedUrl || !normalizedSignature || hasInitialized()) {
        return false;
      }

      markRead(normalizedUrl, normalizedSignature);
      writeInitialized(true);
      return true;
    }

    return {
      initializeBaseline,
      readState,
      writeState,
      markRead,
      isUnread,
      hasInitialized
    };
  }

  function shouldLoadPatchNotes(configuredUrl, patchNotesState) {
    const normalizedConfiguredUrl = String(configuredUrl || "").trim();
    if (!normalizedConfiguredUrl || patchNotesState?.loading) {
      return false;
    }

    const loadedUrl = String(patchNotesState?.loadedUrl || "").trim();
    if (loadedUrl !== normalizedConfiguredUrl) {
      return true;
    }

    return patchNotesState?.loaded !== true;
  }

  return {
    createPatchNotesReadTracker,
    getPatchNotesSignature,
    shouldLoadPatchNotes
  };
});
