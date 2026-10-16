import type { z, ZodTypeAny } from 'zod';
import { ValidationError } from './errors.js';

/** Valida en el borde (handler) y devuelve el tipo de salida del esquema; en error, 400 con detalle. */
export function parse<S extends ZodTypeAny>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(
      'Invalid input',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data as z.output<S>;
}
