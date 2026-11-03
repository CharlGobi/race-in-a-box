import type { Division, RaceTemplate, Segment } from '../types';

// Matches the Gobi Hybrid Games format (31 October 2026, George):
// teams of 2 and relays of 4, 8 stations, 3 laps of 300 m between stations.
// Station names are generic on purpose.

const divisions: Division[] = [
  { id: 'T2M', code: 'T2M', label: 'Team of 2, men', gender: 'M' },
  { id: 'T2W', code: 'T2W', label: 'Team of 2, women', gender: 'W' },
  { id: 'T2X', code: 'T2X', label: 'Team of 2, mixed', gender: 'X' },
  { id: 'R4M', code: 'R4M', label: 'Relay of 4, men', gender: 'M' },
  { id: 'R4W', code: 'R4W', label: 'Relay of 4, women', gender: 'W' },
  { id: 'R4X', code: 'R4X', label: 'Relay of 4, mixed', gender: 'X' },
];

const stations = [
  'Ski erg',
  'Sled push',
  'Sled pull',
  'Burpee broad jumps',
  'Rowing',
  'Farmers carry',
  'Sandbag lunges',
  'Wall balls',
];

const segments: Segment[] = stations.flatMap((name, i) => [
  { id: `run${i + 1}`, order: i * 2 + 1, kind: 'run', name: `Run ${i + 1} (3 laps of 300 m)`, metric: 'distance', timed: false },
  { id: `st${i + 1}`, order: i * 2 + 2, kind: 'station', name, metric: 'reps', timed: false },
]);

export const gobiTemplate: RaceTemplate = {
  id: 'tpl-gobi-hybrid-games',
  name: 'Gobi Hybrid Games (teams and relays)',
  divisions,
  segments,
  targets: [
    ...divisions.map((d) => ({ segmentId: 'run1', divisionId: d.id, value: 900, unit: 'm' })),
  ],
};
