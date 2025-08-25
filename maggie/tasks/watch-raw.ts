import chokidar from 'chokidar'
import { log } from '../shared/logger'

export function watchRawFolder() {
  const watcher = chokidar.watch('drop')
  watcher.on('add', path => log(`New file: ${path}`))
}
