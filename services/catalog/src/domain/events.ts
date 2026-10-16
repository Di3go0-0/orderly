import type { ProductProps } from './product.js';

export const CATALOG_SOURCE = 'catalog';

/** Los tres comparten prefijo "Product": la regla de EventBridge usa `prefix: "Product"`. */
export type CatalogEventType = 'ProductCreated' | 'ProductUpdated' | 'ProductDeleted';

export interface ProductCreatedPayload {
  product: ProductProps;
}
export interface ProductUpdatedPayload {
  product: ProductProps;
}
export interface ProductDeletedPayload {
  productId: string;
}
