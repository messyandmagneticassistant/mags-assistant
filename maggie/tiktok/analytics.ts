import { google } from 'googleapis'
import { getEnv } from '../shared/env'

export async function logTikTokStats(videoId: string, stats: any) {
  const sheets = google.sheets('v4')
  await sheets.spreadsheets.values.append({
    spreadsheetId: getEnv('SHEET_ID'),
    range: 'Analytics!A1',
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[new Date(), videoId, ...Object.values(stats)]] }
  })
}
