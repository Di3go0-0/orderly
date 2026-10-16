import { describe, expect, it } from 'vitest';
import { parseGroups, principalFromClaims, requireRole } from './auth.js';
import { ForbiddenError } from './errors.js';

describe('parseGroups', () => {
  it('parses the "[a b]" format that API Gateway HTTP API produces', () => {
    expect(parseGroups('[admin customer]')).toEqual(['admin', 'customer']);
    expect(parseGroups('[admin]')).toEqual(['admin']);
  });
  it('accepts real arrays and ignores unknown groups', () => {
    expect(parseGroups(['customer', 'superuser'])).toEqual(['customer']);
  });
  it('returns [] when the claim is missing', () => {
    expect(parseGroups(undefined)).toEqual([]);
  });
});

describe('requireRole', () => {
  const p = principalFromClaims({ sub: 'u1', email: 'a@b.co', 'cognito:groups': '[customer]' });
  it('passes when one of the roles matches', () => {
    expect(() => requireRole(p, 'admin', 'customer')).not.toThrow();
  });
  it('throws ForbiddenError otherwise', () => {
    expect(() => requireRole(p, 'admin')).toThrow(ForbiddenError);
  });
  it('rejects claims without sub', () => {
    expect(() => principalFromClaims({})).toThrow(ForbiddenError);
  });
});
