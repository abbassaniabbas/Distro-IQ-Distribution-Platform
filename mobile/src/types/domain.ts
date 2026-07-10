export type AppRole = "sales_representative" | "store_keeper" | "accountant" | "ceo";

export type PaymentMethod = "cash" | "transfer" | "pos" | "credit";

export type SyncStatus = "pending" | "syncing" | "synced" | "failed";

export interface AppUser {
  id: string;
  tenantId: string;
  name: string;
  role: AppRole;
}

export interface Product {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  unit: string;
  unitPrice: number;
  category: string;
  isActive: boolean;
}

export interface AssignedStock {
  id: string;
  productId: string;
  representativeId: string;
  assignedQuantity: number;
  availableQuantity: number;
  assignedAt: string;
}

export interface Customer {
  id: string;
  tenantId: string;
  name: string;
  type: "supermarket" | "retailer" | "kiosk" | "wholesaler" | "walk_in";
  phone?: string;
  address?: string;
  creditLimit: number;
  creditBalance: number;
}

export interface SaleLine {
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

export interface Sale {
  id: string;
  tenantId: string;
  representativeId: string;
  customerId: string;
  customerName: string;
  lines: SaleLine[];
  paymentMethod: PaymentMethod;
  total: number;
  notes?: string;
  createdAt: string;
  syncStatus: SyncStatus;
}

export interface SaleDraft {
  customerId: string;
  lines: SaleLine[];
  paymentMethod: PaymentMethod;
  notes?: string;
}
