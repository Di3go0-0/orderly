import type { OrderLine } from './order.js';

export const ORDERS_SOURCE = 'orders';

export interface OrderPlacedPayload {
  orderId: string;
  customerId: string;
  lines: Array<Pick<OrderLine, 'productId' | 'quantity'>>;
  totalCents: number;
}

export interface StockReservedPayload {
  orderId: string;
}

export interface StockRejectedPayload {
  orderId: string;
  reason: string;
}

export interface OrderConfirmedPayload {
  orderId: string;
  customerId: string;
  customerEmail?: string;
  totalCents: number;
}

export interface OrderRejectedPayload {
  orderId: string;
  customerId: string;
  reason: string;
}
