export type WorkOrderSchedule = {
  tickSeconds: number;
  runMinutes: number;
  firstRunSeconds: number;
};

type Jobs = { tick(): Promise<unknown>; run(): Promise<unknown> };

type Timer = ReturnType<typeof setTimeout>;

export function scheduleWorkOrders(jobs: Jobs, schedule: WorkOrderSchedule): Timer[] {
  let chain: Promise<unknown> = Promise.resolve();
  const queued = new Set<keyof Jobs>();
  const enqueue = (name: keyof Jobs) => () => {
    if (queued.has(name)) return;
    queued.add(name);
    chain = chain
      .then(() => jobs[name]())
      .catch((error: unknown) => console.warn(`[API] work order ${name} failed:`, error))
      .finally(() => queued.delete(name));
  };
  const timers: Timer[] = [];
  if (schedule.tickSeconds > 0) {
    timers.push(setInterval(enqueue("tick"), schedule.tickSeconds * 1000));
  }
  if (schedule.runMinutes > 0) {
    timers.push(setInterval(enqueue("run"), schedule.runMinutes * 60_000));
    if (schedule.firstRunSeconds > 0) {
      timers.push(setTimeout(enqueue("run"), schedule.firstRunSeconds * 1000));
    }
  }
  for (const timer of timers) timer.unref?.();
  return timers;
}

export function stopWorkOrders(timers: Timer[]) {
  for (const timer of timers) clearTimeout(timer);
}
