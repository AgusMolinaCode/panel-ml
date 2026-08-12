/**
 * Tiny in-process scheduler using setInterval.
 * Good enough for a single-instance local worker.
 */

type Job = {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
};

const jobs: Job[] = [];
const timers: NodeJS.Timeout[] = [];

export function registerJob(job: Job): void {
  jobs.push(job);
}

export function startAll(): void {
  console.log(`[scheduler] starting ${jobs.length} jobs`);
  for (const job of jobs) {
    // Stagger initial run a tiny bit so logs don't collide
    setTimeout(async () => {
      console.log(`[scheduler] running initial ${job.name}`);
      try {
        await job.run();
      } catch (err) {
        console.error(`[scheduler] initial ${job.name} crashed:`, err);
      }
    }, Math.random() * 2000);

    const timer = setInterval(async () => {
      try {
        await job.run();
      } catch (err) {
        console.error(`[scheduler] ${job.name} crashed:`, err);
      }
    }, job.intervalMs);
    timers.push(timer);
  }
}

export function stopAll(): void {
  for (const t of timers) clearInterval(t);
  timers.length = 0;
  console.log("[scheduler] all jobs stopped");
}