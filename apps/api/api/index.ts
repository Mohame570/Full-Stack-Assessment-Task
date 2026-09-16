/**
 * Vercel serverless entry for the NestJS API. The server (and its MongoDB
 * connection) is created once per warm function instance and reused across
 * invocations. Local development still uses `src/main.ts` with `app.listen`.
 */
import type { INestApplication } from '@nestjs/common';
import serverless from '@vendia/serverless-express';
import { createApp } from '../src/main';

let cachedHandler: ReturnType<typeof serverless> | undefined;

async function bootstrap(): Promise<ReturnType<typeof serverless>> {
  const app: INestApplication = await createApp();
  await app.init();
  return serverless({ app: app.getHttpAdapter().getInstance() });
}

export default async function handler(req: unknown, res: unknown): Promise<void> {
  if (!cachedHandler) {
    cachedHandler = await bootstrap();
  }
  return cachedHandler(req, res);
}
