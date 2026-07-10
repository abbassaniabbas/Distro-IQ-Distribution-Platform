import type { Customer, SaleDraft } from "../types/domain";

export interface SaleValidationErrors {
  customer?: string;
  products?: string;
  payment?: string;
}

export function validateSaleDraft(
  draft: SaleDraft,
  customer: Customer | undefined
): SaleValidationErrors {
  const errors: SaleValidationErrors = {};

  if (!customer) errors.customer = "Choose who you are selling to.";
  if (!draft.lines.length) errors.products = "Add at least one product.";

  if (draft.paymentMethod === "credit") {
    if (customer?.type === "walk_in") {
      errors.payment = "Walk-in sales cannot be recorded on credit.";
    } else if (customer && draft.lines.reduce((sum, line) => sum + line.lineTotal, 0) > customer.creditLimit - customer.creditBalance) {
      errors.payment = "This sale is above the customer's available credit.";
    }
  }

  return errors;
}
