import type { AppRole } from "../types/domain";

export type Permission =
  | "sales:create"
  | "stock:assigned:view"
  | "customers:view"
  | "customers:create"
  | "payments:collect"
  | "stock:request"
  | "reports:own:view"
  | "reports:company:view";

const rolePermissions: Record<AppRole, Permission[]> = {
  sales_representative: [
    "sales:create",
    "stock:assigned:view",
    "customers:view",
    "customers:create",
    "payments:collect",
    "stock:request",
    "reports:own:view"
  ],
  store_keeper: ["stock:assigned:view", "stock:request"],
  accountant: ["reports:company:view"],
  ceo: ["reports:company:view"]
};

export function can(role: AppRole, permission: Permission): boolean {
  return rolePermissions[role].includes(permission);
}
