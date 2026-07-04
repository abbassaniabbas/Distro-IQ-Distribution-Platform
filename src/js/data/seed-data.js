const seedData = {
  client: null,
  accounts: [],
  invites: [],
  activityLogs: [],
  backend: {
    configured: false,
    status: "idle",
    error: ""
  },
  session: null,
  user: null,
  products: [
    {
      id: "SKU-1001",
      name: "Crunchy Plantain Chips 50g",
      category: "Finished snacks",
      warehouse: "Finished Goods Store",
      region: "Factory",
      stock: 1840,
      reorderPoint: 750,
      dailyVelocity: 122,
      unitCost: 180,
      unitPrice: 300
    },
    {
      id: "SKU-1002",
      name: "Cheese Corn Puffs 35g",
      category: "Finished snacks",
      warehouse: "Finished Goods Store",
      region: "Factory",
      stock: 940,
      reorderPoint: 1200,
      dailyVelocity: 188,
      unitCost: 120,
      unitPrice: 220
    },
    {
      id: "SKU-1003",
      name: "Sweet Chin Chin 100g",
      category: "Finished snacks",
      warehouse: "Finished Goods Store",
      region: "Factory",
      stock: 1520,
      reorderPoint: 650,
      dailyVelocity: 84,
      unitCost: 240,
      unitPrice: 420
    },
    {
      id: "SKU-1004",
      name: "Mini Butter Biscuits 75g",
      category: "Finished snacks",
      warehouse: "Finished Goods Store",
      region: "Factory",
      stock: 420,
      reorderPoint: 600,
      dailyVelocity: 73,
      unitCost: 160,
      unitPrice: 280
    },
    {
      id: "SKU-1005",
      name: "Potato Chips Multipack 12ct",
      category: "Finished snacks",
      warehouse: "Finished Goods Store",
      region: "Factory",
      stock: 7200,
      reorderPoint: 2500,
      dailyVelocity: 410,
      unitCost: 1850,
      unitPrice: 2650
    },
    {
      id: "SKU-1006",
      name: "Printed Snack Wrapper Rolls",
      category: "Packaging",
      warehouse: "Packaging Store",
      region: "Factory",
      stock: 680,
      reorderPoint: 900,
      dailyVelocity: 92,
      unitCost: 780,
      unitPrice: 0
    }
  ],
  retailers: [
    {
      id: "RTL-101",
      name: "Mabushi Supermarket",
      city: "Abuja",
      region: "North Central",
      tier: "Gold",
      channel: "Supermarket",
      contact: "Aisha Bello",
      fillRate: 96,
      outstanding: 158000,
      lastOrder: "2026-07-03",
      lastContact: "2026-07-01"
    },
    {
      id: "RTL-102",
      name: "Lekki Family Mart",
      city: "Lagos",
      region: "South West",
      tier: "Platinum",
      channel: "Modern Trade",
      contact: "Tunde Cole",
      fillRate: 93,
      outstanding: 245000,
      lastOrder: "2026-07-04",
      lastContact: "2026-07-02"
    },
    {
      id: "RTL-103",
      name: "Kofar Ruwa Snack Wholesale",
      city: "Kano",
      region: "North West",
      tier: "Silver",
      channel: "Wholesale",
      contact: "Musa Garba",
      fillRate: 88,
      outstanding: 92000,
      lastOrder: "2026-07-02",
      lastContact: "2026-06-30"
    },
    {
      id: "RTL-104",
      name: "Rumuola Corner Store",
      city: "Port Harcourt",
      region: "South South",
      tier: "Gold",
      channel: "Neighborhood",
      contact: "Ifeoma Nwosu",
      fillRate: 90,
      outstanding: 71000,
      lastOrder: "2026-07-01",
      lastContact: "2026-07-03"
    },
    {
      id: "RTL-105",
      name: "Garki School Kiosk",
      city: "Abuja",
      region: "North Central",
      tier: "Bronze",
      channel: "Kiosk",
      contact: "Daniel Okafor",
      fillRate: 82,
      outstanding: 36000,
      lastOrder: "2026-06-29",
      lastContact: "2026-06-28"
    }
  ],
  orders: [
    {
      id: "ORD-1001",
      retailerId: "RTL-101",
      region: "North Central",
      status: "processing",
      priority: "High",
      createdAt: "2026-07-04",
      dueAt: "2026-07-05",
      items: [
        { productId: "SKU-1001", quantity: 420 },
        { productId: "SKU-1003", quantity: 180 }
      ]
    },
    {
      id: "ORD-1002",
      retailerId: "RTL-102",
      region: "South West",
      status: "packed",
      priority: "High",
      createdAt: "2026-07-04",
      dueAt: "2026-07-04",
      items: [
        { productId: "SKU-1002", quantity: 540 },
        { productId: "SKU-1005", quantity: 85 }
      ]
    },
    {
      id: "ORD-1003",
      retailerId: "RTL-103",
      region: "North West",
      status: "in_transit",
      priority: "Normal",
      createdAt: "2026-07-03",
      dueAt: "2026-07-04",
      items: [
        { productId: "SKU-1003", quantity: 260 },
        { productId: "SKU-1001", quantity: 340 }
      ]
    },
    {
      id: "ORD-1004",
      retailerId: "RTL-104",
      region: "South South",
      status: "delayed",
      priority: "Urgent",
      createdAt: "2026-07-02",
      dueAt: "2026-07-03",
      items: [
        { productId: "SKU-1004", quantity: 360 },
        { productId: "SKU-1002", quantity: 240 }
      ]
    },
    {
      id: "ORD-1005",
      retailerId: "RTL-105",
      region: "North Central",
      status: "delivered",
      priority: "Normal",
      createdAt: "2026-07-01",
      dueAt: "2026-07-03",
      items: [
        { productId: "SKU-1005", quantity: 60 },
        { productId: "SKU-1003", quantity: 160 }
      ]
    },
    {
      id: "ORD-1006",
      retailerId: "RTL-102",
      region: "South West",
      status: "processing",
      priority: "Normal",
      createdAt: "2026-07-03",
      dueAt: "2026-07-06",
      items: [
        { productId: "SKU-1001", quantity: 300 },
        { productId: "SKU-1004", quantity: 120 }
      ]
    }
  ],
  routes: [
    {
      id: "RTE-201",
      name: "Lagos Rep Run",
      driver: "Chika Eze",
      vehicle: "Snack Van LAG-284KD",
      region: "South West",
      status: "scheduled",
      stops: 9,
      capacityUsed: 82,
      departure: "09:30",
      eta: "15:40",
      orderIds: ["ORD-1002", "ORD-1006"]
    },
    {
      id: "RTE-202",
      name: "Abuja Rep Run",
      driver: "Sani Musa",
      vehicle: "Snack Van ABJ-771XR",
      region: "North Central",
      status: "in_transit",
      stops: 7,
      capacityUsed: 76,
      departure: "08:10",
      eta: "14:15",
      orderIds: ["ORD-1001", "ORD-1005"]
    },
    {
      id: "RTE-203",
      name: "Port Harcourt Rep Run",
      driver: "Grace Udo",
      vehicle: "Snack Van PHC-449QM",
      region: "South South",
      status: "scheduled",
      stops: 6,
      capacityUsed: 64,
      departure: "11:00",
      eta: "17:20",
      orderIds: ["ORD-1004"]
    },
    {
      id: "RTE-204",
      name: "Kano Wholesale Rep Run",
      driver: "Bala Adamu",
      vehicle: "Snack Van KAN-092LT",
      region: "North West",
      status: "delivered",
      stops: 11,
      capacityUsed: 91,
      departure: "07:20",
      eta: "13:05",
      orderIds: ["ORD-1003"]
    }
  ],
  invoices: [
    {
      id: "INV-9001",
      retailerId: "RTL-101",
      amount: 158000,
      status: "pending",
      issuedAt: "2026-06-27",
      dueAt: "2026-07-07"
    },
    {
      id: "INV-9002",
      retailerId: "RTL-102",
      amount: 245000,
      status: "pending",
      issuedAt: "2026-06-24",
      dueAt: "2026-07-04"
    },
    {
      id: "INV-9003",
      retailerId: "RTL-103",
      amount: 92000,
      status: "overdue",
      issuedAt: "2026-06-12",
      dueAt: "2026-06-30"
    },
    {
      id: "INV-9004",
      retailerId: "RTL-104",
      amount: 71000,
      status: "paid",
      issuedAt: "2026-06-20",
      dueAt: "2026-07-01"
    },
    {
      id: "INV-9005",
      retailerId: "RTL-105",
      amount: 36000,
      status: "pending",
      issuedAt: "2026-06-30",
      dueAt: "2026-07-10"
    }
  ]
};

export default seedData;
