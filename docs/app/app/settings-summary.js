
export function helpAudience(isInstructor) {
  return isInstructor ? "For instructors" : "For performers";
}

export function completionWorthPhrase(rules, keepsScore) {
  if (!keepsScore) return null;
  return `Worth ${rules?.completionPoints ?? 0} points when they finish it.`;
}

export function scoringSummary(rules, keepsScore, presets, recordsAudio = true) {
  if (!keepsScore) return "Off";
  if (!presets || presets.length === 0) return null;
  const match = presets.find((p) => matchesPreset(rules, p.rules, recordsAudio));
  return match ? match.title : "Custom";
}

function matchesPreset(rules, presetRules, recordsAudio) {
  const skipped = recordsAudio === false ? ["clipBonus", "clipBonusWeeklyCap"] : [];
  return Object.keys(presetRules)
    .filter((k) => !skipped.includes(k))
    .every((k) => rules[k] === presetRules[k]);
}

function termOn(terms, date) {
  const inside = (terms ?? []).filter((t) => {
    const startsOn = new Date(t.startsOn);
    if (!(date >= startsOn)) return false;
    if (t.endsOn === null || t.endsOn === undefined) return true;
    return date <= new Date(t.endsOn);
  });
  return inside.length > 0 ? inside[inside.length - 1] : null;
}

export function termsSummary(terms, date = new Date()) {
  const list = terms ?? [];
  if (list.length === 0) return "All year";
  const current = termOn(list, date);
  if (current) return current.name;
  return list.length === 1 ? "1 term" : `${list.length} terms`;
}

export function studioExitDetail(isInstructor) {
  return isInstructor
    ? "You stop seeing it. The work you assigned and everything logged against it stays with the studio."
    : "You stop seeing it. Your instructor keeps what you sent them, and the studio's standings stop counting you.";
}

export function studioExitConfirmation(isInstructor) {
  return isInstructor
    ? "You stop seeing this studio. The work you assigned and everything performers logged against it stays. The join code would bring you back as a performer. Another instructor has to make you one again."
    : "You stop seeing this studio. Your instructor keeps the sessions and recordings you already sent them; the studio's standings and totals stop counting you. Rejoining with the join code brings it all back.";
}
