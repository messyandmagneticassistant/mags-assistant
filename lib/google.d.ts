import type { docs_v1, drive_v3, sheets_v4 } from 'googleapis';

export function getSheets(): Promise<sheets_v4.Sheets>;
export function getDrive(): Promise<drive_v3.Drive>;
export function getDocs(): Promise<docs_v1.Docs>;
export function createSpreadsheet(title: string, parentId?: string): Promise<drive_v3.Schema$File>;
export function addSheet(spreadsheetId: string, title: string, headers?: string[]): Promise<void>;
export function appendRows(
  spreadsheetId: string,
  range: string,
  values: (string | number)[][]
): Promise<void>;
