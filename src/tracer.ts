import { randomUUID } from 'crypto';
import type { Span, Tracer as TracerPort } from '@soapjs/soap/http';
import {
  context,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  isSpanContextValid,
  trace,
  type Attributes,
  type AttributeValue,
  type Context,
  type Span as OtelSpanPort,
  type Tracer as OtelTracerPort,
  type TextMapGetter,
} from '@opentelemetry/api';

export type { Span, Tracer } from '@soapjs/soap/http';

export interface ContextAwareSpan extends Span {
  runInContext<T>(fn: () => T): T;
  recordException?(error: unknown): void;
}

export class NoopSpan implements Span {
  readonly traceId: string;
  readonly spanId: string;
  private readonly attributes: Record<string, unknown> = {};

  constructor(traceId?: string) {
    this.traceId = traceId ?? randomUUID();
    this.spanId = randomUUID();
  }

  setAttribute(key: string, value: unknown): void {
    this.attributes[key] = value;
  }

  end(): void {
    // no-op
  }

  getAttributes(): Record<string, unknown> {
    return { ...this.attributes };
  }
}

export class NoopTracer implements TracerPort {
  startSpan(_name: string, attributes?: Record<string, unknown>): Span {
    const span = new NoopSpan(typeof attributes?.traceId === 'string' ? attributes.traceId : undefined);
    if (attributes) {
      Object.entries(attributes).forEach(([k, v]) => span.setAttribute(k, v));
    }
    return span;
  }
}

export interface OpenTelemetryTracerOptions {
  tracer?: OtelTracerPort;
  instrumentationName?: string;
  instrumentationVersion?: string;
  context?: Context;
}

const headerGetter: TextMapGetter<Record<string, unknown>> = {
  keys(carrier) {
    return Object.keys(carrier);
  },
  get(carrier, key) {
    const value = carrier[key] ?? carrier[key.toLowerCase()];
    if (Array.isArray(value)) {
      return value.map(String);
    }
    if (value === undefined) {
      return undefined;
    }
    return String(value);
  },
};

export class OpenTelemetrySpan implements ContextAwareSpan {
  readonly traceId: string;
  readonly spanId: string;

  constructor(
    private readonly span: OtelSpanPort,
    private readonly activeContext: Context,
    fallbackTraceId?: string,
  ) {
    const spanContext = span.spanContext();
    this.traceId = isSpanContextValid(spanContext) ? spanContext.traceId : fallbackTraceId ?? randomUUID();
    this.spanId = isSpanContextValid(spanContext) ? spanContext.spanId : randomUUID();
  }

  setAttribute(key: string, value: unknown): void {
    const attributeValue = toAttributeValue(value);
    if (attributeValue !== undefined) {
      this.span.setAttribute(key, attributeValue);
    }
  }

  recordException(error: unknown): void {
    if (error instanceof Error || typeof error === 'string') {
      this.span.recordException(error);
    } else {
      this.span.recordException(String(error));
    }
  }

  setStatus(code: 'ok' | 'error', message?: string): void {
    this.span.setStatus({
      code: code === 'error' ? SpanStatusCode.ERROR : SpanStatusCode.OK,
      message,
    });
  }

  runInContext<T>(fn: () => T): T {
    return context.with(this.activeContext, fn);
  }

  end(): void {
    this.span.end();
  }
}

export class OpenTelemetryTracer implements TracerPort {
  private readonly tracer: OtelTracerPort;
  private readonly baseContext: Context;

  constructor(options: OpenTelemetryTracerOptions = {}) {
    this.tracer =
      options.tracer ??
      trace.getTracer(
        options.instrumentationName ?? '@soapjs/soap-otel',
        options.instrumentationVersion,
      );
    this.baseContext = options.context ?? context.active() ?? ROOT_CONTEXT;
  }

  startSpan(name: string, attributes?: Record<string, unknown>): ContextAwareSpan {
    const span = this.tracer.startSpan(name, {
      kind: SpanKind.INTERNAL,
      attributes: toAttributes(attributes),
    }, this.baseContext);
    return this.wrapSpan(span, this.baseContext, typeof attributes?.traceId === 'string' ? attributes.traceId : undefined);
  }

  startHttpSpan(
    name: string,
    attributes: Record<string, unknown> = {},
    headers: Record<string, unknown> = {},
  ): ContextAwareSpan {
    const parentContext = propagation.extract(this.baseContext, headers, headerGetter);
    const span = this.tracer.startSpan(name, {
      kind: SpanKind.SERVER,
      attributes: toAttributes(attributes),
    }, parentContext);
    return this.wrapSpan(
      span,
      trace.setSpan(parentContext, span),
      typeof attributes['soap.request_id'] === 'string' ? attributes['soap.request_id'] : undefined,
    );
  }

  private wrapSpan(span: OtelSpanPort, activeContext: Context, fallbackTraceId?: string): ContextAwareSpan {
    return new OpenTelemetrySpan(span, activeContext, fallbackTraceId);
  }
}

function toAttributes(attributes?: Record<string, unknown>): Attributes | undefined {
  if (!attributes) {
    return undefined;
  }

  return Object.entries(attributes).reduce<Attributes>((acc, [key, value]) => {
    const attributeValue = toAttributeValue(value);
    if (attributeValue !== undefined) {
      acc[key] = attributeValue;
    }
    return acc;
  }, {});
}

function toAttributeValue(value: unknown): AttributeValue | undefined {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value;
  }

  if (isAttributeArray(value)) {
    return value;
  }

  return undefined;
}

function isAttributeArray(value: unknown): value is string[] | number[] | boolean[] {
  if (!Array.isArray(value)) {
    return false;
  }

  return (
    value.every((item) => typeof item === 'string') ||
    value.every((item) => typeof item === 'number') ||
    value.every((item) => typeof item === 'boolean')
  );
}
