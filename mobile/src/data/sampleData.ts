import type { AppUser, AssignedStock, Customer, Product, Sale } from "../types/domain";

const now = new Date();
const earlierToday = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();

export const sampleUser: AppUser = {
  id: "rep-amina",
  tenantId: "factory-sunrise",
  name: "Amina Yusuf",
  role: "sales_representative"
};

export const sampleProducts: Product[] = [
  {
    id: "prod-plantain-50",
    tenantId: "factory-sunrise",
    name: "Plantain Chips 50g",
    description: "Crisp lightly salted plantain chips.",
    unit: "pack",
    unitPrice: 500,
    category: "Finished products",
    isActive: true
  },
  {
    id: "prod-cheese-puffs",
    tenantId: "factory-sunrise",
    name: "Cheese Puffs 40g",
    description: "Crunchy cheese-flavoured corn puffs.",
    unit: "pack",
    unitPrice: 450,
    category: "Finished products",
    isActive: true
  },
  {
    id: "prod-spicy-sticks",
    tenantId: "factory-sunrise",
    name: "Spicy Sticks 60g",
    description: "Baked snack sticks with a mild pepper finish.",
    unit: "pack",
    unitPrice: 600,
    category: "Finished products",
    isActive: true
  }
];

export const sampleAssignedStock: AssignedStock[] = [
  {
    id: "assign-101",
    productId: "prod-plantain-50",
    representativeId: sampleUser.id,
    assignedQuantity: 60,
    availableQuantity: 42,
    assignedAt: earlierToday(5)
  },
  {
    id: "assign-102",
    productId: "prod-cheese-puffs",
    representativeId: sampleUser.id,
    assignedQuantity: 40,
    availableQuantity: 28,
    assignedAt: earlierToday(5)
  },
  {
    id: "assign-103",
    productId: "prod-spicy-sticks",
    representativeId: sampleUser.id,
    assignedQuantity: 36,
    availableQuantity: 30,
    assignedAt: earlierToday(5)
  }
];

export const sampleCustomers: Customer[] = [
  {
    id: "customer-walk-in",
    tenantId: "factory-sunrise",
    name: "Walk-in customer",
    type: "walk_in",
    creditLimit: 0,
    creditBalance: 0
  },
  {
    id: "customer-sahad",
    tenantId: "factory-sunrise",
    name: "Sahad Stores",
    type: "supermarket",
    phone: "0803 555 0182",
    address: "Gwarinpa, Abuja",
    creditLimit: 150000,
    creditBalance: 36000
  },
  {
    id: "customer-mama-tee",
    tenantId: "factory-sunrise",
    name: "Mama Tee Retail",
    type: "retailer",
    phone: "0806 211 9084",
    address: "Wuse 2, Abuja",
    creditLimit: 50000,
    creditBalance: 12500
  },
  {
    id: "customer-abc",
    tenantId: "factory-sunrise",
    name: "ABC Supermarket",
    type: "supermarket",
    phone: "0704 882 3411",
    address: "Jabi, Abuja",
    creditLimit: 200000,
    creditBalance: 42000
  }
];

export const sampleSales: Sale[] = [
  {
    id: "SALE-2401",
    tenantId: "factory-sunrise",
    representativeId: sampleUser.id,
    customerId: "customer-sahad",
    customerName: "Sahad Stores",
    lines: [
      {
        productId: "prod-plantain-50",
        productName: "Plantain Chips 50g",
        quantity: 12,
        unitPrice: 500,
        lineTotal: 6000
      }
    ],
    paymentMethod: "transfer",
    total: 6000,
    createdAt: earlierToday(2),
    syncStatus: "synced"
  },
  {
    id: "SALE-2402",
    tenantId: "factory-sunrise",
    representativeId: sampleUser.id,
    customerId: "customer-mama-tee",
    customerName: "Mama Tee Retail",
    lines: [
      {
        productId: "prod-cheese-puffs",
        productName: "Cheese Puffs 40g",
        quantity: 8,
        unitPrice: 450,
        lineTotal: 3600
      }
    ],
    paymentMethod: "cash",
    total: 3600,
    createdAt: earlierToday(1),
    syncStatus: "synced"
  }
];
