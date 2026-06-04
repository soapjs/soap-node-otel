import { randomUUID } from 'crypto';
import type { Span, Tracer as TracerPort } from '@soapjs/soap/http';

export type { Span, Tracer } from '@soapjs/soap/http';

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
    const span = new NoopSpan();
    if (attributes) {
      Object.entries(attributes).forEach(([k, v]) => span.setAttribute(k, v));
    }
    return span;
  }
}
