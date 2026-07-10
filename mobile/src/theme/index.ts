export const colors = {
  navy: "#0B1F3A",
  navySoft: "#173454",
  green: "#138A67",
  greenBright: "#19B985",
  greenSoft: "#E8F7F1",
  mint: "#7EE2B8",
  background: "#F5F8F7",
  surface: "#FFFFFF",
  surfaceMuted: "#EEF3F2",
  text: "#102235",
  textMuted: "#607080",
  border: "#DDE6E3",
  warning: "#A35D05",
  warningSoft: "#FFF3DA",
  danger: "#B42318",
  dangerSoft: "#FEECEB",
  info: "#1769AA",
  infoSoft: "#E8F3FC",
  white: "#FFFFFF",
  black: "#000000"
} as const;

export const spacing = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32
} as const;

export const radius = {
  sm: 4,
  md: 8,
  round: 999
} as const;

export const typography = {
  display: 28,
  title: 20,
  heading: 17,
  body: 15,
  label: 13,
  caption: 12
} as const;

export const shadow = {
  shadowColor: colors.navy,
  shadowOpacity: 0.06,
  shadowRadius: 10,
  shadowOffset: { width: 0, height: 4 },
  elevation: 2
} as const;
