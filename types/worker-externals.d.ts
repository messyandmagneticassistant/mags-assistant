declare module '../src/utils/telegram' {
  export const sendTelegram: any;
  export default sendTelegram;
}

declare module '../../shared/maggieState' {
  export const THREAD_STATE_KEY: string;
  export type MaggieState = any;
  export type MaggieTrend = any;
}

declare module '../../src/commerce/products' {
  export const listOfferings: any;
}

declare module '../../utils/slugify' {
  export const slugify: any;
}

declare module '../../src/fulfillment/cricut' {
  export const getCricutFulfillmentStatus: any;
  export const queueCricutFulfillment: any;
}

declare module '../../src/fundraising/index' {
  export const runQueuedOutreach: any;
}

declare module '../../src/fundraising/report' {
  export const sendDailyReport: any;
}

declare module '../../utils/email' {
  export const sendEmail: any;
  export const getEmailConfig: any;
}

declare module '../../src/donors/notion' {
  export const listRecentDonations: any;
  export const recordDonation: any;
}

declare module '../../src/queue' {
  export const enqueueFulfillmentJob: any;
  export const getLastOrderSummary: any;
}

declare module '../../src/forms/schema' {
  export type OrderContext = any;
  export const parseSubmission: any;
}

declare module '../../src/planner' {
  const planner: any;
  export = planner;
}

declare module '../../src/trends' {
  const trends: any;
  export = trends;
}

declare module '../../src/social/defaults' {
  const defaults: any;
  export = defaults;
}

declare module '../../src/social/orchestrate' {
  const orchestrate: any;
  export = orchestrate;
}

declare module '../../src/social/trends' {
  const socialTrends: any;
  export = socialTrends;
}

declare module '../../src/fundraising' {
  const fundraising: any;
  export = fundraising;
}

declare module '../../src/fundraising/email' {
  export const renderTemplate: any;
}

declare module '../tiktok/index' {
  const tiktok: any;
  export = tiktok;
}

declare module '../ops/queue' {
  const opsQueue: any;
  export = opsQueue;
}

declare module '../utils/email' {
  export const getEmailConfig: any;
}

declare module './routes/ready' {
  const ready: any;
  export = ready;
}

declare module './routes/tasks' {
  const tasks: any;
  export = tasks;
}

declare module '../orders/fulfill' {
  export const fulfill: any;
}
