import type { HonoContext } from '../ctx';
import { Hono } from 'hono';

// Old clients receive a stable retirement response without contacting a billing service.
export const autumnApi = new Hono<HonoContext>().all('*', (c) =>
  c.json({ error: 'Subscription billing has been removed from this fork' }, 410),
);
