import type { Entry, Heat } from './types';

export type HeatPlanInput = {
  entries: Entry[];
  lanes: number;
  intervalMin: number;
  firstStartAt: number;
  byDivision: boolean;
};

/** Fill heats lane by lane. When byDivision is on, a heat never mixes divisions. */
export function buildHeats({ entries, lanes, intervalMin, firstStartAt, byDivision }: HeatPlanInput): Heat[] {
  const groups: Entry[][] = [];
  if (byDivision) {
    const map = new Map<string, Entry[]>();
    for (const e of entries) {
      const list = map.get(e.divisionId) ?? [];
      list.push(e);
      map.set(e.divisionId, list);
    }
    groups.push(...map.values());
  } else {
    groups.push(entries);
  }

  const heats: Heat[] = [];
  for (const group of groups) {
    for (let i = 0; i < group.length; i += lanes) {
      const n = heats.length;
      heats.push({
        id: `heat${n + 1}`,
        number: n + 1,
        startAt: firstStartAt + n * intervalMin * 60_000,
        slots: group.slice(i, i + lanes).map((e, lane) => ({ lane: lane + 1, entryId: e.id })),
      });
    }
  }
  return heats;
}

export type Clash = { heatA: number; heatB: number; station: string; overlapMin: number };

/**
 * Kit clash check. Heats move through the stations in the same order at the same
 * pace, so each station sees heats arrive with the same gap as their starts. With
 * one kit set per lane, a gap shorter than the time a heat spends at the slowest
 * station means two heats need the same kit at once.
 */
export function findKitClashes(heats: Heat[], stations: string[], stationDurationMin: number): Clash[] {
  const clashes: Clash[] = [];
  const sorted = [...heats].sort((a, b) => a.startAt - b.startAt);
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    const gapMin = (b.startAt - a.startAt) / 60_000;
    // Both heats arrive at every station with the same gap, so check once and report the first station.
    const overlap = stationDurationMin - gapMin;
    if (overlap > 0 && stations.length > 0) {
      clashes.push({ heatA: a.number, heatB: b.number, station: stations[0], overlapMin: overlap });
    }
  }
  return clashes;
}

/** Capacity: last finish estimate from the last heat start and the expected race length. */
export function lastFinishEstimate(heats: Heat[], expectedRaceMin: number): number | undefined {
  if (heats.length === 0) return undefined;
  const last = Math.max(...heats.map((h) => h.startAt));
  return last + expectedRaceMin * 60_000;
}
