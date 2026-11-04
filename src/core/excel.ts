import { readSheet } from 'read-excel-file/universal';

import { parseCsv, tidyGrid } from './import';
import type { Grid } from './import';

/** The first sheet of an .xlsx file as a grid of text. */
export async function readExcel(data: ArrayBuffer): Promise<Grid> {
  const rows = await readSheet(data);
  return tidyGrid(rows as unknown[][]);
}

/** Read an uploaded file: .xlsx through the Excel reader, anything else as CSV text. */
export async function readUpload(name: string, data: ArrayBuffer): Promise<Grid> {
  if (/\.xlsx$/i.test(name)) return readExcel(data);
  if (/\.xls$/i.test(name)) throw new Error('Old .xls files can not be read. Save it as .xlsx or CSV and try again.');
  return parseCsv(new TextDecoder('utf-8').decode(data));
}
