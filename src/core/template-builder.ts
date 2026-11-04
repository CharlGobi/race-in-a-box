import type { Division, RaceTemplate, Segment, SegmentTarget } from './types';

// Pure functions behind the race builder screen (PRD 6B). Every edit returns a
// new template, so the screen can undo and the tests can check each step.

export const BRAND_WORDS = /\b(HYROX|HRX|ROX|HY)\b/i;

export function blankTemplate(name = 'New format'): RaceTemplate {
  return { id: '', name, divisions: [], segments: [], targets: [] };
}

export function cloneTemplate(t: RaceTemplate, name: string): RaceTemplate {
  return { ...structuredCloneSafe(t), id: '', name };
}

function structuredCloneSafe<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function renumber(segments: Segment[]): Segment[] {
  return segments.map((s, i) => ({ ...s, order: i + 1 }));
}

function nextSegmentId(t: RaceTemplate): string {
  let n = t.segments.length + 1;
  const used = new Set(t.segments.map((s) => s.id));
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

// Divisions ------------------------------------------------------------------

export function addDivision(t: RaceTemplate, d: Omit<Division, 'id'>): RaceTemplate {
  const code = d.code.trim().toUpperCase();
  return { ...t, divisions: [...t.divisions, { ...d, code, id: code }] };
}

export function updateDivision(t: RaceTemplate, id: string, patch: Partial<Omit<Division, 'id'>>): RaceTemplate {
  const code = patch.code !== undefined ? patch.code.trim().toUpperCase() : undefined;
  const newId = code ?? id;
  return {
    ...t,
    divisions: t.divisions.map((d) => (d.id === id ? { ...d, ...patch, ...(code ? { code, id: code } : {}) } : d)),
    targets: t.targets.map((x) => (x.divisionId === id ? { ...x, divisionId: newId } : x)),
  };
}

export function removeDivision(t: RaceTemplate, id: string): RaceTemplate {
  return { ...t, divisions: t.divisions.filter((d) => d.id !== id), targets: t.targets.filter((x) => x.divisionId !== id) };
}

// Segments -------------------------------------------------------------------

export function addSegment(t: RaceTemplate, s: Omit<Segment, 'id' | 'order'>, at = t.segments.length): RaceTemplate {
  const seg: Segment = { ...s, id: nextSegmentId(t), order: 0 };
  const list = [...t.segments];
  list.splice(at, 0, seg);
  return { ...t, segments: renumber(list) };
}

export function updateSegment(t: RaceTemplate, id: string, patch: Partial<Omit<Segment, 'id' | 'order'>>): RaceTemplate {
  return { ...t, segments: t.segments.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

export function removeSegment(t: RaceTemplate, id: string): RaceTemplate {
  return { ...t, segments: renumber(t.segments.filter((s) => s.id !== id)), targets: t.targets.filter((x) => x.segmentId !== id) };
}

export function moveSegment(t: RaceTemplate, id: string, by: -1 | 1): RaceTemplate {
  const i = t.segments.findIndex((s) => s.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= t.segments.length) return t;
  const list = [...t.segments];
  [list[i], list[j]] = [list[j]!, list[i]!];
  return { ...t, segments: renumber(list) };
}

/** Put a run before every station that does not already have one, the usual sim layout. */
export function addRunsBeforeStations(t: RaceTemplate, name: string, distance: number, unit = 'm'): RaceTemplate {
  let out = t;
  let runNo = 0;
  for (let i = 0; i < out.segments.length; i++) {
    const s = out.segments[i]!;
    if (s.kind !== 'station') continue;
    if (out.segments[i - 1]?.kind === 'run') continue;
    runNo++;
    out = addSegment(out, { kind: 'run', name: `${name} ${runNo}`, metric: 'distance', timed: false }, i);
    const run = out.segments[i]!;
    out = setTargetForAll(out, run.id, { value: distance, unit });
    i++; // skip past the station we just put a run in front of
  }
  return out;
}

// Targets --------------------------------------------------------------------

export function targetFor(t: RaceTemplate, segmentId: string, divisionId: string): SegmentTarget | undefined {
  return t.targets.find((x) => x.segmentId === segmentId && x.divisionId === divisionId);
}

/** True when every division has the same value, unit and weight for this segment. */
export function targetsAreSame(t: RaceTemplate, segmentId: string): boolean {
  const list = t.divisions.map((d) => targetFor(t, segmentId, d.id));
  const first = list[0];
  return list.every((x) => x?.value === first?.value && x?.unit === first?.unit && x?.weight === first?.weight);
}

export function setTarget(t: RaceTemplate, segmentId: string, divisionId: string, v: { value: number; unit: string; weight?: number }): RaceTemplate {
  const rest = t.targets.filter((x) => !(x.segmentId === segmentId && x.divisionId === divisionId));
  const target: SegmentTarget = { segmentId, divisionId, value: v.value, unit: v.unit, ...(v.weight !== undefined ? { weight: v.weight } : {}) };
  return { ...t, targets: [...rest, target] };
}

export function setTargetForAll(t: RaceTemplate, segmentId: string, v: { value: number; unit: string; weight?: number }): RaceTemplate {
  return t.divisions.reduce((acc, d) => setTarget(acc, segmentId, d.id, v), t);
}

export function clearTargets(t: RaceTemplate, segmentId: string): RaceTemplate {
  return { ...t, targets: t.targets.filter((x) => x.segmentId !== segmentId) };
}

// Checks ---------------------------------------------------------------------

export function validateTemplate(t: RaceTemplate): string[] {
  const errors: string[] = [];
  if (!t.name.trim()) errors.push('Give the format a name.');
  if (BRAND_WORDS.test(t.name)) errors.push('The name can not use a protected race brand word.');
  if (t.divisions.length === 0) errors.push('Add at least one division.');
  if (t.segments.length === 0) errors.push('Add at least one run or station.');

  const codes = new Set<string>();
  for (const d of t.divisions) {
    if (!/^[A-Z0-9]{1,8}$/.test(d.code)) errors.push(`Division code "${d.code}" must be 1 to 8 letters or numbers.`);
    if (codes.has(d.code)) errors.push(`Division code ${d.code} is used twice.`);
    codes.add(d.code);
    if (!d.label.trim()) errors.push(`Division ${d.code} needs a name.`);
    const size = d.teamSize ?? 1;
    if (d.entryKind === 'solo' && size !== 1) errors.push(`Division ${d.code} is solo, so the team size must be 1.`);
    if (d.entryKind !== 'solo' && (size < 2 || size > 20)) errors.push(`Division ${d.code} needs a team size from 2 to 20.`);
  }

  for (const s of t.segments) {
    if (!s.name.trim()) errors.push(`Part ${s.order} needs a name.`);
    if (BRAND_WORDS.test(s.name)) errors.push(`Part ${s.order} uses a protected race brand word.`);
  }

  const segIds = new Set(t.segments.map((s) => s.id));
  for (const x of t.targets) {
    if (!segIds.has(x.segmentId) || !codes.has(x.divisionId)) continue; // dropped on save
    if (!(x.value > 0)) errors.push(`${t.segments.find((s) => s.id === x.segmentId)?.name}: the target for ${x.divisionId} must be more than 0.`);
    if (x.weight !== undefined && !(x.weight >= 0)) errors.push(`${t.segments.find((s) => s.id === x.segmentId)?.name}: the weight for ${x.divisionId} can not be negative.`);
  }
  return [...new Set(errors)];
}

/** Drop targets that point at removed segments or divisions. */
export function tidyTemplate(t: RaceTemplate): RaceTemplate {
  const segIds = new Set(t.segments.map((s) => s.id));
  const divIds = new Set(t.divisions.map((d) => d.id));
  return { ...t, name: t.name.trim(), targets: t.targets.filter((x) => segIds.has(x.segmentId) && divIds.has(x.divisionId)) };
}

export function describeTarget(x: SegmentTarget | undefined): string {
  if (!x) return 'No target';
  return `${x.value} ${x.unit}${x.weight !== undefined ? ` at ${x.weight} kg` : ''}`;
}
