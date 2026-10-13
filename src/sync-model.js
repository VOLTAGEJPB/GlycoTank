// Sync rules shared by the app and the server. Pure functions, unit-tested.
//
// Data syncs as records: one per meal, workout and check-in, plus one "doc"
// record each for settings, profile, meta and the favorites lists. Every
// record has `updatedAt` (ms); when two devices change the same record, the
// newer change wins. Deletions are remembered in `state.deleted` (not left in
// the lists) so they reach other devices instead of the record coming back.
//
// The app never stamps records by hand: `stampChanges` compares the state
// with a snapshot from the last save and stamps whatever changed.

export const COLLECTIONS = { meals: "meal", workouts: "workout", checks: "check" };
export const DOCS = ["settings", "profile", "meta", "mealFavs", "workoutFavs"];
const BASELINE = 1; // stamp for docs never edited on this device
const KIND_TO_KEY =Object.fromEntries(Object.entries(COLLECTIONS).map(([k, v]) => [v, k]));

const body = (item) => {
  const { updatedAt, ...rest } = item;
  return JSON.stringify(rest);
};

// Snapshot of everything syncable, used to detect changes on the next save.
export function snapshot(state) {
  const snap = {};
  for (const [key, kind] of Object.entries(COLLECTIONS)) for (const item of state[key] || []) snap[`${kind}:${item.id}`] = body(item);
  for (const doc of DOCS) snap[`doc:${doc}`] = JSON.stringify(state[doc] ?? null);
  return snap;
}

// Stamps new and edited records with `now`, and records deletions. Returns
// the new snapshot. With no previous snapshot (first run), only records that
// have never been stamped are stamped.
export function stampChanges(state, prev, now = Date.now()) {
  state.deleted = state.deleted || {};
  state.docStamps = state.docStamps || {};
  const next = snapshot(state);
  for (const [key, kind] of Object.entries(COLLECTIONS)) {
    for (const item of state[key] || []) {
      const k = `${kind}:${item.id}`;
      if (!item.updatedAt || (prev && prev[k] !== next[k])) item.updatedAt = now;
      delete state.deleted[k];
    }
  }
  for (const doc of DOCS) {
    const k = `doc:${doc}`;
    // A doc nobody has edited yet (e.g. default settings on a fresh install)
    // gets the oldest possible stamp, so any copy already in the cloud wins.
    if (prev && prev[k] !== next[k]) state.docStamps[doc] = now;
    else if (!state.docStamps[doc]) state.docStamps[doc] = BASELINE;
  }
  if (prev) for (const k of Object.keys(prev)) if (!(k in next) && !k.startsWith("doc:")) state.deleted[k] = now;
  return next;
}

// Records changed after `since`, ready to upload.
export function toRecords(state, since = 0) {
  const out = [];
  for (const [key, kind] of Object.entries(COLLECTIONS)) {
    for (const item of state[key] || []) if ((item.updatedAt || 0) > since) out.push({ kind, id: item.id, updatedAt: item.updatedAt, deleted: false, data: item });
  }
  for (const doc of DOCS) {
    const t = state.docStamps?.[doc] || 0;
    if (t > since) out.push({ kind: "doc", id: doc, updatedAt: t, deleted: false, data: state[doc] ?? null });
  }
  for (const [k, t] of Object.entries(state.deleted || {})) {
    if (t > since) {
      const [kind, id] = k.split(/:(.*)/s);
      out.push({ kind, id, updatedAt: t, deleted: true, data: null });
    }
  }
  return out;
}

// Applies records from the server, keeping whichever side is newer.
// Returns how many records changed local state.
export function applyRecords(state, records) {
  state.deleted = state.deleted || {};
  state.docStamps = state.docStamps || {};
  let changed = 0;
  for (const r of records) {
    const t = r.updatedAt || 0;
    if (r.kind === "doc") {
      if (DOCS.includes(r.id) && t > (state.docStamps[r.id] || 0)) {
        state[r.id] = r.data;
        state.docStamps[r.id] = t;
        changed++;
      }
      continue;
    }
    const key = KIND_TO_KEY[r.kind];
    if (!key) continue;
    const list = (state[key] = state[key] || []);
    const k = `${r.kind}:${r.id}`;
    const i = list.findIndex((x) => x.id === r.id);
    const localTime = i >= 0 ? list[i].updatedAt || 0 : state.deleted[k] || 0;
    if (t <= localTime) continue;
    if (r.deleted) {
      if (i >= 0) list.splice(i, 1);
      state.deleted[k] = t;
    } else {
      const item = { ...r.data, id: r.id, updatedAt: t };
      if (i >= 0) list[i] = item;
      else list.push(item);
      delete state.deleted[k];
    }
    changed++;
  }
  return changed;
}
