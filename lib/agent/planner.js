export function planFromText(text='') {
  const plan = { steps: [], needsViewer: false };
  if (!text) return plan;
  // Donor addition: "Add donor Jane Doe $50 monthly"
  const donor = text.match(/add donor ([\w\s]+) \$?(\d+)(?: (monthly|one-time))?/i);
  if (donor) {
    const name = donor[1].trim();
    const amount = Number(donor[2]);
    const frequency = donor[3] || 'one-time';
    plan.steps.push({ tool: 'notion', action: 'createDonor', args: { name, amount, frequency } });
    return plan;
  }
  // Notion subpage: "Create a subpage X under HQ"
  const subpage = text.match(/create (?:a )?subpage ['\"]?([^'\"]+)['\"]? under hq/i);
  if (subpage) {
    const title = subpage[1].trim();
    plan.steps.push({ tool: 'notion', action: 'hqSubpage', args: { title } });
    return plan;
  }
  return plan;
}
