import { buildHeats } from './heats';
import { gobiTemplate } from './templates/gobi';
import type { Entry, Race } from './types';

// Rehearsal race with fake entries: 60 teams over the six Gobi divisions, 5 lanes.

const firstNames = ['Anri', 'Thabo', 'Megan', 'Sipho', 'Lize', 'Kyle', 'Naledi', 'Ruan', 'Zanele', 'Pieter', 'Ayesha', 'Jaco'];

const surnames = [
  'Botha', 'Naidoo', 'Mokoena', 'van Wyk', 'Pillay', 'Dlamini', 'Smit', 'Jacobs', 'Nel', 'Khumalo',
  'Pretorius', 'Ndlovu', 'Fourie', 'Mahlangu', 'Venter', 'Govender', 'Steyn', 'Zulu', 'Coetzee', 'Sithole',
];

export function makeDemoEntries(count = 60): Entry[] {
  const divs = gobiTemplate.divisions;
  return Array.from({ length: count }, (_, i) => {
    const div = divs[i % divs.length];
    const size = div.code.startsWith('R4') ? 4 : 2;
    const code = String(i + 1);
    return {
      id: `entry${code}`,
      divisionId: div.id,
      kind: 'team' as const,
      code,
      displayName: `Team ${surnames[i % surnames.length]} ${code}`,
      members: Array.from({ length: size }, (_, m) => ({
        id: `ath${code}-${m + 1}`,
        name: `${firstNames[(i * 4 + m) % firstNames.length]} ${surnames[(i + m) % surnames.length]}`,
        showAsInitials: m === 1,
      })),
    };
  });
}

export function makeDemoRace(firstStartAt = Date.now() + 10 * 60_000): Race {
  const entries = makeDemoEntries();
  return {
    id: 'demo-gobi',
    orgId: 'org-demo',
    name: 'Rehearsal: Gobi Hybrid Games',
    venue: 'Déjà Vu Equestrian, George',
    timezone: 'Africa/Johannesburg',
    judgingStyle: 'follow',
    startStyle: 'wave',
    splitsOn: false,
    template: gobiTemplate,
    entries,
    heats: buildHeats({ entries, lanes: 5, intervalMin: 6, firstStartAt, byDivision: true }),
    disagreeThresholdMs: 2000,
  };
}
