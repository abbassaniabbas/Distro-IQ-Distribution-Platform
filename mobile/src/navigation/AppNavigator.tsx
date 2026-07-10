import { Ionicons } from "@expo/vector-icons";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer, type Theme } from "@react-navigation/native";

import { can } from "../auth/permissions";
import { SalesRepDashboardScreen } from "../screens/SalesRepDashboardScreen";
import { NewSaleScreen } from "../screens/NewSaleScreen";
import { useSales } from "../state/SalesContext";
import { colors, typography } from "../theme";
import type { SalesTabsParamList } from "./types";

const Tabs = createBottomTabNavigator<SalesTabsParamList>();

const navigationTheme: Theme = {
  dark: false,
  colors: {
    primary: colors.green,
    background: colors.background,
    card: colors.surface,
    text: colors.text,
    border: colors.border,
    notification: colors.greenBright
  },
  fonts: {
    regular: { fontFamily: "System", fontWeight: "400" },
    medium: { fontFamily: "System", fontWeight: "600" },
    bold: { fontFamily: "System", fontWeight: "700" },
    heavy: { fontFamily: "System", fontWeight: "900" }
  }
};

export function AppNavigator() {
  const { user } = useSales();

  return (
    <NavigationContainer theme={navigationTheme}>
      <Tabs.Navigator
        initialRouteName="Today"
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.green,
          tabBarInactiveTintColor: colors.textMuted,
          tabBarHideOnKeyboard: true,
          tabBarIcon: ({ color, focused, size }) => (
            <Ionicons
              color={color}
              name={route.name === "Today" ? (focused ? "today" : "today-outline") : (focused ? "add-circle" : "add-circle-outline")}
              size={route.name === "NewSale" ? size + 3 : size}
            />
          ),
          tabBarLabelStyle: {
            fontSize: typography.caption,
            fontWeight: "700",
            marginBottom: 3
          },
          tabBarStyle: {
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            height: 64,
            paddingTop: 5
          }
        })}
      >
        <Tabs.Screen component={SalesRepDashboardScreen} name="Today" />
        {can(user.role, "sales:create") ? (
          <Tabs.Screen component={NewSaleScreen} name="NewSale" options={{ title: "Sell" }} />
        ) : null}
      </Tabs.Navigator>
    </NavigationContainer>
  );
}
