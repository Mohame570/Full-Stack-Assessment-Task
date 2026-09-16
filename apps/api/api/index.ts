/**
 * Vercel serverless entry for the NestJS API. The server (and its MongoDB
 * connection) is created once per warm function instance and reused across
 * invocations. Local development still uses `src/main.ts` with `app.listen`.
 */
import type { INestApplication } from '@nestjs/common';
import { createApp } from '../src/main';

let cachedApp: INestApplication | undefined;

async function getApp(): Promise<INestApplication> {
  if (!cachedApp) {
    cachedApp = await createApp();
    await cachedApp.init();
  }
  return cachedApp;
}

export default async function handler(req: unknown, res: unknown): Promise<void> {
  const app = await getApp();
  const instance = app.getHttpAdapter().getInstance() as unknown as (
    req: unknown,
    res: unknown,
  ) => void;
  return instance(req, res);
}
