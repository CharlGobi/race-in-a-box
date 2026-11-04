import type { Division, RaceTemplate, Segment, SegmentTarget } from '../types';

// A solo sim: 8 runs of 1 km, each followed by a station, with Open and Pro
// weights for men and women. The weights are a starting point for the organiser
// to change, not an official standard.

const divisions: Division[] = [
  { id: 'WO', code: 'WO', label: 'Women Open', gender: 'W', level: 'open', entryKind: 'solo', teamSize: 1 },
  { id: 'WP', code: 'WP', label: 'Women Pro', gender: 'W', level: 'pro', entryKind: 'solo', teamSize: 1 },
  { id: 'MO', code: 'MO', label: 'Men Open', gender: 'M', level: 'open', entryKind: 'solo', teamSize: 1 },
  { id: 'MP', code: 'MP', label: 'Men Pro', gender: 'M', level: 'pro', entryKind: 'solo', teamSize: 1 },
];

type Station = { name: string; metric: Segment['metric']; value: number; unit: string; weights?: [number, number, number, number] };

// Weights in kg in division order WO, WP, MO, MP.
const stations: Station[] = [
  { name: 'Ski erg', metric: 'distance', value: 1000, unit: 'm' },
  { name: 'Sled push', metric: 'distance', value: 50, unit: 'm', weights: [100, 140, 140, 190] },
  { name: 'Sled pull', metric: 'distance', value: 50, unit: 'm', weights: [75, 100, 100, 140] },
  { name: 'Burpee broad jumps', metric: 'distance', value: 80, unit: 'm' },
  { name: 'Rowing', metric: 'distance', value: 1000, unit: 'm' },
  { name: 'Farmers carry', metric: 'distance', value: 200, unit: 'm', weights: [16, 24, 24, 32] },
  { name: 'Sandbag lunges', metric: 'distance', value: 100, unit: 'm', weights: [10, 20, 20, 30] },
  { name: 'Wall balls', metric: 'reps', value: 100, unit: 'reps', weights: [4, 6, 6, 9] },
];

const segments: Segment[] = stations.flatMap((st, i) => [
  { id: `run${i + 1}`, order: i * 2 + 1, kind: 'run' as const, name: `Run ${i + 1}`, metric: 'distance' as const, timed: false },
  { id: `st${i + 1}`, order: i * 2 + 2, kind: 'station' as const, name: st.name, metric: st.metric, timed: false },
]);

const targets: SegmentTarget[] = stations.flatMap((st, i) =>
  divisions.flatMap((d, di) => [
    { segmentId: `run${i + 1}`, divisionId: d.id, value: 1000, unit: 'm' },
    { segmentId: `st${i + 1}`, divisionId: d.id, value: st.value, unit: st.unit, ...(st.weights ? { weight: st.weights[di] } : {}) },
  ]),
);

export const soloTemplate: RaceTemplate = {
  id: 'tpl-solo-sim',
  name: 'Solo sim, 8 runs and 8 stations',
  divisions,
  segments,
  targets,
};
