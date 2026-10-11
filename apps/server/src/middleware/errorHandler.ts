import type { NextFunction, Request, Response } from 'express';
import { logger } from '../logger';
import { env } from '../env';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

/** Recognizes both our own HttpError and third-party libraries (e.g. csrf-csrf's
 * http-errors-based ForbiddenError) that follow the same `status`/`statusCode` convention. */
function getHttpStatus(err: unknown): number | undefined {
  if (err instanceof HttpError) return err.status;
  if (typeof err === 'object' && err !== null) {
    const candidate =
      (err as { status?: unknown; statusCode?: unknown }).status ??
      (err as { statusCode?: unknown }).statusCode;
    if (typeof candidate === 'number' && candidate >= 400 && candidate < 600) return candidate;
  }
  return undefined;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  const status = getHttpStatus(err) ?? 500;
  const isClientError = status >= 400 && status < 500;

  // Messages are safe to send when *we* wrote them. Masking used to key off `status < 500`,
  // which silently swallowed every deliberate 5xx message: a `HttpError(503, 'This song is
  // temporarily unavailable — please try again shortly')` reached the player as the useless
  // "Internal server error". An explicitly constructed HttpError is authored copy, so it is
  // surfaced at any status; anything else is still masked so unexpected failures can't leak
  // internals.
  const isAuthoredError = err instanceof HttpError;
  const canRevealMessage = isAuthoredError || (isClientError && err instanceof Error);
  const message = canRevealMessage && err instanceof Error ? err.message : 'Internal server error';

  if (!isClientError) {
    logger.error({ err, path: req.path }, 'Unhandled error');
  } else {
    logger.warn({ path: req.path, status }, 'Request rejected');
  }

  res.status(status).json({
    error: message,
    // Explicitly development, not merely "not production": a stack trace names internal paths and
    // query shapes, so an unconfigured deploy should withhold it rather than volunteer it.
    ...(env.NODE_ENV === 'development' && !canRevealMessage && err instanceof Error
      ? { stack: err.stack }
      : {}),
  });
}
