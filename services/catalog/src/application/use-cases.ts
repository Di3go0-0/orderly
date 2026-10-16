/**
 * Casos de uso del catálogo. Orquestan dominio + puertos; sin SDKs, sin HTTP.
 */
import { createEvent, NotFoundError, systemClock, ulidGenerator } from '@orderly/shared';
import type { Clock, IdGenerator } from '@orderly/shared';
import { Product } from '../domain/product.js';
import type { NewProduct, ProductChanges, ProductProps } from '../domain/product.js';
import type { ProductRepository } from '../domain/product-repository.js';
import { CATALOG_SOURCE } from '../domain/events.js';
import type { ProductCreatedPayload, ProductDeletedPayload, ProductUpdatedPayload } from '../domain/events.js';

export interface CatalogDeps {
  repo: ProductRepository;
  clock?: Clock;
  ids?: IdGenerator;
}

export type CreateProductInput = Omit<NewProduct, 'id'>;

export class CreateProduct {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  constructor(private readonly deps: CatalogDeps) {
    this.clock = deps.clock ?? systemClock;
    this.ids = deps.ids ?? ulidGenerator;
  }

  async execute(input: CreateProductInput): Promise<ProductProps> {
    const product = Product.create({ ...input, id: this.ids.next() }, this.clock.now());
    const snapshot = product.snapshot();
    const event = createEvent<ProductCreatedPayload>(
      { eventType: 'ProductCreated', source: CATALOG_SOURCE, aggregateId: product.id, payload: { product: snapshot } },
      { clock: this.clock, ids: this.ids },
    );
    await this.deps.repo.create(product, [event]);
    return snapshot;
  }
}

export class UpdateProduct {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  constructor(private readonly deps: CatalogDeps) {
    this.clock = deps.clock ?? systemClock;
    this.ids = deps.ids ?? ulidGenerator;
  }

  async execute(id: string, changes: ProductChanges): Promise<ProductProps> {
    const product = await this.deps.repo.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    product.update(changes, this.clock.now());
    const snapshot = product.snapshot();
    const event = createEvent<ProductUpdatedPayload>(
      { eventType: 'ProductUpdated', source: CATALOG_SOURCE, aggregateId: id, payload: { product: snapshot } },
      { clock: this.clock, ids: this.ids },
    );
    await this.deps.repo.update(product, [event]);
    return snapshot;
  }
}

export class DeleteProduct {
  private readonly clock: Clock;
  private readonly ids: IdGenerator;
  constructor(private readonly deps: CatalogDeps) {
    this.clock = deps.clock ?? systemClock;
    this.ids = deps.ids ?? ulidGenerator;
  }

  async execute(id: string): Promise<void> {
    const product = await this.deps.repo.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    const event = createEvent<ProductDeletedPayload>(
      { eventType: 'ProductDeleted', source: CATALOG_SOURCE, aggregateId: id, payload: { productId: id } },
      { clock: this.clock, ids: this.ids },
    );
    await this.deps.repo.delete(id, [event]);
  }
}

export class GetProduct {
  constructor(private readonly deps: CatalogDeps) {}

  async execute(id: string): Promise<ProductProps> {
    const product = await this.deps.repo.findById(id);
    if (!product) throw new NotFoundError('Product', id);
    return product.snapshot();
  }
}
