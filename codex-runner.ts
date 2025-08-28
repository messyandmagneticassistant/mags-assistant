// codex-runner.ts
import { runTaskQueue } from "./lib/codex";
import config from "./maggi.config";
import { readTasks } from "./lib/task";

async function runCodex() {
  const tasks = await readTasks();
  for (const task of tasks) {
    console.log(`Running task: ${task.name}`);
    await runTaskQueue(task, config);
  }
}

runCodex().catch(console.error);