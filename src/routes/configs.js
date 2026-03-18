/*
 * REST-API for Search Configs & Providers
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/errorHandler.js';
import {
  getAllSearchConfigs,
  createSearchConfig,
  updateSearchConfig,
  deleteSearchConfig,
} from '../db/database.js';
import { getAllProviders, getProvider, inferFromUrl } from '../providers/registry.js';
import { validateUrl as validateIs24Url } from '../providers/immoscout24/index.js';

const router = Router();

// ── Providers ──────────────────────────────────────────────────────────────────

// GET /api/providers – list all available providers with listing types
router.get(
  '/providers',
  asyncHandler(async (_req, res) => {
    res.json(getAllProviders());
  }),
);

// POST /api/configs/infer-url – infers provider and listing type from a URL
router.post(
  '/infer-url',
  asyncHandler(async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL fehlt' });
    const result = inferFromUrl(url);
    if (!result) return res.json({ detected: false });
    const provider = getProvider(result.providerId);
    const typeInfo = provider?.listingTypes?.find((t) => t.id === result.listingTypeId);
    return res.json({
      detected: true,
      providerId: result.providerId,
      listingTypeId: result.listingTypeId,
      listingTypeLabel: typeInfo?.label || result.listingTypeId,
    });
  }),
);

// ── Search Configs ─────────────────────────────────────────────────────────────

// GET /api/configs – all search configurations
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const configs = getAllSearchConfigs();
    // Compute the current scrape URL for each config
    const enriched = configs.map((cfg) => {
      let scrapeUrl = '';
      try {
        const extraParams = JSON.parse(cfg.extra_params || '{}');
        scrapeUrl = extraParams.directUrl || '';
      } catch {}
      return { ...cfg, scrape_url: scrapeUrl };
    });
    res.json(enriched);
  }),
);

// POST /api/configs – create a new search configuration
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const directUrl = req.body.directUrl || '';
    const name = req.body.name?.trim() || '';

    if (!name) {
      return res.status(400).json({ error: 'Name ist erforderlich.' });
    }
    if (!directUrl) {
      return res.status(400).json({ error: 'Scrape-URL ist erforderlich.' });
    }

    // Validate IS24 URL against supported search categories
    if (directUrl.includes('immobilienscout24.de')) {
      try {
        validateIs24Url(directUrl);
      } catch (e) {
        return res.status(400).json({ error: e.message });
      }
    }

    const extraParams = { directUrl };
    console.log(`[config] New config: ${name}`);

    // Auto-detect listing type & provider from URL
    let providerId = req.body.provider || 'kleinanzeigen';
    let listingType = req.body.listingType ?? null;
    if (!listingType) {
      const inferred = inferFromUrl(directUrl);
      if (inferred) {
        listingType = inferred.listingTypeId;
        providerId = inferred.providerId;
        console.log(`[config] Inferred from URL: provider=${providerId}, type=${listingType}`);
      } else {
        listingType = 'miete'; // safe fallback
      }
    }

    const config = createSearchConfig({
      provider: providerId,
      listingType,
      maxPages: Number(req.body.maxPages) || 10,
      extraParams,
      name,
    });

    res.status(201).json({ ...config, scrape_url: directUrl });
  }),
);

// PATCH /api/configs/:id – update a search configuration
router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const data = {};

    if (req.body.directUrl !== undefined) {
      const directUrl = req.body.directUrl;
      data.extraParams = { directUrl };
      // Validate IS24 URL against supported search categories
      if (directUrl.includes('immobilienscout24.de')) {
        try {
          validateIs24Url(directUrl);
        } catch (e) {
          return res.status(400).json({ error: e.message });
        }
      }

      // Auto-infer listing type from new URL if not explicitly supplied
      if (req.body.listing_type === undefined && req.body.listingType === undefined) {
        const inferred = inferFromUrl(directUrl);
        if (inferred) {
          data.listingType = inferred.listingTypeId;
          data.provider = inferred.providerId;
        }
      }
    }
    if (req.body.maxPages !== undefined) data.maxPages = Number(req.body.maxPages);
    if (req.body.enabled !== undefined) data.enabled = req.body.enabled ? 1 : 0;
    if (req.body.name !== undefined) data.name = req.body.name;
    if (req.body.listingType !== undefined) data.listingType = req.body.listingType;
    if (req.body.provider !== undefined) data.provider = req.body.provider;

    const updated = updateSearchConfig(id, data);

    let scrapeUrl = '';
    try {
      const extraParams = JSON.parse(updated.extra_params || '{}');
      scrapeUrl = extraParams.directUrl || '';
    } catch {}

    res.json({ ...updated, scrape_url: scrapeUrl });
  }),
);

// DELETE /api/configs/:id – delete a search configuration
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    deleteSearchConfig(Number(req.params.id));
    res.json({ ok: true });
  }),
);

export default router;
