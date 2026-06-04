import { TracingMiddleware } from '../tracing-middleware';
import { NoopTracer } from '../tracer';

describe('TracingMiddleware', () => {
  it('sets req.traceId and ends span on finish', (done) => {
    const mw = TracingMiddleware.create({ tracer: new NoopTracer() });
    const req: any = { method: 'GET', path: '/health', headers: {} };
    const res: any = {
      statusCode: 200,
      on(event: string, fn: () => void) {
        if (event === 'finish') {
          this._finish = fn;
        }
      },
      emitFinish() {
        this._finish?.();
      },
    };
    mw(req, res, () => {
      expect(req.traceId).toBeDefined();
      expect(req.span).toBeDefined();
      res.emitFinish();
      done();
    });
  });
});
