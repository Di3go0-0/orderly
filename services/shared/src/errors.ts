/**
 * Errores del dominio y de aplicación. No saben nada de HTTP: la capa http
 * (shared/http.ts) es la que traduce `code` a un status.
 */
export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'FORBIDDEN'
  | 'CONFLICT'
  | 'INVARIANT_VIOLATION'
  | 'UNAVAILABLE';

export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends DomainError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', details);
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super(`${entity} ${id} not found`, 'NOT_FOUND');
  }
}

export class ForbiddenError extends DomainError {
  constructor(message = 'Forbidden') {
    super(message, 'FORBIDDEN');
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 'CONFLICT');
  }
}

/** Una regla de negocio se violaría (p. ej. confirmar un pedido ya rechazado). */
export class InvariantError extends DomainError {
  constructor(message: string) {
    super(message, 'INVARIANT_VIOLATION');
  }
}

export class UnavailableError extends DomainError {
  constructor(message: string) {
    super(message, 'UNAVAILABLE');
  }
}
