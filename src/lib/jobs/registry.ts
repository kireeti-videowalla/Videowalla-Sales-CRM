import type { Job } from '@prisma/client';
import type { Logger } from '../logger';

export type JobContext = {
  job: Job;
  log: Logger;
};

export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;

const handlers = new Map<string, JobHandler>();

export function registerJob(name: string, handler: JobHandler): void {
  if (handlers.has(name)) {
    throw new Error(`Job handler already registered: ${name}`);
  }
  handlers.set(name, handler);
}

export function getHandler(name: string): JobHandler | undefined {
  return handlers.get(name);
}

export function registeredJobNames(): string[] {
  return [...handlers.keys()].sort();
}
