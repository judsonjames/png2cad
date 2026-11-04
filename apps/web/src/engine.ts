/** Runs work in a worker, one lane per kind of job. A new job in a lane cancels the last one by ending its worker. */
import type { WorkerRequest, WorkerResponse } from "./protocol";

export class Cancelled extends Error {}

type Lane = "preview" | "export";

interface Running {
  worker: Worker;
  reject: (reason: unknown) => void;
}

const running = new Map<Lane, Running>();

export function cancel(lane: Lane): void {
  const r = running.get(lane);
  if (!r) return;
  r.worker.terminate();
  r.reject(new Cancelled());
  running.delete(lane);
}

export function run<T>(lane: Lane, request: WorkerRequest, onProgress?: (message: string, done: number) => void) {
  cancel(lane);
  return new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    running.set(lane, { worker, reject });
    const finish = () => {
      worker.terminate();
      if (running.get(lane)?.worker === worker) running.delete(lane);
    };
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const m = event.data;
      if (m.type === "progress") {
        onProgress?.(m.message, m.done);
      } else if (m.type === "done") {
        finish();
        resolve(m.result as T);
      } else {
        finish();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (event) => {
      finish();
      reject(new Error(event.message || "The worker stopped unexpectedly. Try a smaller size."));
    };
    worker.postMessage(request);
  });
}
