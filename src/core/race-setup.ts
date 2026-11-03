import { buildHeats } from './heats';
import type { Entry, RaceTemplate } from './types';

export type TeamLine = { code: string; displayName: string; divisionCode: string };
export type ParseResult = { entries: TeamLine[]; errors: string[] };

/**
 * One team per line: number, name, division. Commas, tabs or semicolons all work,
 * so a block copied from a spreadsheet pastes straight in. A header row is skipped.
 */
export function parseTeamList(text: string, divisionCodes: string[]): ParseResult {
  const codes = new Set(divisionCodes.map((c) => c.toUpperCase()));
  const entries: TeamLine[] = [];
  const errors: string[] = [];
  const seen = new Map<string, number>();

  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const parts = line.split(/\t|;|,/).map((p) => p.trim());
    const lineNo = i + 1;
    if (i === 0 && !/^\d+$/.test(parts[0] ?? '')) return; // header row
    if (parts.length < 3) {
      errors.push(`Line ${lineNo}: needs number, name and division. Got "${line}".`);
      return;
    }
    const code = parts[0]!;
    const division = parts[parts.length - 1]!.toUpperCase();
    const displayName = parts.slice(1, -1).join(', ');
    if (!/^\d{1,4}$/.test(code)) {
      errors.push(`Line ${lineNo}: "${code}" is not a number from 1 to 9999.`);
      return;
    }
    if (!displayName) {
      errors.push(`Line ${lineNo}: team ${code} has no name.`);
      return;
    }
    if (!codes.has(division)) {
      errors.push(`Line ${lineNo}: "${division}" is not a division in this race. Use ${[...codes].join(', ')}.`);
      return;
    }
    const first = seen.get(code);
    if (first !== undefined) {
      errors.push(`Line ${lineNo}: number ${code} is already used on line ${first}.`);
      return;
    }
    seen.set(code, lineNo);
    entries.push({ code, displayName, divisionCode: division });
  });

  return { entries, errors };
}

export type HeatPlan = { lanes: number; intervalMin: number; firstStartAt: number };

export type SetupPayload = {
  name: string;
  raceDate: string;
  venue: string;
  divisions: { code: string; label: string; gender?: string }[];
  segments: { order: number; kind: string; name: string; metric: string; timed: boolean }[];
  entries: { code: string; displayName: string; divisionCode: string; kind: 'team' | 'solo' }[];
  heats: { number: number; startAt: number; slots: { lane: number; entryCode: string }[] }[];
};

/** Everything setup_race needs, with heats built by division. */
export function buildSetupPayload(
  template: RaceTemplate,
  info: { name: string; raceDate: string; venue: string },
  teams: TeamLine[],
  plan: HeatPlan,
  kind: 'team' | 'solo' = 'team',
): SetupPayload {
  const divByCode = new Map(template.divisions.map((d) => [d.code, d]));
  // Keep the template's division order so heats run division by division.
  const ordered = [...teams].sort(
    (a, b) =>
      template.divisions.indexOf(divByCode.get(a.divisionCode)!) - template.divisions.indexOf(divByCode.get(b.divisionCode)!) ||
      Number(a.code) - Number(b.code),
  );
  const asEntries: Entry[] = ordered.map((t) => ({ id: t.code, code: t.code, divisionId: t.divisionCode, kind, displayName: t.displayName, members: [] }));
  const heats = buildHeats({ entries: asEntries, lanes: plan.lanes, intervalMin: plan.intervalMin, firstStartAt: plan.firstStartAt, byDivision: true });

  return {
    ...info,
    divisions: template.divisions.map((d) => ({ code: d.code, label: d.label, gender: d.gender })),
    segments: template.segments.map((s) => ({ order: s.order, kind: s.kind, name: s.name, metric: s.metric, timed: s.timed })),
    entries: ordered.map((t) => ({ ...t, kind })),
    heats: heats.map((h) => ({ number: h.number, startAt: h.startAt, slots: h.slots.map((s) => ({ lane: s.lane, entryCode: s.entryId })) })),
  };
}
