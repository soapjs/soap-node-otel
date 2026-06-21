import type { HttpApp, HttpPlugin } from '@soapjs/soap/http';
import { OpenTelemetryTracer, Tracer } from './tracer';
import { TracingMiddleware, TracingMiddlewareOptions } from './tracing-middleware';

export interface TracingPluginOptions extends TracingMiddlewareOptions {
  tracer?: Tracer;
}

export class TracingPlugin implements HttpPlugin {
  readonly name = 'tracing';
  readonly version = '1.0.0';
  readonly description = 'OpenTelemetry request tracing for SoapJS Express apps';
  readonly tags = ['opentelemetry', 'tracing', 'express'];
  readonly category = 'observability';
  config: TracingPluginOptions = {};

  async install<Framework>(app: HttpApp<Framework>, options: TracingPluginOptions = {}): Promise<void> {
    const tracer = options.tracer ?? new OpenTelemetryTracer();
    this.config = { ...options, tracer };

    const container = app.getContainer();
    if (!container.has('Tracer')) {
      container.bindValue('Tracer', tracer);
    }

    const framework = app.getApp() as Framework & {
      use?: (middleware: ReturnType<typeof TracingMiddleware.create>) => unknown;
    };
    if (typeof framework.use !== 'function') {
      throw new Error('TracingPlugin requires an Express-compatible app with use()');
    }

    framework.use(TracingMiddleware.create(this.config));
  }
}

export default TracingPlugin;
