export async function sweepReminders() {
  // Later: scan Notion "Reminders" DB and enqueue emails/DMs via free provider.
  return { name: "ops.sweep_reminders", ok: true, msg: "nothing_due" };
}
