import { TracingMiddleware } from '../tracing-middleware';
import { NoopTracer, OpenTelemetryTracer } from '../tracer';
import { TracingPlugin } from '../tracing-plugin';

describe('TracingMiddleware', () => {
  it('sets req.traceId and ends span on finish', (done) => {
    const mw = TracingMiddleware.create({ tracer: new NoopTracer() });
    const req: any = createRequest();
    const res: any = createResponse();
    mw(req, res, () => {
      expect(req.traceId).toBeDefined();
      expect(req.span).toBeDefined();
      expect(req.traceId).toBe(req.span.traceId);
      expect(res.headers['x-trace-id']).toBe(req.traceId);
      res.emitFinish();
      done();
    });
  });

  it('reuses configured request-id header for the noop tracer', (done) => {
    const mw = TracingMiddleware.create({ tracer: new NoopTracer(), headerName: 'x-correlation-id' });
    const req: any = createRequest({ headers: { 'x-correlation-id': 'request-123' } });
    const res: any = createResponse();

    mw(req, res, () => {
      expect(req.traceId).toBe('request-123');
      expect(req.span.traceId).toBe('request-123');
      expect(res.headers['x-request-id']).toBe('request-123');
      done();
    });
  });

  it('starts an OpenTelemetry server span and activates its context', (done) => {
    const otelSpan = createOtelSpan('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'bbbbbbbbbbbbbbbb');
    const otelTracer = {
      startSpan: jest.fn(() => otelSpan),
    };
    const tracer = new OpenTelemetryTracer({ tracer: otelTracer as any });
    const mw = TracingMiddleware.create({ tracer });
    const req: any = createRequest({
      headers: {
        traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
      },
    });
    const res: any = createResponse();

    mw(req, res, () => {
      expect(otelTracer.startSpan).toHaveBeenCalledWith(
        'GET /health',
        expect.objectContaining({
          kind: expect.any(Number),
          attributes: expect.objectContaining({
            'http.method': 'GET',
            'http.route': '/health',
            'soap.request_id': expect.any(String),
          }),
        }),
        expect.anything(),
      );
      expect(req.traceId).toBe('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
      expect(req.span.spanId).toBe('bbbbbbbbbbbbbbbb');
      res.emitFinish();
      expect(otelSpan.setAttribute).toHaveBeenCalledWith('http.status_code', 200);
      expect(otelSpan.end).toHaveBeenCalledTimes(1);
      done();
    });
  });

  it('falls back to request id when OpenTelemetry returns an invalid span context', (done) => {
    const otelSpan = createOtelSpan(
      '00000000000000000000000000000000',
      '0000000000000000',
    );
    const tracer = new OpenTelemetryTracer({
      tracer: {
        startSpan: jest.fn(() => otelSpan),
      } as any,
    });
    const mw = TracingMiddleware.create({ tracer });
    const req: any = createRequest({ headers: { 'x-request-id': 'request-123' } });
    const res: any = createResponse();

    mw(req, res, () => {
      expect(req.traceId).toBe('request-123');
      expect(req.span.traceId).toBe('request-123');
      done();
    });
  });

  it('ends a span only once when finish and close both fire', (done) => {
    const tracer = new NoopTracer();
    const span = tracer.startSpan('test');
    jest.spyOn(span, 'end');
    jest.spyOn(tracer, 'startSpan').mockReturnValue(span);
    const mw = TracingMiddleware.create({ tracer });
    const req: any = createRequest();
    const res: any = createResponse();

    mw(req, res, () => {
      res.emitFinish();
      res.emitClose();
      expect(span.end).toHaveBeenCalledTimes(1);
      done();
    });
  });
});

describe('TracingPlugin', () => {
  it('installs tracing middleware and binds tracer in the SoapJS container', async () => {
    const use = jest.fn();
    const container = {
      has: jest.fn(() => false),
      bindValue: jest.fn(),
    };
    const app: any = {
      getApp: () => ({ use }),
      getContainer: () => container,
    };
    const tracer = new NoopTracer();

    await new TracingPlugin().install(app, { tracer });

    expect(use).toHaveBeenCalledWith(expect.any(Function));
    expect(container.bindValue).toHaveBeenCalledWith('Tracer', tracer);
  });
});

function createRequest(overrides: Record<string, unknown> = {}) {
  return {
    method: 'GET',
    path: '/health',
    originalUrl: '/health?ready=true',
    url: '/health?ready=true',
    protocol: 'http',
    headers: {},
    get(name: string) {
      return name.toLowerCase() === 'host' ? 'localhost:3000' : undefined;
    },
    ...overrides,
  };
}

function createResponse() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name.toLowerCase()] = value;
    },
    once(event: string, fn: () => void) {
      if (event === 'finish') {
        this._finish = fn;
      }
      if (event === 'close') {
        this._close = fn;
      }
    },
    emitFinish() {
      this._finish?.();
    },
    emitClose() {
      this._close?.();
    },
  };
}

function createOtelSpan(traceId: string, spanId: string) {
  return {
    spanContext: () => ({ traceId, spanId, traceFlags: 1 }),
    setAttribute: jest.fn(function setAttribute() {
      return this;
    }),
    setStatus: jest.fn(function setStatus() {
      return this;
    }),
    recordException: jest.fn(),
    end: jest.fn(),
  };
}
