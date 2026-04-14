// ============================================================
// Error Handling Middleware
// Catches all errors and returns structured JSON responses
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import type { Logger } from 'pino';
import { ZodError } from 'zod';

/**
 * Custom error class for API errors with HTTP status codes.
 */
export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * Creates the error handling middleware with a logger instance.
 * Must be mounted AFTER all routes in Express.
 */
export function createErrorHandler(logger: Logger) {
  return (err: Error, _req: Request, res: Response, _next: NextFunction): void => {
    // Zod validation errors — return 400 with field-level details
    if (err instanceof ZodError) {
      logger.warn({ errors: err.errors }, 'Validation error');
      res.status(400).json({
        error: 'Validation error',
        details: err.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }

    // Known API errors — return the specified status code
    if (err instanceof ApiError) {
      logger.warn({ statusCode: err.statusCode, details: err.details }, err.message);
      res.status(err.statusCode).json({
        error: err.message,
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }

    // Multer errors (file upload issues)
    if (err.name === 'MulterError') {
      logger.warn({ error: err.message }, 'File upload error');
      res.status(400).json({
        error: `File upload error: ${err.message}`,
      });
      return;
    }

    // Unexpected errors — log full stack, return 500
    logger.error({ err }, 'Unhandled server error');
    res.status(500).json({
      error: 'Internal server error',
    });
  };
}
