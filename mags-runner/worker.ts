export default {
  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext) {
    console.log('mags-runner tick', event.cron);
  },
};
