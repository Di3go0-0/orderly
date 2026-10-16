/**
 * Contexto Search: una proyección de lectura del catálogo.
 * No es dueño de los productos; solo mantiene una copia optimizada para buscar.
 */
export interface ProductDocument {
  id: string;
  name: string;
  description: string;
  priceCents: number;
  stock: number;
  tags: string[];
  updatedAt: string;
}

export interface SearchQuery {
  text: string;
  limit: number;
  /** Si true, solo productos con stock > 0. */
  inStockOnly: boolean;
}

export interface SearchResult {
  items: ProductDocument[];
  total: number;
}

/** Puerto del índice. OpenSearch lo implementa; un Map lo implementa en tests. */
export interface ProductIndex {
  ensureReady(): Promise<void>;
  upsert(doc: ProductDocument): Promise<void>;
  remove(id: string): Promise<void>;
  search(query: SearchQuery): Promise<SearchResult>;
}
