import type { Sale } from "../types/domain";

export interface SalesSyncGateway {
  pushSale(sale: Sale): Promise<void>;
}

// This local gateway keeps the app flow testable until Supabase is connected.
export const sampleSalesSyncGateway: SalesSyncGateway = {
  async pushSale() {
    await new Promise((resolve) => setTimeout(resolve, 450));
  }
};
