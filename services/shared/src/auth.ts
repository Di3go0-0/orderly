/**
 * Identidad y RBAC. API Gateway ya validó firma y expiración del JWT de Cognito;
 * aquí solo leemos los claims y decidimos qué puede hacer cada rol.
 */
import { ForbiddenError } from './errors.js';

export type Role = 'admin' | 'customer';
const KNOWN_ROLES: readonly Role[] = ['admin', 'customer'];

export interface Principal {
  /** `sub` del token: id estable del usuario en Cognito. */
  sub: string;
  email?: string;
  roles: Role[];
}

/**
 * API Gateway HTTP API entrega los arrays de claims como string "[admin customer]".
 * Aceptamos ese formato, un array real o un string separado por comas.
 */
export function parseGroups(raw: unknown): Role[] {
  let names: string[] = [];
  if (Array.isArray(raw)) {
    names = raw.map(String);
  } else if (typeof raw === 'string') {
    names = raw.replace(/^\[|\]$/g, '').split(/[\s,]+/).filter(Boolean);
  }
  return names.filter((n): n is Role => (KNOWN_ROLES as readonly string[]).includes(n));
}

export function principalFromClaims(claims: Record<string, unknown> | undefined): Principal {
  if (!claims || typeof claims.sub !== 'string') {
    throw new ForbiddenError('Missing identity claims');
  }
  const principal: Principal = { sub: claims.sub, roles: parseGroups(claims['cognito:groups']) };
  if (typeof claims.email === 'string') principal.email = claims.email;
  return principal;
}

export function hasRole(p: Principal, role: Role): boolean {
  return p.roles.includes(role);
}

/** Lanza ForbiddenError si el principal no tiene al menos uno de los roles. */
export function requireRole(p: Principal, ...roles: Role[]): void {
  if (!roles.some((r) => hasRole(p, r))) {
    throw new ForbiddenError(`Requires role: ${roles.join(' | ')}`);
  }
}
