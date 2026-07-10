import AsyncStorage from "@react-native-async-storage/async-storage";

import type { AssignedStock, Customer, Sale } from "../types/domain";

const STORAGE_KEY = "distroiq.sales-rep.workspace.v1";

export interface PersistedWorkspace {
  assignedStock: AssignedStock[];
  customers: Customer[];
  sales: Sale[];
}

export async function loadWorkspace(): Promise<PersistedWorkspace | null> {
  const value = await AsyncStorage.getItem(STORAGE_KEY);
  if (!value) return null;

  try {
    return JSON.parse(value) as PersistedWorkspace;
  } catch {
    await AsyncStorage.removeItem(STORAGE_KEY);
    return null;
  }
}

export async function saveWorkspace(workspace: PersistedWorkspace): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}
