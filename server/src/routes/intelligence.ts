// ============================================================
// Call Intelligence Routes — /api/intelligence
// Provides call transcript browsing, stats, and AI analysis
// ============================================================

import { Router } from 'express';
import { getDb } from '../db/index.js';
import { ApiError } from '../middleware/errorHandler.js';
import type {
  CallIntelligence,
  CallIntelligenceStats,
  CallLogWithLead,
} from '../../../shared/types.js';
import pino from 'pino';

const logger = pino({ name: 'intelligence-routes' });
const router = Router();

// ============================================================
// Row types and mappers
// ============================================================

interface CallLogWithLeadRow {
  id: number;
  lead_id: number;
  duration: number | null;
  transcript: string | null;
  summary: string | null;
  key_topics: string | null;
  action_items: string | null;
  sentiment: string | null;
  disposition: string;
  created_at: string;
  lead_name: string;
  lead_company: string | null;
  lead_category: string | null;
}

interface IntelligenceRow {
  id: number;
  analysis_type: string;
  date_range_start: string | null;
  date_range_end: string | null;
  total_calls_analysed: number;
  common_objections: string | null;
  winning_patterns: string | null;
  recommendations: string | null;
  raw_analysis: string | null;
  created_at: string;
}

function safeJsonParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapCallLogWithLead(row: CallLogWithLeadRow): CallLogWithLead {
  return {
    id: row.id,
    leadId: row.lead_id,
    duration: row.duration,
    transcript: row.transcript,
    summary: row.summary,
    keyTopics: safeJsonParse<string[]>(row.key_topics, []),
    actionItems: safeJsonParse<string[]>(row.action_items, []),
    sentiment: row.sentiment,
    disposition: row.disposition as CallLogWithLead['disposition'],
    createdAt: row.created_at,
    leadName: row.lead_name,
    leadCompany: row.lead_company,
    leadCategory: row.lead_category,
  };
}

function mapIntelligenceRow(row: IntelligenceRow): CallIntelligence {
  return {
    id: row.id,
    analysisType: row.analysis_type as CallIntelligence['analysisType'],
    dateRangeStart: row.date_range_start,
    dateRangeEnd: row.date_range_end,
    totalCallsAnalysed: row.total_calls_analysed,
    commonObjections: safeJsonParse<string[]>(row.common_objections, []),
    winningPatterns: safeJsonParse<string[]>(row.winning_patterns, []),
    recommendations: safeJsonParse<string[]>(row.recommendations, []),
    rawAnalysis: row.raw_analysis,
    createdAt: row.created_at,
  };
}

// ============================================================
// Routes
// ============================================================

/**
 * GET /api/intelligence/calls
 * Returns all call logs with lead info, filterable by disposition and date range.
 */
