import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { ContextAwareSpan, OpenTelemetryTracer, Tracer } from './tracer';

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
  spanName?: string | ((req: Request) => string);
}

/**
 * Starts a request span and exposes `req.traceId` for logging middleware and
 * downstream handlers.
 */
export class TracingMiddleware {
  static create(options: TracingMiddlewareOptions = {}) {
    const tracer = options.tracer ?? new OpenTelemetryTracer();
    const header = (options.headerName ?? 'x-request-id').toLowerCase();

    return (req: Request, res: Response, next: NextFunction) => {
      const requestId = resolveHeader(req, header) ?? (req as Request & { requestId?: string }).requestId ?? randomUUID();
      const route = req.route?.path ?? req.path;
      const spanName =
        typeof options.spanName === 'function'
          ? options.spanName(req)
          : options.spanName ?? `${req.method} ${route}`;

      const attributes = {
        'http.method': req.method,
        'http.route': route,
        'http.target': req.originalUrl ?? req.url,
        'http.url': getRequestUrl(req),
        'soap.request_id': requestId,
      };
      const maybeHttpTracer = tracer as Tracer & {
        startHttpSpan?: (
          name: string,
          attributes?: Record<string, unknown>,
          headers?: Record<string, unknown>,
        ) => ContextAwareSpan;
      };
      const span = maybeHttpTracer.startHttpSpan
        ? maybeHttpTracer.startHttpSpan(spanName, attributes, req.headers)
        : tracer.startSpan(spanName, { ...attributes, traceId: requestId });
      let ended = false;

      const endSpan = () => {
        if (ended) {
          return;
        }
        ended = true;

        span.setAttribute('http.status_code', res.statusCode);
        if (typeof (span as ContextAwareSpan & { setStatus?: unknown }).setStatus === 'function') {
          (span as ContextAwareSpan & { setStatus(code: 'ok' | 'error'): void }).setStatus(
            res.statusCode >= 500 ? 'error' : 'ok',
          );
        }
        span.end();
      };

      req.traceId = span.traceId || requestId;
      req.span = span;
      res.setHeader('x-request-id', requestId);
      res.setHeader('x-trace-id', req.traceId);

      res.once('finish', endSpan);
      res.once('close', endSpan);

      const runNext = () => {
        try {
          next();
        } catch (error) {
          if (typeof (span as ContextAwareSpan).recordException === 'function') {
            (span as ContextAwareSpan).recordException?.(error);
          }
          if (typeof (span as ContextAwareSpan & { setStatus?: unknown }).setStatus === 'function') {
            (span as ContextAwareSpan & { setStatus(code: 'error', message?: string): void }).setStatus(
              'error',
              error instanceof Error ? error.message : String(error),
            );
          }
          throw error;
        }
      };

      if (typeof (span as ContextAwareSpan).runInContext === 'function') {
        return (span as ContextAwareSpan).runInContext(runNext);
      }

      return runNext();
    };
  }
}

function resolveHeader(req: Request, header: string): string | undefined {
  const value = req.headers[header];
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function getRequestUrl(req: Request): string | undefined {
  const host = req.get('host');
  if (!host) {
    return undefined;
  }
  return `${req.protocol}://${host}${req.originalUrl ?? req.url}`;
}
