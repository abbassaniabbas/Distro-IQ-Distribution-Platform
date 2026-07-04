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
      name: "Golden Grain Rice 25kg",
      category: "Staples",
      warehouse: "Abuja DC",
      region: "North Central",
      stock: 1840,
      reorderPoint: 750,
      dailyVelocity: 122,
      unitCost: 24000,
      unitPrice: 29200
    },
    {
      id: "SKU-1002",
      name: "Sunrise Tomato Paste 400g",
      category: "Pantry",
      warehouse: "Lagos Hub",
      region: "South West",
      stock: 940,
      reorderPoint: 1200,
      dailyVelocity: 188,
      unitCost: 780,
      unitPrice: 1050
    },
    {
      id: "SKU-1003",
      name: "BlueSeal Detergent 1kg",
      category: "Household",
      warehouse: "Kano Depot",
      region: "North West",
      stock: 1520,
      reorderPoint: 650,
      dailyVelocity: 84,
      unitCost: 1850,
      unitPrice: 2450
    },
    {
      id: "SKU-1004",
      name: "Peakline Cooking Oil 5L",
      category: "Pantry",
      warehouse: "Port Harcourt DC",
      region: "South South",
      stock: 420,
      reorderPoint: 600,
      dailyVelocity: 73,
      unitCost: 8200,
      unitPrice: 9800
    },
    {
      id: "SKU-1005",
      name: "FreshDrop Bottled Water 75cl",
      category: "Beverage",
      warehouse: "Lagos Hub",
      region: "South West",
      stock: 7200,
      reorderPoint: 2500,
      dailyVelocity: 410,
      unitCost: 130,
      unitPrice: 190
    },
    {
      id: "SKU-1006",
      name: "Cedar Baby Wipes 80ct",
      category: "Personal Care",
      warehouse: "Abuja DC",
      region: "North Central",
      stock: 680,
      reorderPoint: 900,
      dailyVelocity: 92,
      unitCost: 980,
      unitPrice: 1350
    }
  ],
  retailers: [
    {
      id: "RTL-101",
      name: "Mabushi Market Square",
      city: "Abuja",
      region: "North Central",
      tier: "Gold",
      channel: "Open Market",
      contact: "Aisha Bello",
      fillRate: 96,
      outstanding: 1580000,
      lastOrder: "2026-07-03",
      lastContact: "2026-07-01"
    },
    {
      id: "RTL-102",
      name: "Lekki Everyday Mart",
      city: "Lagos",
      region: "South West",
      tier: "Platinum",
      channel: "Modern Trade",
      contact: "Tunde Cole",
      fillRate: 93,
      outstanding: 2450000,
      lastOrder: "2026-07-04",
      lastContact: "2026-07-02"
    },
    {
      id: "RTL-103",
      name: "Kofar Ruwa Wholesale",
      city: "Kano",
      region: "North West",
      tier: "Silver",
      channel: "Wholesale",
      contact: "Musa Garba",
      fillRate: 88,
      outstanding: 920000,
      lastOrder: "2026-07-02",
      lastContact: "2026-06-30"
    },
    {
      id: "RTL-104",
      name: "Rumuola Family Store",
      city: "Port Harcourt",
      region: "South South",
      tier: "Gold",
      channel: "Neighborhood",
      contact: "Ifeoma Nwosu",
      fillRate: 90,
      outstanding: 710000,
      lastOrder: "2026-07-01",
      lastContact: "2026-07-03"
    },
    {
      id: "RTL-105",
      name: "Garki Mini Mart",
      city: "Abuja",
      region: "North Central",
      tier: "Bronze",
      channel: "Neighborhood",
      contact: "Daniel Okafor",
      fillRate: 82,
      outstanding: 360000,
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
        { productId: "SKU-1001", quantity: 42 },
        { productId: "SKU-1006", quantity: 90 }
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
        { productId: "SKU-1002", quantity: 320 },
        { productId: "SKU-1005", quantity: 1200 }
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
        { productId: "SKU-1003", quantity: 180 },
        { productId: "SKU-1001", quantity: 26 }
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
        { productId: "SKU-1004", quantity: 58 },
        { productId: "SKU-1002", quantity: 150 }
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
        { productId: "SKU-1005", quantity: 600 },
        { productId: "SKU-1006", quantity: 50 }
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
        { productId: "SKU-1001", quantity: 36 },
        { productId: "SKU-1004", quantity: 20 }
      ]
    }
  ],
  routes: [
    {
      id: "RTE-201",
      name: "Lagos Island Loop",
      driver: "Chika Eze",
      vehicle: "LAG-284KD",
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
      name: "Abuja Central Run",
      driver: "Sani Musa",
      vehicle: "ABJ-771XR",
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
      name: "Port Harcourt East",
      driver: "Grace Udo",
      vehicle: "PHC-449QM",
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
      name: "Kano Wholesale Belt",
      driver: "Bala Adamu",
      vehicle: "KAN-092LT",
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
      amount: 1580000,
      status: "pending",
      issuedAt: "2026-06-27",
      dueAt: "2026-07-07"
    },
    {
      id: "INV-9002",
      retailerId: "RTL-102",
      amount: 2450000,
      status: "pending",
      issuedAt: "2026-06-24",
      dueAt: "2026-07-04"
    },
    {
      id: "INV-9003",
      retailerId: "RTL-103",
      amount: 920000,
      status: "overdue",
      issuedAt: "2026-06-12",
      dueAt: "2026-06-30"
    },
    {
      id: "INV-9004",
      retailerId: "RTL-104",
      amount: 710000,
      status: "paid",
      issuedAt: "2026-06-20",
      dueAt: "2026-07-01"
    },
    {
      id: "INV-9005",
      retailerId: "RTL-105",
      amount: 360000,
      status: "pending",
      issuedAt: "2026-06-30",
      dueAt: "2026-07-10"
    }
  ]
};

export default seedData;
