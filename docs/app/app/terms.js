
export function isInSession(terms, weekStart, weekEnd) {
  if (!terms || terms.length === 0) return true;
  return terms.some((term) => {
    const startsOn = new Date(term.startsOn);
    if (!(startsOn < weekEnd)) return false;
    if (term.endsOn === null || term.endsOn === undefined) return true;
    return new Date(term.endsOn) >= weekStart;
  });
}

export function termsFrom(rows) {
  return (rows ?? []).map((t) => ({ id: t.id ?? null, name: t.name ?? null, startsOn: t.starts_on, endsOn: t.ends_on ?? null }));
}

export function currentTerm(terms, now = new Date()) {
  const list = terms ?? [];
  const at = list.filter((t) => {
    const startsOn = new Date(t.startsOn);
    if (!(now >= startsOn)) return false;
    if (t.endsOn === null || t.endsOn === undefined) return true;
    return now <= new Date(t.endsOn);
  });
  if (at.length > 0) return at[at.length - 1];

  const started = list.filter((t) => new Date(t.startsOn) <= now);
  return started.length > 0 ? started[started.length - 1] : null;
}

export function seasonWindow(terms, { studioCreatedAt, now = new Date() }) {
  const created = new Date(studioCreatedAt);
  const term = currentTerm(terms, now);
  if (!term) return { from: created < now ? created : now, to: now, term: null };

  const start = new Date(Math.max(new Date(term.startsOn).getTime(), created.getTime()));
  const declaredEnd = term.endsOn === null || term.endsOn === undefined ? now : new Date(term.endsOn);
  const end = new Date(Math.min(declaredEnd.getTime(), now.getTime()));
  return { from: start < end ? start : end, to: end, term };
}

export function pastTerms(terms, { studioCreatedAt, now }) {
  const showing = seasonWindow(terms, { studioCreatedAt, now }).term;
  return terms
    .filter((t) => new Date(t.startsOn) <= now && t.id !== showing?.id)
    .sort((a, b) => new Date(b.startsOn) - new Date(a.startsOn));
}
