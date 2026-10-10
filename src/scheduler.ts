import { REFRESH_INTERVAL_MS } from './sources.js';

export function resolveRefreshInterval(value: string | number | undefined = undefined): number {
  if (value === undefined) return REFRESH_INTERVAL_MS;
  if (typeof value === 'string' && !/^\d+$/.test(value)) throw new Error('REFRESH_INTERVAL_MS tidak valid');
  const interval = Number(value);
  if (!Number.isInteger(interval) || interval < 1000 || interval > 2_147_483_647) throw new Error('REFRESH_INTERVAL_MS tidak valid');
  return interval;
}
interface TimerHandle { unref?: () => unknown }
interface Timers {
  setTimeout(callback: () => void, delay: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
}
const nativeTimers: Timers = {
  setTimeout: (callback, delay) => setTimeout(callback, delay),
  clearTimeout: handle => clearTimeout(handle as NodeJS.Timeout),
};
export function startRefreshScheduler(store: { refresh(): Promise<void> }, options: {
  intervalMs?: number; timers?: Timers; onError?: () => void;
} = {}): { stop(): Promise<void> } {
  const interval = resolveRefreshInterval(options.intervalMs);
  const timers = options.timers ?? nativeTimers;
  let timer: TimerHandle | undefined;
  let stopped = false;
  let active: Promise<void> | undefined;
  const schedule = () => {
    if (stopped) return;
    timer = timers.setTimeout(() => {
      timer = undefined;
      active = Promise.resolve().then(() => store.refresh()).catch(() => {
        try { (options.onError ?? (() => console.error('Pembaruan RSS gagal')))(); } catch { /* Logging must not stop polling. */ }
      }).finally(() => { active = undefined; schedule(); });
    }, interval);
    timer.unref?.();
  };
  schedule();
  return { async stop() { stopped = true; if (timer) timers.clearTimeout(timer); timer = undefined; await active; } };
}
