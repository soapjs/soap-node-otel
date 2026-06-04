import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { NoopTracer, Tracer } from './tracer';

declare module 'express-serve-static-core' {
  interface Request {
    traceId?: string;
    span?: import('./tracer').Span;
  }
}

export interface TracingMiddlewareOptions {
  tracer?: Tracer;
  /** Reuse X-Request-Id / requestId when present (keeps logs and traces aligned). */
  headerName?: string;
}

/**
 * Starts a request span and exposes `req.traceId` for logging middleware and
 * downstream handlers. Swap {@link Tracer} via DI for OpenTelemetry later.
 */
export class TracingMiddleware {
  static create(options: TracingMiddlewareOptions = {}) {
    const tracer = options.tracer ?? new NoopTracer();
    const header = (options.headerName ?? 'x-request-id').toLowerCase();

    return (req: Request, res: Response, next: NextFunction) => {
      const incoming =
        (req.headers[header] as string | undefined) ??
        (req as Request & { requestId?: string }).requestId;
      const traceId = incoming ?? randomUUID();

      const span = tracer.startSpan('http.request', {
        'http.method': req.method,
        'http.route': req.path,
        traceId,
      });

      req.traceId = traceId;
      req.span = span;

      res.on('finish', () => {
        span.setAttribute('http.status_code', res.statusCode);
        span.end();
      });

      next();
    };
  }
}
