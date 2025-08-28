// lib/task.ts
import fs from "fs/promises";

export async function readTasks() {
  try {
    const file = await fs.readFile("./tasks.json", "utf-8");
    return JSON.parse(file);
  } catch (e) {
    console.warn("No task file found.");
    return [];
  }
}