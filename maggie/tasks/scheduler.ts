import cron from 'node-cron'
import { log } from '../shared/logger'

export function scheduleNextPost() {
  cron.schedule('* * * * *', () => {
    log('Time to post something!')
  })
}
