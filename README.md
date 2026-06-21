# @soapjs/soap-otel

OpenTelemetry tracing adapter for SoapJS Express applications.

This package provides:

- `OpenTelemetryTracer` - adapter from `@opentelemetry/api` to the SoapJS `Tracer` port.
- `TracingMiddleware` - Express middleware that creates a server span per request.
- `TracingPlugin` - SoapJS HTTP plugin for `@soapjs/soap-express`.
- `NoopTracer` - lightweight test/fallback tracer with the same SoapJS port.

## Install

```bash
npm install @soapjs/soap-otel @soapjs/soap-express @soapjs/soap @opentelemetry/api
```

Install and configure the OpenTelemetry SDK/exporter you use in your app, for example OTLP:

```bash
npm install @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
```

## Usage With Soap Express

Configure your OpenTelemetry SDK before bootstrapping the app, then install the tracing plugin.

```typescript
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { bootstrap } from '@soapjs/soap-express';
import { TracingPlugin } from '@soapjs/soap-otel';

const sdk = new NodeSDK({
  traceExporter: new OTLPTraceExporter({
    url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT,
  }),
});

await sdk.start();

await bootstrap({
  controllers: [MyController],
  middleware: {
    logging: true,
  },
  plugins: [
    new TracingPlugin(),
  ],
});
```

The plugin binds the tracer under `Tracer.Token` in the SoapJS container and installs the request middleware on the Express app.

## Explicit Middleware

```typescript
import { OpenTelemetryTracer, TracingMiddleware } from '@soapjs/soap-otel';

app.getApp().use(
  TracingMiddleware.create({
    tracer: new OpenTelemetryTracer(),
  }),
);
```

## Custom Span Names

```typescript
plugins: [
  {
    plugin: new TracingPlugin(),
    options: {
      spanName: (req) => `${req.method} ${req.path}`,
    },
  },
];
```

## Request Data

For each request the middleware:

- starts an OpenTelemetry `SERVER` span,
- extracts parent context from incoming propagation headers such as `traceparent`,
- exposes `req.traceId` and `req.span`,
- sets response headers `x-trace-id` and `x-request-id`,
- records HTTP method, route, target, URL, request id, and status code attributes,
- marks spans with status `ERROR` for HTTP 5xx responses,
- ends spans once on `finish` or `close`.

## Peer Dependencies

- `@soapjs/soap` ^0.14.0
- `@opentelemetry/api` ^1.9.0
- `express` >= 4
