/**
 * Entidad Product. Solo conoce sus reglas: precio y stock no negativos, nombre obligatorio.
 * No sabe qué es DynamoDB ni HTTP.
 */
import { InvariantError } from '@orderly/shared';

export interface ProductProps {
  id: string;
  name: string;
  description: string;
  /** Dinero en centavos y entero: nunca floats para precios. */
  priceCents: number;
  stock: number;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface NewProduct {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
  tags: string[];
}

export type ProductChanges = Partial<Omit<NewProduct, 'id'>>;

const NAME_MAX = 120;
const TAGS_MAX = 10;

function assertInvariants(p: Omit<ProductProps, 'createdAt' | 'updatedAt'>): void {
  if (p.name.trim().length === 0) throw new InvariantError('Product name is required');
  if (p.name.length > NAME_MAX) throw new InvariantError(`Product name exceeds ${NAME_MAX} chars`);
  if (!Number.isInteger(p.priceCents) || p.priceCents < 0) throw new InvariantError('priceCents must be a non-negative integer');
  if (!Number.isInteger(p.stock) || p.stock < 0) throw new InvariantError('stock must be a non-negative integer');
  if (p.tags.length > TAGS_MAX) throw new InvariantError(`At most ${TAGS_MAX} tags`);
}

export class Product {
  private constructor(private props: ProductProps) {}

  static create(input: NewProduct, now: Date): Product {
    const tags = normalizeTags(input.tags);
    const base = { ...input, name: input.name.trim(), tags };
    assertInvariants(base);
    const ts = now.toISOString();
    return new Product({ ...base, createdAt: ts, updatedAt: ts });
  }

  /** Reconstruye desde persistencia sin re-validar reglas de creación. */
  static rehydrate(props: ProductProps): Product {
    return new Product({ ...props });
  }

  update(changes: ProductChanges, now: Date): void {
    const next = {
      ...this.props,
      ...changes,
      name: (changes.name ?? this.props.name).trim(),
      tags: changes.tags ? normalizeTags(changes.tags) : this.props.tags,
    };
    assertInvariants(next);
    this.props = { ...next, updatedAt: now.toISOString() };
  }

  get id(): string {
    return this.props.id;
  }

  snapshot(): ProductProps {
    return { ...this.props, tags: [...this.props.tags] };
  }
}

function normalizeTags(tags: string[]): string[] {
  return [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
}
