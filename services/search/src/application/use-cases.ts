import { logger } from '@orderly/shared';
import type { DomainEvent } from '@orderly/shared';
import type { ProductDocument, ProductIndex, SearchQuery, SearchResult } from '../domain/product-index.js';

/** Forma del payload que emite el contexto Catalog (ProductCreated/ProductUpdated). */
interface ProductChangedPayload {
  product: ProductDocument & { createdAt: string };
}
interface ProductDeletedPayload {
  productId: string;
}

/**
 * Proyecta un evento del catálogo sobre el índice. Es idempotente por naturaleza:
 * indexar dos veces el mismo documento deja el mismo resultado.
 */
export class ProjectProductEvent {
  constructor(private readonly index: ProductIndex) {}

  async execute(event: DomainEvent): Promise<void> {
    switch (event.eventType) {
      case 'ProductCreated':
      case 'ProductUpdated': {
        const { product } = event.payload as ProductChangedPayload;
        await this.index.upsert({
          id: product.id,
          name: product.name,
          description: product.description,
          priceCents: product.priceCents,
          stock: product.stock,
          tags: product.tags,
          updatedAt: product.updatedAt,
        });
        return;
      }
      case 'ProductDeleted': {
        const { productId } = event.payload as ProductDeletedPayload;
        await this.index.remove(productId);
        return;
      }
      default:
        logger.warn('ignoring unknown event type', { eventType: event.eventType });
    }
  }
}

export class SearchProducts {
  constructor(private readonly index: ProductIndex) {}

  async execute(query: SearchQuery): Promise<SearchResult> {
    return this.index.search(query);
  }
}
