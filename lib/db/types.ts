import type Database from "better-sqlite3";

export type OrderStatus =
  | "confirmed"
  | "payment_required"
  | "payment_in_process"
  | "paid"
  | "partially_paid"
  | "cancelled"
  | "invalid"
  | string; // ML adds statuses we don't enumerate

export interface OrderItem {
  id?: string;
  title: string;
  quantity: number;
  unit_price: number;
  full_unit_price?: number;
  currency_id?: string;
  variation_id?: number;
  variation_attributes?: Array<{ id: string; name: string; value_id: string; value_name: string }>;
  seller_sku?: string | null;
}

export interface OrderPayment {
  id?: number;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_approved?: string;
  payment_method_id?: string;
  payment_type_id?: string;
}

export interface OrderShipping {
  id?: number;
  status?: string;
  tracking_number?: string;
  tracking_method?: string;
  logistic_type?: string;
  receiver_address?: Record<string, unknown>;
}

export interface Order {
  id: number;
  status: OrderStatus;
  status_detail?: string;
  date_created: number;
  date_closed?: number | null;
  last_updated?: number;
  total_amount: number;
  currency_id: string;
  buyer_id?: number;
  buyer_nickname?: string;
  items: OrderItem[];
  payments: OrderPayment[];
  shipping: OrderShipping | null;
  tags: string[];
  listing_type_id?: string | null;
  /** Comisión real cobrada por MercadoLibre (desde la API de orders) */
  sale_fee: number | null;
  /** Estado del reclamo en MercadoLibre: null = sin reclamo, 'opened', 'closed' */
  claim_status: "opened" | "closed" | null;
  synced_at: number;
}

export interface MlCredentials {
  id: 1;
  user_id: number;
  nickname: string | null;
  email: string | null;
  access_token: string;
  refresh_token: string;
  expires_at: number;
  scope: string | null;
  token_type: string | null;
  updated_at: number;
}

export interface SyncLogEntry {
  id: number;
  job_name: string;
  started_at: number;
  finished_at: number | null;
  status: "success" | "error" | "partial" | "running";
  records_processed: number;
  error_message: string | null;
}

export interface Shipment {
  id: number;
  order_id: number;
  status: string;
  substatus: string | null;
  logistic_type: string | null;
  mode: string | null;
  tracking_number: string | null;
  tracking_method: string | null;
  carrier: string | null;
  cost: number | null;
  cost_currency: string | null;
  receiver_address: Record<string, unknown> | null;
  shipping_items: Array<Record<string, unknown>> | null;
  shipping_option: Record<string, unknown> | null;
  handling_limit: number | null;
  date_created: number | null;
  date_first_printed: number | null;
  date_delivered: number | null;
  synced_at: number;
}

export interface ItemVisit {
  item_id: string;
  date: string;
  total: number;
  synced_at: number;
}

export interface OrderCost {
  order_id: number;
  cost: number;
  ml_fee_pct: number;
  notes: string | null;
  /** 'iva' = cálculo con IVA y percepciones; 'kilos' = costo logístico por peso */
  logistic_mode: "iva" | "kilos";
  /** Peso en kg (solo usado cuando logistic_mode = 'kilos') */
  weight_kg: number | null;
  /** Ganancia manual ingresada por el usuario (si no está seteada, se calcula desde la fórmula) */
  gain: number | null;
  /** Costo de envío de Mercado Libre a cargo del vendedor (ARS) */
  ml_envio: number | null;
  ml_neto?: number | null;
  iibb?: number | null;
  row_color?: string | null;
  manual_cost_input?: string | null;
  manual_cost_currency?: string | null;
  updated_at: number;
}

export interface MonthlyExpense {
  id: string;
  month: string;
  concepto: string;
  monto: number;
  created_at?: number;
  updated_at?: number;
}

// Helper type for SQLite row mapping
export type DbInstance = Database.Database;