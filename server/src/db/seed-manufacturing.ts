// ============================================================
// Manufacturing seed — playbook + CTA URLs + book-a-call URL
//
// Idempotent: only inserts if rows are missing. Once George or Jordan
// edit the playbook or URLs in the Settings UI, the seed never
// overwrites their changes (INSERT OR IGNORE on the unique category,
// settings INSERT OR IGNORE on the unique key).
//
// Runs once at boot from initializeDatabase via seedManufacturingIfEmpty.
// ============================================================

import type Database from 'better-sqlite3';
import pino from 'pino';

const logger = pino({ name: 'seed-manufacturing' });

const MANUFACTURING_PLAYBOOK = `You are writing to a mid-market Australian manufacturer (typically COO, GM, Operations Manager, or owner-operator at a $20-100M revenue business). They've just had a real conversation with us, so they're warm, not cold.

# How OxyScale lands for manufacturers

OxyScale gives manufacturers one live operating picture of their business — every system they already pay for, surfaced in a single visualisation layer built around how they actually run.

The frame: most manufacturers aren't short on data. They're short on a system that uses it. Their ERP knows what's been ordered, accounting knows who hasn't paid, the shop floor data knows which line is dragging, the CRM knows which customers are slipping, and none of those systems know about each other. So decisions wait. The Monday meeting goes hunting for numbers. Issues that should be caught on Tuesday surface at month-end. Margins erode quietly. Customers drift. Cash sits longer than it should.

We fix that with one live dashboard pulling from every system they already pay for. Production, margin, inventory, customers, cash — all in one place, refreshes itself, built around how their operation actually runs.

We don't force a rip-and-replace. The dashboard sits on top of what they already have.

# The pain points that land hardest

Lead with these if anything similar came up on the call:
- Margin and costing blindness. They don't know which SKUs or customers are actually making money once costs land.
- Customer drift. Orders dropping or churning without anyone noticing until month-end.
- Cash visibility. Debtor aging, supplier obligations, working capital trend.
- Demand and inventory. Stockout risk, overstock, days of cover.
- Production output vs plan. Only if they already track this somewhere.

Don't promise machine-level OEE, predictive forecasting, or real-time machine downtime correlation in the first build. Those are phase 2.

# How to write the email

- Reference the specific things they raised on the call. Be concrete, not generic. If they mentioned margin, say margin. If they mentioned Bullhorn or Pronto or Cin7, name it back.
- Use their language, not consultancy language. No "leverage", no "synergy", no "operational excellence".
- Frame OxyScale as additive to what they already have, not a replacement. They are proud of the systems they have built.
- Australian register. Direct. Confident. Short sentences.

# How to close

The close sets up the discovery call. The discovery is a 30-minute working conversation: we go deep on how their operation actually runs, what systems they have in place, and how OxyScale would integrate with what they already use. It is the call where the picture clicks for them. End the body on a forward-looking line that makes booking that conversation feel like the obvious next move, not a sales pitch, a working session about their setup. The buttons handle the click; don't paste the Calendly link in the body when the buttons are attached.

# Phrases that work

"One live operating picture." "What's actually making us money." "Caught the day it happens, not at month-end." "Something you work from, not just look at." "Built around how you actually run."

# Phrases to avoid

"Transform your business." "Revolutionary." "Game-changing." "Unlock value." "Drive efficiencies." "Best-in-class." "Cutting-edge." "Solutions." Anything that sounds like a deck.`;

const MANUFACTURING_CTA_URL = 'https://manufacturing.oxyscale.ai';
const MANUFACTURING_CTA_LABEL = 'View capabilities document';
const MANUFACTURING_CTA_INTRO =
  "A deeper look at how we work with manufacturers and the operating system we'd build for you.";

const BOOK_A_CALL_URL = 'https://calendly.com/jordan-oxyscale/discovery-call-30-minutes';

/**
 * Seed the Manufacturing category_prompts row and the book_a_call_url
 * setting if they are missing. Idempotent: never overwrites existing
 * rows, so any edits George or Jordan make in the Settings UI are
 * preserved across deploys.
 */
export function seedManufacturingIfMissing(db: Database.Database): void {
  try {
    // Manufacturing category prompt + CTA. INSERT OR IGNORE because
    // category is UNIQUE; subsequent boots become no-ops.
    const result = db
      .prepare(
        `INSERT OR IGNORE INTO category_prompts (category, prompt, cta_doc_url, cta_doc_label, cta_intro)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'Manufacturing',
        MANUFACTURING_PLAYBOOK,
        MANUFACTURING_CTA_URL,
        MANUFACTURING_CTA_LABEL,
        MANUFACTURING_CTA_INTRO,
      );

    if (result.changes > 0) {
      logger.info({ category: 'Manufacturing' }, 'Seeded Manufacturing playbook + CTA');
    }

    // Campaign-wide book-a-call URL. INSERT OR IGNORE on unique key.
    const settingsResult = db
      .prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('book_a_call_url', ?)`)
      .run(BOOK_A_CALL_URL);

    if (settingsResult.changes > 0) {
      logger.info('Seeded book_a_call_url setting');
    }
  } catch (err) {
    // Non-blocking — boot must continue even if the seed fails.
    logger.error({ err }, 'Manufacturing seed failed (non-blocking)');
  }
}
