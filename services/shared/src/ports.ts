/**
 * Puertos pequeños que el dominio necesita y que la infraestructura provee.
 * Tenerlos como interfaces permite inyectar relojes y generadores fijos en tests.
 */
import { ulid } from 'ulid';

export interface Clock {
  now(): Date;
}

export interface IdGenerator {
  next(): string;
}

export const systemClock: Clock = { now: () => new Date() };

/** ULID: ordenable por tiempo y sin colisiones; ideal como id y como SK. */
export const ulidGenerator: IdGenerator = { next: () => ulid() };

export class FixedClock implements Clock {
  constructor(private readonly fixed: Date) {}
  now(): Date {
    return this.fixed;
  }
}

export class SequenceIds implements IdGenerator {
  private n = 0;
  constructor(private readonly prefix = 'id-') {}
  next(): string {
    this.n += 1;
    return `${this.prefix}${this.n}`;
  }
}
