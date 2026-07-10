import NetInfo from "@react-native-community/netinfo";
import {
  createContext,
  type PropsWithChildren,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState
} from "react";

import {
  sampleAssignedStock,
  sampleCustomers,
  sampleProducts,
  sampleSales,
  sampleUser
} from "../data/sampleData";
import { loadWorkspace, saveWorkspace } from "../services/storage";
import { sampleSalesSyncGateway } from "../services/sync";
import type { AssignedStock, Customer, Product, Sale, SaleDraft } from "../types/domain";

interface SalesState {
  assignedStock: AssignedStock[];
  customers: Customer[];
  sales: Sale[];
}

type SalesAction =
  | { type: "HYDRATE"; payload: SalesState }
  | { type: "CREATE_SALE"; sale: Sale }
  | { type: "SET_SYNC_STATUS"; saleId: string; status: Sale["syncStatus"] };

interface SalesContextValue extends SalesState {
  user: typeof sampleUser;
  products: Product[];
  isHydrated: boolean;
  isOnline: boolean;
  pendingSyncCount: number;
  createSale(draft: SaleDraft): Promise<Sale>;
  syncPendingSales(): Promise<void>;
}

const initialState: SalesState = {
  assignedStock: sampleAssignedStock,
  customers: sampleCustomers,
  sales: sampleSales
};

function reducer(state: SalesState, action: SalesAction): SalesState {
  if (action.type === "HYDRATE") return action.payload;

  if (action.type === "CREATE_SALE") {
    const soldByProduct = new Map(
      action.sale.lines.map((line) => [line.productId, line.quantity])
    );

    return {
      ...state,
      assignedStock: state.assignedStock.map((assignment) => ({
        ...assignment,
        availableQuantity: Math.max(
          0,
          assignment.availableQuantity - (soldByProduct.get(assignment.productId) ?? 0)
        )
      })),
      customers: state.customers.map((customer) => (
        customer.id === action.sale.customerId && action.sale.paymentMethod === "credit"
          ? { ...customer, creditBalance: customer.creditBalance + action.sale.total }
          : customer
      )),
      sales: [action.sale, ...state.sales]
    };
  }

  if (action.type === "SET_SYNC_STATUS") {
    return {
      ...state,
      sales: state.sales.map((sale) => (
        sale.id === action.saleId ? { ...sale, syncStatus: action.status } : sale
      ))
    };
  }

  return state;
}

const SalesContext = createContext<SalesContextValue | null>(null);

export function SalesProvider({ children }: PropsWithChildren) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    let mounted = true;

    loadWorkspace()
      .then((workspace) => {
        if (mounted && workspace) dispatch({ type: "HYDRATE", payload: workspace });
      })
      .finally(() => {
        if (mounted) setIsHydrated(true);
      });

    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    saveWorkspace(state).catch(() => undefined);
  }, [isHydrated, state]);

  useEffect(() => NetInfo.addEventListener((network) => {
    setIsOnline(Boolean(network.isConnected && network.isInternetReachable !== false));
  }), []);

  const syncSale = useCallback(async (sale: Sale) => {
    dispatch({ type: "SET_SYNC_STATUS", saleId: sale.id, status: "syncing" });

    try {
      await sampleSalesSyncGateway.pushSale(sale);
      dispatch({ type: "SET_SYNC_STATUS", saleId: sale.id, status: "synced" });
    } catch {
      dispatch({ type: "SET_SYNC_STATUS", saleId: sale.id, status: "failed" });
    }
  }, []);

  const createSale = useCallback(async (draft: SaleDraft) => {
    const customer = stateRef.current.customers.find((item) => item.id === draft.customerId);
    if (!customer) throw new Error("Customer not found.");

    const sale: Sale = {
      id: `SALE-${Date.now().toString().slice(-8)}`,
      tenantId: sampleUser.tenantId,
      representativeId: sampleUser.id,
      customerId: customer.id,
      customerName: customer.name,
      lines: draft.lines,
      paymentMethod: draft.paymentMethod,
      total: draft.lines.reduce((total, line) => total + line.lineTotal, 0),
      notes: draft.notes?.trim() || undefined,
      createdAt: new Date().toISOString(),
      syncStatus: isOnline ? "syncing" : "pending"
    };

    dispatch({ type: "CREATE_SALE", sale });
    if (isOnline) await syncSale(sale);

    return sale;
  }, [isOnline, syncSale]);

  const syncPendingSales = useCallback(async () => {
    if (!isOnline) return;

    const pending = stateRef.current.sales.filter((sale) => (
      sale.syncStatus === "pending" || sale.syncStatus === "failed"
    ));

    for (const sale of pending) {
      await syncSale(sale);
    }
  }, [isOnline, syncSale]);

  useEffect(() => {
    if (isOnline && isHydrated) syncPendingSales().catch(() => undefined);
  }, [isHydrated, isOnline, syncPendingSales]);

  const value = useMemo<SalesContextValue>(() => ({
    ...state,
    user: sampleUser,
    products: sampleProducts,
    isHydrated,
    isOnline,
    pendingSyncCount: state.sales.filter((sale) => sale.syncStatus !== "synced").length,
    createSale,
    syncPendingSales
  }), [createSale, isHydrated, isOnline, state, syncPendingSales]);

  return <SalesContext.Provider value={value}>{children}</SalesContext.Provider>;
}

export function useSales(): SalesContextValue {
  const value = useContext(SalesContext);
  if (!value) throw new Error("useSales must be used inside SalesProvider.");
  return value;
}
