// Core data model, a subset of PRD section 5 needed for timing.
// Times are milliseconds since epoch (UTC). The device's UTC offset in
// minutes is kept with each timing event.

export type Role = 'owner' | 'organiser' | 'staff' | 'head_judge' | 'judge' | 'volunteer' | 'helper';

export type JudgingStyle = 'follow' | 'station';
export type StartStyle = 'mass' | 'wave' | 'interval' | 'rolling';
export type EntryKind = 'solo' | 'team';
export type EntryStatus = 'entered' | 'checked_in' | 'racing' | 'finished' | 'DNF' | 'DNS' | 'DSQ';

export type Division = {
  id: string;
  code: string;
  label: string;
  gender?: 'M' | 'W' | 'X';
  level?: 'open' | 'pro';
};

export type Segment = {
  id: string;
  order: number;
  kind: 'run' | 'station' | 'transition' | 'rest';
  name: string;
  metric: 'distance' | 'reps' | 'calories' | 'time';
  timed: boolean;
};

export type SegmentTarget = {
  segmentId: string;
  divisionId: string;
  value: number;
  weight?: number;
  unit: string;
};

export type Athlete = { id: string; name: string; showAsInitials: boolean };

export type Entry = {
  id: string;
  divisionId: string;
  kind: EntryKind;
  code: string; // the athlete or team number volunteers type in
  displayName: string;
  members: Athlete[];
};

export type Heat = {
  id: string;
  number: number;
  startAt: number; // planned start, ms UTC
  slots: { lane: number; entryId: string }[];
};

export type RaceTemplate = {
  id: string;
  name: string;
  divisions: Division[];
  segments: Segment[];
  targets: SegmentTarget[];
};

export type Race = {
  id: string;
  orgId: string;
  name: string;
  venue: string;
  timezone: string;
  judgingStyle: JudgingStyle;
  startStyle: StartStyle;
  splitsOn: boolean;
  template: RaceTemplate;
  entries: Entry[];
  heats: Heat[];
  // Two finishes for one entry further apart than this are flagged.
  disagreeThresholdMs: number;
};

export type TimingKind = 'start' | 'finish' | 'split' | 'undo' | 'penalty' | 'status' | 'edit';

export type TimingPayload =
  | { kind: 'start'; heatId: string }
  | { kind: 'finish' }
  | { kind: 'split'; segmentId: string }
  | { kind: 'undo'; targetId: string }
  | { kind: 'penalty'; seconds: number; reason: string }
  | { kind: 'status'; status: 'DNF' | 'DNS' | 'DSQ' | 'racing'; reason: string }
  | { kind: 'edit'; field: 'finish'; at: number; reason: string };

// Append only. Never updated or deleted. A correction is a new event.
export type TimingEvent = {
  id: string;
  raceId: string;
  deviceId: string;
  actorLinkId: string;
  actorRole: Role;
  entryId?: string;
  deviceTs: number;
  tzOffsetMin: number;
  serverTs?: number;
  seq: number;
  payload: TimingPayload;
};
