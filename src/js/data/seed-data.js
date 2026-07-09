const seedData = {
  client: null,
  accounts: [],
  invites: [],
  messages: [],
  notificationReadAt: "",
  activityLogs: [],
  salesReports: [],
  creditLimitHistory: [],
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
      behavior: "Produced from raw materials, held as available stock, issued to representatives, or dispatched to customers."
    },
    {
      id: "equipment",
      name: "Equipment",
      timeframe: "Owned or for sale",
      behavior: "Tracked by status across in stock, assigned to a team member, or sold."
    }
  ],
  products: [],
  retailers: [],
  orders: [],
  routes: [],
  stockAssignments: [],
  stockTransactions: [],
  creditLimits: [],
  invoices: []
};

export default seedData;
