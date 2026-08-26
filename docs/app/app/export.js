
const VERSION = 1;

export function buildDocument(store, { clipURLs = {}, now = new Date() } = {}) {
  const studio = store.studio();
  const me = store.profile();
  if (!studio || !me) return null;

  const isInstructor = !!store.isInstructor;
  const titles = new Map(store.assignments().map((a) => [a.id, a.title]));
  const points = new Map(
    store.assignments().flatMap((a) => (a.focus_points ?? []).map((p) => [p.id, p.text])),
  );
  const names = new Map(store.roster().map((m) => [m.id, m.display_name]));

  const logs = isInstructor ? store.logs() : store.logs().filter((l) => l.performerId === me.id);
  const marks = isInstructor
    ? store.focusMarks()
    : store.focusMarks().filter((m) => m.performerId === me.id);
  const nudges = isInstructor ? [] : store.nudges().filter((n) => n.toPerformer === me.id);

  return {
    version: VERSION,
    exportedAt: iso(now),
    scope: isInstructor ? "instructor" : "performer",
    studioName: studio.name,
    studioID: studio.id,
    personName: me.display_name,
    personID: me.id,
    sessions: [...logs]
      .sort((a, b) => new Date(a.startedAt) - new Date(b.startedAt))
      .map((log) => ({
        id: log.id,
        assignmentID: log.assignmentId,
        assignmentTitle: titles.get(log.assignmentId) ?? null,
        performerID: log.performerId,
        performerName: names.get(log.performerId) ?? null,
        studioID: studio.id,
        startedAt: iso(log.startedAt),
        recordedAt: iso(log.recordedAt ?? log.startedAt),
        durationSeconds: Math.round(log.duration ?? 0),
        writtenDownAfterward: !!log.selfReported,
        note: log.note ?? null,
        instructorNote: log.instructorNote ?? null,
        heardAt: log.heardAt ? iso(log.heardAt) : null,
        clipPath: log.clip?.path ?? null,
        clipSeconds: log.clip ? Math.round(log.clip.seconds ?? 0) : null,
        clipMarkerSeconds: log.clip?.markers ?? [],
        clipURL: log.clip ? clipURLs[log.clip.path] ?? null : null,
      })),
    ticks: [...marks]
      .sort((a, b) => new Date(a.markedAt) - new Date(b.markedAt))
      .map((mark) => ({
        id: mark.id,
        assignmentID: mark.assignmentId,
        assignmentTitle: titles.get(mark.assignmentId) ?? null,
        focusPointID: mark.focusPointId,
        focusPointText: points.get(mark.focusPointId) ?? null,
        performerID: mark.performerId,
        studioID: studio.id,
        weekStart: iso(mark.weekStart),
        markedAt: iso(mark.markedAt),
      })),
    notes: [...nudges]
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
      .map((nudge) => ({
        id: nudge.id,
        studioID: studio.id,
        fromInstructorID: nudge.fromInstructor,
        fromInstructorName: names.get(nudge.fromInstructor) ?? null,
        toPerformerID: nudge.toPerformer,
        message: nudge.message,
        createdAt: iso(nudge.createdAt),
        seenAt: nudge.seenAt ? iso(nudge.seenAt) : null,
      })),
  };
}

export function toJSON(document) {
  return JSON.stringify(withSortedKeys(document), null, 2);
}

function withSortedKeys(value) {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const key of Object.keys(value).sort()) out[key] = withSortedKeys(value[key]);
  return out;
}

export function toCSV(document) {
  const header = [
    "started_at", "assignment", "minutes", "written_down_afterward",
    "note", "instructor_note", "heard_at", "recording_seconds", "recording_markers",
  ];
  const rows = [header.map(quoted).join(",")];
  for (const s of document.sessions) {
    rows.push([
      s.startedAt,
      s.assignmentTitle ?? s.assignmentID,
      String(Math.trunc(s.durationSeconds / 60)),
      s.writtenDownAfterward ? "yes" : "no",
      s.note ?? "",
      s.instructorNote ?? "",
      s.heardAt ?? "",
      s.clipSeconds === null || s.clipSeconds === undefined ? "" : String(s.clipSeconds),
      s.clipMarkerSeconds.map((m) => String(Math.round(m))).join(" "),
    ].map(quoted).join(","));
  }
  return rows.join("\r\n") + "\r\n";
}

export function filename(document, extension) {
  const stamp = document.exportedAt.slice(0, 10);
  const who = (document.personName ?? document.studioName ?? "")
    .replaceAll(" ", "-")
    .replace(/[^\p{L}\p{N}-]/gu, "");
  return `IPT-${who || "export"}-${stamp}.${extension}`;
}

function quoted(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}