router.get('/calls', (req, res, next) => {
  try {
    const db = getDb();
    const { disposition, category, from, to, limit, offset } = req.query;

    let sql = `
      SELECT
        cl.id, cl.lead_id, cl.duration, cl.transcript, cl.summary,
        cl.key_topics, cl.action_items, cl.sentiment, cl.disposition,
        cl.created_at,
        l.name as lead_name, l.company as lead_company, l.category as lead_category
      FROM call_logs cl
      INNER JOIN leads l ON l.id = cl.lead_id
      WHERE 1=1
    `;
    const params: Record<string, string | number> = {};

    if (disposition && disposition !== 'all') {
      sql += ' AND cl.disposition = @disposition';
      params.disposition = String(disposition);
    }

    if (category && category !== 'all') {
      sql += ' AND l.category = @category';
      params.category = String(category);
    }

    if (from) {
      sql += ' AND cl.created_at >= @from';
      params.from = String(from);
    }

    if (to) {
      sql += ' AND cl.created_at <= @to';
      params.to = String(to);
    }

    sql += ' ORDER BY cl.created_at DESC';

    const queryLimit = Math.min(parseInt(String(limit || '100'), 10), 500);
    const queryOffset = parseInt(String(offset || '0'), 10);
    sql += ' LIMIT @limit OFFSET @offset';
    params.limit = queryLimit;
    params.offset = queryOffset;

    const rows = db.prepare(sql).all(params) as CallLogWithLeadRow[];
    const calls = rows.map(mapCallLogWithLead);

    // Get total count for pagination
    let countSql = `
      SELECT COUNT(*) as total
      FROM call_logs cl
      INNER JOIN leads l ON l.id = cl.lead_id
      WHERE 1=1
    `;
    const countParams: Record<string, string> = {};

    if (disposition && disposition !== 'all') {
      countSql += ' AND cl.disposition = @disposition';
      countParams.disposition = String(disposition);
    }
    if (category && category !== 'all') {
      countSql += ' AND l.category = @category';
      countParams.category = String(category);
    }
    if (from) {
      countSql += ' AND cl.created_at >= @from';
      countParams.from = String(from);
    }
    if (to) {
      countSql += ' AND cl.created_at <= @to';
      countParams.to = String(to);
    }

    const countRow = db.prepare(countSql).get(countParams) as { total: number };

    logger.info({ count: calls.length, total: countRow.total }, 'Fetched call logs');
    res.json({ calls, total: countRow.total });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/intelligence/stats
 * Returns aggregate stats across all calls.
 */
router.get('/stats', (req, res, next) => {
  try {
    const db = getDb();

    const totalRow = db.prepare('SELECT COUNT(*) as total FROM call_logs').get() as { total: number };
    const dispositionRows = db.prepare(
      'SELECT disposition, COUNT(*) as count FROM call_logs GROUP BY disposition'
    ).all() as { disposition: string; count: number }[];

    const avgDurationRow = db.prepare(
      'SELECT AVG(duration) as avg_duration FROM call_logs WHERE duration IS NOT NULL AND duration > 0'
    ).get() as { avg_duration: number | null };

    const categoryRows = db.prepare(`
      SELECT l.category, COUNT(*) as count
      FROM call_logs cl
      INNER JOIN leads l ON l.id = cl.lead_id
      WHERE l.category IS NOT NULL
      GROUP BY l.category
    `).all() as { category: string; count: number }[];

    const callsByDisposition: Record<string, number> = {};
    let interested = 0;
    let notInterested = 0;
    let noAnswer = 0;
    let voicemails = 0;

    for (const row of dispositionRows) {
      callsByDisposition[row.disposition] = row.count;
      if (row.disposition === 'interested') interested = row.count;
      if (row.disposition === 'not_interested') notInterested = row.count;
      if (row.disposition === 'no_answer') noAnswer = row.count;
      if (row.disposition === 'voicemail') voicemails = row.count;
    }

    const callsByCategory: Record<string, number> = {};
    for (const row of categoryRows) {
      callsByCategory[row.category] = row.count;
    }

    const answeredCalls = interested + notInterested;
    const conversionRate = answeredCalls > 0 ? (interested / answeredCalls) * 100 : 0;

    const stats: CallIntelligenceStats = {
      totalCalls: totalRow.total,
      interestedCalls: interested,
      notInterestedCalls: notInterested,
      noAnswerCalls: noAnswer,
      voicemailCalls: voicemails,
      conversionRate: Math.round(conversionRate * 10) / 10,
      avgCallDuration: Math.round(avgDurationRow.avg_duration || 0),
      callsByCategory,
      callsByDisposition,
    };

    res.json(stats);
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/intelligence/analyse
 * Runs AI analysis on call transcripts and stores the results.
 * Feeds transcripts to Claude for objection/win pattern extraction.
 */
router.post('/analyse', async (req, res, next) => {
  try {
    const db = getDb();
    const { dateFrom, dateTo } = req.body;

    // Fetch all call logs with transcripts
    let sql = `
      SELECT
        cl.id, cl.lead_id, cl.duration, cl.transcript, cl.summary,
        cl.key_topics, cl.action_items, cl.sentiment, cl.disposition,
        cl.created_at,
        l.name as lead_name, l.company as lead_company, l.category as lead_category
      FROM call_logs cl
      INNER JOIN leads l ON l.id = cl.lead_id
      WHERE cl.transcript IS NOT NULL AND cl.transcript != ''
    `;
    const params: Record<string, string> = {};

    if (dateFrom) {
      sql += ' AND cl.created_at >= @dateFrom';
      params.dateFrom = String(dateFrom);
    }
    if (dateTo) {
      sql += ' AND cl.created_at <= @dateTo';
      params.dateTo = String(dateTo);
    }
    sql += ' ORDER BY cl.created_at DESC';

    const rows = db.prepare(sql).all(params) as CallLogWithLeadRow[];

    if (rows.length === 0) {
      throw new ApiError(400, 'No call transcripts found for the selected date range');
    }

    // Build the prompt for Claude
    const interestedTranscripts = rows
      .filter((r) => r.disposition === 'interested')
      .map((r) => `[${r.lead_name} - ${r.lead_company || 'Unknown'} - ${r.lead_category || 'Uncategorised'}]\n${r.transcript}`)
      .join('\n\n---\n\n');

    const notInterestedTranscripts = rows
      .filter((r) => r.disposition === 'not_interested')
      .map((r) => `[${r.lead_name} - ${r.lead_company || 'Unknown'} - ${r.lead_category || 'Uncategorised'}]\n${r.transcript}`)
      .join('\n\n---\n\n');

    const allTranscripts = rows
      .map((r) => `[${r.disposition.toUpperCase()}] [${r.lead_name} - ${r.lead_company || 'Unknown'} - ${r.lead_category || 'Uncategorised'}]\n${r.transcript}`)
      .join('\n\n---\n\n');

    const prompt = `You are a sales intelligence analyst for OxyScale, an AI and automation consultancy. Analyse the following sales call transcripts and provide actionable insights.

Total calls analysed: ${rows.length}
Interested: ${rows.filter((r) => r.disposition === 'interested').length}
Not Interested: ${rows.filter((r) => r.disposition === 'not_interested').length}
No Answer: ${rows.filter((r) => r.disposition === 'no_answer').length}
Voicemail: ${rows.filter((r) => r.disposition === 'voicemail').length}

== INTERESTED (SUCCESSFUL) CALL TRANSCRIPTS ==
${interestedTranscripts || 'No interested call transcripts available.'}

== NOT INTERESTED (UNSUCCESSFUL) CALL TRANSCRIPTS ==
${notInterestedTranscripts || 'No not-interested call transcripts available.'}

== ALL CALL TRANSCRIPTS ==
${allTranscripts}

Based on these transcripts, provide your analysis in the following JSON format:
{
  "commonObjections": ["objection 1 — brief explanation of frequency and context", "objection 2", ...],
  "winningPatterns": ["pattern 1 — what worked and why", "pattern 2", ...],
  "recommendations": ["recommendation 1 — specific actionable suggestion", "recommendation 2", ...]
}

Guidelines:
- For commonObjections: Identify the top recurring reasons prospects say no. Include the objection itself and how frequently it appeared. Focus on themes, not individual instances.
- For winningPatterns: Identify what the salesperson did or said that led to positive outcomes. What topics, approaches, or value props resonated?
- For recommendations: Provide specific, actionable suggestions for improving the sales pitch, handling objections, and increasing conversion rate. Be direct and practical.
- Keep each item to 1-2 sentences max.
- Return ONLY valid JSON, no other text.`;

    // Check if Anthropic API key is available
    const apiKey = process.env.ANTHROPIC_API_KEY;
    let analysis: { commonObjections: string[]; winningPatterns: string[]; recommendations: string[] };

    if (apiKey) {
      // Call Claude API
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 2000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        logger.error({ status: response.status, error: errorText }, 'Claude API error');
        throw new ApiError(502, 'Failed to get AI analysis. Check your ANTHROPIC_API_KEY.');
      }

      const claudeResponse = await response.json() as {
        content: { type: string; text: string }[];
      };

      const responseText = claudeResponse.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('');

      // Parse the JSON from Claude's response
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new ApiError(502, 'AI returned invalid analysis format');
      }

      analysis = JSON.parse(jsonMatch[0]);
    } else {
      // No API key — generate placeholder analysis from available data
      logger.warn('No ANTHROPIC_API_KEY set — generating placeholder analysis');

      const objectionCount = rows.filter((r) => r.disposition === 'not_interested').length;
      const winCount = rows.filter((r) => r.disposition === 'interested').length;

      analysis = {
        commonObjections: objectionCount > 0
          ? [`${objectionCount} not-interested calls recorded — connect your Anthropic API key to analyse objection patterns`]
          : ['No not-interested calls recorded yet'],
        winningPatterns: winCount > 0
          ? [`${winCount} interested calls recorded — connect your Anthropic API key to analyse winning patterns`]
          : ['No interested calls recorded yet'],
        recommendations: [
          'Connect your ANTHROPIC_API_KEY in the .env file to enable full AI analysis',
          `You have ${rows.length} call transcripts ready for analysis`,
        ],
      };
    }

    // Save the analysis to the database
    const result = db.prepare(`
      INSERT INTO call_intelligence (analysis_type, date_range_start, date_range_end, total_calls_analysed, common_objections, winning_patterns, recommendations, raw_analysis)
      VALUES (@type, @dateFrom, @dateTo, @total, @objections, @patterns, @recs, @raw)
    `).run({
      type: 'full',
      dateFrom: dateFrom || null,
      dateTo: dateTo || null,
      total: rows.length,
      objections: JSON.stringify(analysis.commonObjections),
      patterns: JSON.stringify(analysis.winningPatterns),
      recs: JSON.stringify(analysis.recommendations),
      raw: JSON.stringify(analysis),
    });

    const saved = db.prepare('SELECT * FROM call_intelligence WHERE id = ?')
      .get(result.lastInsertRowid) as IntelligenceRow;

    logger.info({ analysisId: saved.id, callsAnalysed: rows.length }, 'Call intelligence analysis complete');
    res.status(201).json(mapIntelligenceRow(saved));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/intelligence/analyses
 * Returns all saved analysis snapshots, newest first.
 */
router.get('/analyses', (req, res, next) => {
  try {
    const db = getDb();
    const rows = db.prepare(
      'SELECT * FROM call_intelligence ORDER BY created_at DESC'
    ).all() as IntelligenceRow[];

    res.json(rows.map(mapIntelligenceRow));
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/intelligence/analyses/:id
 * Deletes a saved analysis.
 */
router.delete('/analyses/:id', (req, res, next) => {
  try {
    const db = getDb();
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, 'Invalid analysis ID');

    const result = db.prepare('DELETE FROM call_intelligence WHERE id = ?').run(id);
    if (result.changes === 0) throw new ApiError(404, 'Analysis not found');

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
