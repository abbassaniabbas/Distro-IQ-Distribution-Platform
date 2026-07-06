const seedData = {
  client: null,
  accounts: [],
  invites: [],
  activityLogs: [],
  salesReports: [
    {
      id: "RPT-4101",
      clientId: "",
      repName: "Chika Eze",
      reportDate: "2026-07-05",
      tripLabel: "Lagos Rep Run",
      salesAmount: 74800,
      cashAmount: 52800,
      creditAmount: 22000,
      returnAmount: 8800,
      unitsSold: 340,
      unitsReturned: 40,
      transactionIds: ["TXN-7003"],
      status: "submitted",
      submittedAt: "2026-07-05T16:40:00"
    },
    {
      id: "RPT-4102",
      clientId: "",
      repName: "Sani Musa",
      reportDate: "2026-07-05",
      tripLabel: "Abuja Rep Run",
      salesAmount: 126000,
      cashAmount: 0,
      creditAmount: 126000,
      returnAmount: 0,
      unitsSold: 420,
      unitsReturned: 0,
      transactionIds: ["TXN-7001"],
      status: "submitted",
      submittedAt: "2026-07-05T17:05:00"
    }
  ],
  creditLimitHistory: [
    {
      id: "CLH-8001",
      creditLimitId: "CRD-5001",
      partyType: "Sales rep",
      partyName: "Chika Eze",
      previousLimit: 300000,
      nextLimit: 350000,
      changedBy: "Manager",
      reason: "Higher Lagos route volume",
      changedAt: "2026-07-01T09:20:00"
    },
    {
      id: "CLH-8002",
      creditLimitId: "CRD-5003",
      partyType: "Supermarket",
      partyName: "Lekki Family Mart",
      previousLimit: 450000,
      nextLimit: 500000,
      changedBy: "Manager",
      reason: "Approved supermarket account review",
      changedAt: "2026-06-30T13:40:00"
    }
  ],
  backend: {
    configured: false,
    status: "idle",
    error: ""
  },
  session: null,
  user: null,
  platformAdmin: false,
  platformOverview: [],
  stockCategories: [
    {
      id: "raw_materials",
      name: "Raw Materials",
      timeframe: "Factory-internal",
      behavior: "Supplier intake, production consumption, and reorder alerts before production is blocked."
    },
    {
      id: "finished_products",
      name: "Finished Products",
      timeframe: "Production to sale",
      behavior: "Produced from raw materials, held as available stock, issued to reps, or dispatched to customers."
    },
    {
      id: "equipment",
      name: "Equipment",
      timeframe: "Owned or for sale",
      behavior: "Tracked by status across in stock, assigned to a team member, or sold."
    }
  ],
  products: [
    {
      id: "SKU-1001",
      name: "Crunchy Plantain Chips 50g",
      category: "Finished Products",
      stockCategory: "finished_products",
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
      category: "Finished Products",
      stockCategory: "finished_products",
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
      category: "Finished Products",
      stockCategory: "finished_products",
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
      category: "Finished Products",
      stockCategory: "finished_products",
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
      category: "Finished Products",
      stockCategory: "finished_products",
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
      category: "Raw Materials",
      stockCategory: "raw_materials",
      warehouse: "Packaging Store",
      region: "Factory",
      stock: 680,
      reorderPoint: 900,
      dailyVelocity: 92,
      unitCost: 780,
      unitPrice: 0
    },
    {
      id: "SKU-1007",
      name: "Seasoning Premix 25kg",
      category: "Raw Materials",
      stockCategory: "raw_materials",
      warehouse: "Raw Materials Store",
      region: "Factory",
      stock: 126,
      reorderPoint: 80,
      dailyVelocity: 9,
      unitCost: 18500,
      unitPrice: 0
    },
    {
      id: "EQP-2001",
      name: "Digital Weighing Scale",
      category: "Equipment",
      stockCategory: "equipment",
      warehouse: "Equipment Cage",
      region: "Factory",
      stock: 14,
      reorderPoint: 5,
      dailyVelocity: 1,
      unitCost: 32000,
      unitPrice: 55000,
      equipmentStatus: "in_stock"
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
      paymentType: "credit",
      paymentStatus: "unpaid",
      deliveryNoteStatus: "pending",
      signatureStatus: "pending_signature",
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
      paymentType: "credit",
      paymentStatus: "unpaid",
      deliveryNoteStatus: "ready",
      signatureStatus: "pending_signature",
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
      paymentType: "credit",
      paymentStatus: "unpaid",
      deliveryNoteStatus: "printed",
      signatureStatus: "pending_signature",
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
      paymentType: "credit",
      paymentStatus: "unpaid",
      deliveryNoteStatus: "pending",
      signatureStatus: "pending_signature",
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
      paymentType: "credit",
      paymentStatus: "unpaid",
      deliveryNoteStatus: "printed",
      signatureStatus: "signed",
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
      paymentType: "cash",
      paymentStatus: "paid",
      deliveryNoteStatus: "pending",
      signatureStatus: "not_required",
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
  stockAssignments: [
    {
      id: "ASN-3001",
      routeId: "RTE-201",
      repName: "Chika Eze",
      productId: "SKU-1002",
      assignedAt: "2026-07-05",
      assigned: 600,
      sold: 340,
      returned: 40,
      status: "open"
    },
    {
      id: "ASN-3002",
      routeId: "RTE-202",
      repName: "Sani Musa",
      productId: "SKU-1001",
      assignedAt: "2026-07-05",
      assigned: 520,
      sold: 410,
      returned: 0,
      status: "open"
    },
    {
      id: "ASN-3003",
      routeId: "RTE-203",
      repName: "Grace Udo",
      productId: "SKU-1004",
      assignedAt: "2026-07-05",
      assigned: 360,
      sold: 260,
      returned: 24,
      status: "open"
    },
    {
      id: "ASN-3004",
      routeId: "RTE-204",
      repName: "Bala Adamu",
      productId: "SKU-1003",
      assignedAt: "2026-07-04",
      assigned: 420,
      sold: 390,
      returned: 30,
      status: "reconciled"
    }
  ],
  stockTransactions: [
    {
      id: "TXN-7001",
      type: "sale",
      productId: "SKU-1001",
      quantity: 420,
      amount: 126000,
      paymentType: "credit",
      partyType: "Supermarket",
      partyName: "Mabushi Supermarket",
      date: "2026-07-04",
      recordedBy: "Sani Musa",
      creditImpact: 126000
    },
    {
      id: "TXN-7002",
      type: "return",
      productId: "SKU-1004",
      quantity: 24,
      amount: 6720,
      paymentType: "credit adjustment",
      partyType: "Sales rep",
      partyName: "Grace Udo",
      date: "2026-07-04",
      recordedBy: "Grace Udo",
      creditImpact: -6720
    },
    {
      id: "TXN-7003",
      type: "supply",
      productId: "SKU-1005",
      quantity: 85,
      amount: 225250,
      paymentType: "cash",
      partyType: "Supermarket",
      partyName: "Lekki Family Mart",
      date: "2026-07-04",
      recordedBy: "Chika Eze",
      creditImpact: 0
    },
    {
      id: "TXN-7004",
      type: "internal movement",
      productId: "SKU-1006",
      quantity: 160,
      amount: 0,
      paymentType: "none",
      partyType: "Internal location",
      partyName: "Packaging Store to Production Line 2",
      date: "2026-07-05",
      recordedBy: "Store Keeper",
      creditImpact: 0
    }
  ],
  creditLimits: [
    {
      id: "CRD-5001",
      partyType: "Sales rep",
      partyName: "Chika Eze",
      limit: 350000,
      balance: 218000,
      previousLimit: 300000,
      changedBy: "Manager",
      changedAt: "2026-07-01T09:20:00"
    },
    {
      id: "CRD-5002",
      partyType: "Sales rep",
      partyName: "Sani Musa",
      limit: 300000,
      balance: 246000,
      previousLimit: 250000,
      changedBy: "Manager",
      changedAt: "2026-07-02T10:05:00"
    },
    {
      id: "CRD-5003",
      partyType: "Supermarket",
      partyName: "Lekki Family Mart",
      limit: 500000,
      balance: 245000,
      previousLimit: 450000,
      changedBy: "Manager",
      changedAt: "2026-06-30T13:40:00"
    },
    {
      id: "CRD-5004",
      partyType: "Supermarket",
      partyName: "Kofar Ruwa Snack Wholesale",
      limit: 120000,
      balance: 92000,
      previousLimit: 100000,
      changedBy: "Manager",
      changedAt: "2026-06-28T15:30:00"
    },
    {
      id: "CRD-5005",
      partyType: "Supermarket",
      partyName: "Mabushi Supermarket",
      limit: 400000,
      balance: 158000,
      previousLimit: 350000,
      changedBy: "Manager",
      changedAt: "2026-07-01T11:15:00"
    },
    {
      id: "CRD-5006",
      partyType: "Supermarket",
      partyName: "Rumuola Corner Store",
      limit: 180000,
      balance: 71000,
      previousLimit: 160000,
      changedBy: "Manager",
      changedAt: "2026-06-29T12:05:00"
    },
    {
      id: "CRD-5007",
      partyType: "Supermarket",
      partyName: "Garki School Kiosk",
      limit: 100000,
      balance: 36000,
      previousLimit: 90000,
      changedBy: "Manager",
      changedAt: "2026-06-29T09:45:00"
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
