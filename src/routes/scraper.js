import { Router } from 'express';
import { runAllScrapes, runScrapeForConfig } from '../services/scraperService.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getEnabledSearchConfigs } from '../db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, '..', '..', 'config', 'default.json');
const router = Router();

function readConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
  } catch (error) {
    console.error('Error reading config:', error);
    return { blacklistKeywords: [] };
  }
}

// Status flag: is a scraping process currently running?
let running = false;
let controller = null;
let progress = { pagesScraped: 0, totalPages: 0, currentConfig: 0, totalConfigs: 0, currentConfigName: '', lastError: null };

// GET /api/scrape/status
router.get('/status', asyncHandler(async (_req, res) => {
  res.json({
    running,
    pagesScraped: progress.pagesScraped,
    totalPages: progress.totalPages,
    currentConfig: progress.currentConfig,
    totalConfigs: progress.totalConfigs,
    currentConfigName: progress.currentConfigName,
    lastError: progress.lastError,
  });
}));

// GET /api/scrape/config  → current global configuration (blacklist keywords etc.)
router.get('/config', asyncHandler(async (_req, res) => {
  res.json(readConfig());
}));

// PATCH /api/scrape/config  → update global configuration
router.patch('/config', asyncHandler(async (req, res) => {
  const current = readConfig();
  const { blacklistKeywords } = req.body;

  if (Array.isArray(blacklistKeywords)) current.blacklistKeywords = blacklistKeywords;

  writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2), 'utf8');
  res.json({ ok: true, config: current });
}));

// POST /api/scrape  → starts scraping for all active search configurations
router.post('/', asyncHandler(async (req, res) => {
  if (running) {
    return res.status(429).json({ error: 'Scraping already running.' });
  }

  const configs = getEnabledSearchConfigs();
  if (configs.length === 0) {
    return res.status(400).json({ error: 'No active search configurations found.' });
  }

  progress = { pagesScraped: 0, totalPages: 0, currentConfig: 0, totalConfigs: configs.length, currentConfigName: '', lastError: null };

  controller = new AbortController();
  running = true;
  res.json({ ok: true, message: `Scraping started (${configs.length} configuration${configs.length > 1 ? 's' : ''}).` });

  try {
    const results = await runAllScrapes({
      signal: controller.signal,
      onProgress: (p) => {
        progress.pagesScraped = p.pageNum ?? progress.pagesScraped;
        progress.totalPages = p.maxPages ?? progress.totalPages;
        progress.currentConfig = p.configIdx ?? progress.currentConfig;
        progress.totalConfigs = p.totalConfigs ?? progress.totalConfigs;
        if (p.configName !== undefined) progress.currentConfigName = p.configName;
      },
    });
    // Errors from individual configs (runAllScrapes doesn't throw, but returns {error})
    const firstError = Object.values(results).find(r => r?.error)?.error;
    if (firstError) progress.lastError = firstError;
  } catch (err) {
    console.error(`[scraper] Error: ${err.message}`);
    progress.lastError = err.message;
  } finally {
    running = false;
    controller = null;
  }
}));

// POST /api/scrape/stop → cancels the running scrape
router.post('/stop', asyncHandler(async (req, res) => {
  if (!running || !controller) {
    return res.json({ ok: false, message: 'No running scrape.' });
  }

  controller.abort();
  return res.json({ ok: true, message: 'Scrape is being cancelled…' });
}));

// POST /api/scrape/:configId → starts scraping for a single search configuration
router.post('/:configId', asyncHandler(async (req, res) => {
  if (running) {
    return res.status(429).json({ error: 'Scraping already running.' });
  }

  const configId = Number(req.params.configId);
  const configs = getEnabledSearchConfigs();
  const cfg = configs.find(c => c.id === configId);
  if (!cfg) {
    return res.status(404).json({ error: 'Search configuration not found or not enabled.' });
  }

  progress = { pagesScraped: 0, totalPages: cfg.max_pages || 10, currentConfig: 1, totalConfigs: 1, currentConfigName: cfg.name || cfg.city, lastError: null };

  controller = new AbortController();
  running = true;
  res.json({ ok: true, message: `Scraping started: ${cfg.name || cfg.city} (${cfg.listing_type}).` });

  try {
    await runScrapeForConfig(cfg, {
      signal: controller.signal,
      onProgress: (p) => {
        progress.pagesScraped = p.pageNum ?? progress.pagesScraped;
        progress.totalPages = p.maxPages ?? progress.totalPages;
      },
    });
  } catch (err) {
    console.error(`[scraper] Error: ${err.message}`);
    progress.lastError = err.message;
  } finally {
    running = false;
    controller = null;
  }
}));

export default router;
