import { updateBrain } from '../lib/brain';

await updateBrain({
  identity: {
    fullName: "Chanel Marraccini",
    maidenName: "Rodriguez",
    marriedName: "Marraccini",
    displayName: "Chanel Marraccini",
    alias: ["Rodriguez", "Marraccini"],
    signatureAuthorization: true
  },
  agents: {
    maggie: {
      name: "Maggie",
      email: "maggie@messyandmagnetic.com",
      aliases: ["Mags", "Magnet Agent"],
      canUseSignature: true,
      inboxes: {
        primary: "messyandmagnetic@gmail.com",
        outreach: "messyandmagneticoutreach@gmail.com"
      },
      permissions: [
        "fillForms",
        "sendEmail",
        "submitGrants",
        "autoScanFunding",
        "scheduleTikToks",
        "analyzeFlops",
        "createGraphics",
        "updateFolders",
        "accessDrive",
        "reorganizeFolders",
        "deleteDuplicates",
        "createOnboardingDocs",
        "syncDonorNotionPage",
        "triggerTwiceDailySummary",
        "connectGemini",
        "accessTally",
        "connectStripeProducts",
        "adjustPostingCadence",
        "applyAestheticToDocs",
        "useAIHelpers",
        "renameAndSortFiles"
      ],
      storage: {
        rawTikTokFolder: "/Drive/TikTok Raw",
        idFolder: "/Drive/IDFolder"
      },
      connectedTools: [
        "GitHub",
        "Vercel",
        "Cloudflare KV",
        "Make.com",
        "Telegram",
        "Google Drive",
        "Notion",
        "Tally.so",
        "Gemini",
        "Stripe",
        "TikTok API",
        "CapCut"
      ],
      dailySummary: {
        schedule: ["9am", "7pm"],
        trigger: "telegram://@maggie_updates"
      }
    }
  },
  deployment: {
    strategy: "GitHub → Vercel primary",
    fallback: "Manual Vercel redeploy via UI"
  }
});
