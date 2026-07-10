import { StatusBar } from "expo-status-bar";
import { StyleSheet, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { LoadingScreen } from "./components/LoadingScreen";
import { AppNavigator } from "./navigation/AppNavigator";
import { SalesProvider, useSales } from "./state/SalesContext";
import { colors } from "./theme";

function AppContent() {
  const { isHydrated } = useSales();

  return (
    <View style={styles.app}>
      <StatusBar backgroundColor={colors.background} style="dark" />
      {isHydrated ? <AppNavigator /> : <LoadingScreen />}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <SalesProvider>
        <AppContent />
      </SalesProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  app: { backgroundColor: colors.background, flex: 1 }
});
