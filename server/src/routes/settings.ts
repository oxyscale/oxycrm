// ============================================================
// Settings Routes — /api/settings
// Manages app settings and category prompts
// ============================================================

import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import pino from 'pino';

const logger = pino({ name: 'settings-routes' });
const router = Router();

// ── Default settings (used when no value is stored) ─────────

const DEFAULTS: Record<string, string> = {
  company_name: 'OxyScale',
  company_description: 'AI and automation consultancy that helps businesses cut down on repetitive manual work.',
  sender_name: 'Jordan Bell',
  sender_title: 'Co-Founder',
  sender_phone: '0478 197 600',
  website_url: 'https://oxyscale.ai',
  calendly_link: 'https://calendly.com/jordan-oxyscale/30min',
  calendly_duration: '30',
  email_sign_off: 'Cheers',
  unanswered_call_threshold: '5',
};

// ── GET / — Get all settings ────────────────────────────────

router.get('/', (_req, res) => {
  try {
    const db = getDb();
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];

    // Start with defaults, overlay with stored values
    const settings: Record<string, string> = { ...DEFAULTS };
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    res.json(settings);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch settings');
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// ── PUT / — Update settings (partial update) ────────────────

const updateSettingsSchema = z.record(z.string(), z.string());

router.put('/', (req, res) => {
  try {
    const data = updateSettingsSchema.parse(req.body);
    const db = getDb();

    const upsert = db.prepare(`
      INSERT INTO settings (key, value, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `);

    const updateMany = db.transaction(() => {
      for (const [key, value] of Object.entries(data)) {
        upsert.run(key, value);
      }
    });

    updateMany();

    logger.info({ keys: Object.keys(data) }, 'Settings updated');

    // Return all settings after update
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const settings: Record<string, string> = { ...DEFAULTS };
    for (const row of rows) {
      settings[row.key] = row.value;
    }

    res.json(settings);
  } catch (err) {
    logger.error({ err }, 'Failed to update settings');
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// ── GET /prompts — Get all category prompts ─────────────────

router.get('/prompts', (_req, res) => {
  try {
    const db = getDb();
    const prompts = db.prepare('SELECT * FROM category_prompts ORDER BY category').all();
    res.json(prompts);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch category prompts');
    res.status(500).json({ error: 'Failed to fetch category prompts' });
  }
});

// ── GET /prompts/:category — Get prompt for a category ──────

router.get('/prompts/:category', (req, res) => {
  try {
    const db = getDb();
    const prompt = db.prepare('SELECT * FROM category_prompts WHERE category = ?').get(req.params.category);
    if (!prompt) {
      res.json(null);
      return;
    }
    res.json(prompt);
  } catch (err) {
    logger.error({ err }, 'Failed to fetch category prompt');
    res.status(500).json({ error: 'Failed to fetch category prompt' });
  }
});

// ── PUT /prompts/:category — Create or update a prompt ──────

const promptSchema = z.object({
  prompt: z.string().default(''),
  ctaDocUrl: z.string().nullable().optional(),
  ctaDocLabel: z.string().nullable().optional(),
  ctaIntro: z.string().nullable().optional(),
});

router.put('/prompts/:category', (req, res) => {
  try {
    const { category } = req.params;
    const data = promptSchema.parse(req.body);
    const db = getDb();

    // Normalise empty strings to NULL so getCategoryCta() correctly
    // treats "no URL configured" as no CTA available.
    const ctaDocUrl = data.ctaDocUrl?.trim() || null;
    const ctaDocLabel = data.ctaDocLabel?.trim() || null;
    const ctaIntro = data.ctaIntro?.trim() || null;

    db.prepare(`
      INSERT INTO category_prompts (category, prompt, cta_doc_url, cta_doc_label, cta_intro, updated_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(category) DO UPDATE SET
        prompt = excluded.prompt,
        cta_doc_url = excluded.cta_doc_url,
        cta_doc_label = excluded.cta_doc_label,
        cta_intro = excluded.cta_intro,
        updated_at = excluded.updated_at
    `).run(category, data.prompt, ctaDocUrl, ctaDocLabel, ctaIntro);

    logger.info({ category, hasCta: !!ctaDocUrl }, 'Category prompt saved');

    const result = db.prepare('SELECT * FROM category_prompts WHERE category = ?').get(category);
    res.json(result);
  } catch (err) {
    logger.error({ err }, 'Failed to save category prompt');
    res.status(500).json({ error: 'Failed to save category prompt' });
  }
});

// ── DELETE /prompts/:category — Delete a prompt ─────────────

router.delete('/prompts/:category', (req, res) => {
  try {
    const db = getDb();
    db.prepare('DELETE FROM category_prompts WHERE category = ?').run(req.params.category);
    logger.info({ category: req.params.category }, 'Category prompt deleted');
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to delete category prompt');
    res.status(500).json({ error: 'Failed to delete category prompt' });
  }
});

export default router;
