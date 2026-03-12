/*
 * Main server – Express + cron scheduler.
 */

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import cron from 'node-cron';
import path from 'path';
import { fileURLToPath } from 'url';

import listingsRouter from './routes/listings.js';
import scraperRouter from './routes/scraper.js';
import configsRouter from './routes/configs.js';
import { runAllScrapes } from './services/scraperService.js';
import {
  requestLogger,
  errorHandler,
  notFoundHandler,
} from './middleware/errorHandler.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';


app.use(cors());
app.use(compression());
app.use(express.json());

if (NODE_ENV === 'development') {
  app.use(requestLogger);
}

app.use(express.static(path.join(__dirname, '..', 'public')));

// ── API Routes ──────────────────────────────────────────────────────────────

app.use('/api/listings', listingsRouter);
app.use('/api/scrape', scraperRouter);
app.use('/api/configs', configsRouter);


import { getAllProviders } from './providers/registry.js';
app.get('/api/providers', (_req, res) => res.json(getAllProviders()));

app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// ── Error Handling Middleware ───────────────────────────────────────────────

app.use(notFoundHandler);
app.use(errorHandler);

// ── Cron Scheduler ──────────────────────────────────────────────────────────

const CRON = process.env.SCRAPE_CRON || '*/30 * * * *';
const CRON_ENABLED = process.env.SCRAPE_CRON_ENABLED === 'true';

if (CRON_ENABLED) {
  cron.schedule(CRON, async () => {
      console.log(`[cron] Starting scheduled scrape (${new Date().toLocaleTimeString('en-US')})`);
      await runAllScrapes().catch((err) => console.error('[cron] Error:', err));
  });
  console.log(`[cron] Scheduler active: "${CRON}"`);
} else {
  console.log('[cron] Scheduler disabled');
}

// ── Start Server ────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
console.log(`\n🏠 ImmoPilot running at http://localhost:${PORT}`);
    console.log(`   Environment: ${NODE_ENV}`);
    console.log(`   Cron: ${CRON_ENABLED ? CRON : 'disabled'}\n`);

  if (process.env.SCRAPE_ON_START === 'true') {
      console.log('[startup] Running initial scrape...');
      runAllScrapes().catch((err) => console.error('[startup] Error:', err));
  }
});
