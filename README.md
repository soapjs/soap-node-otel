# @soapjs/soap-node-otel

Request tracing middleware for SoapJS Express apps. Ships with a **noop tracer** (`req.traceId`, `req.span`) and a `Tracer` port you can replace with OpenTelemetry later.

## Install

```bash
npm install @soapjs/soap-node-otel @soapjs/soap-express @soapjs/soap
```

## Usage

```typescript
import { bootstrap } from '@soapjs/soap-express';

await bootstrap({
  controllers: [MyController],
  tracing: true, // installs NoopTracer + TracingMiddleware
});
```

Or register explicitly:

```typescript
import { TracingMiddleware, NoopTracer } from '@soapjs/soap-node-otel';

app.getApp().use(TracingMiddleware.create({ tracer: new NoopTracer() }));
```

## Peer dependencies

- `@soapjs/soap` >= 0.12.0
- `express` >= 4
