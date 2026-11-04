import type { RaceTemplate } from '../types';
import { gobiTemplate } from './gobi';
import { soloTemplate } from './solo';

/** Formats that ship with the app. Gyms copy one and change it, or start blank. */
export const builtInTemplates: RaceTemplate[] = [gobiTemplate, soloTemplate];
