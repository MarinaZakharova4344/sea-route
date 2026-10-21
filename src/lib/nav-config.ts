import type { NavItem } from "@/components/nav";

export const MANAGER_NAV: NavItem[] = [{ href: "/manager", label: "Перевозки", icon: "ship", match: ["/manager"] }];

export const DIRECTOR_NAV: NavItem[] = [
  { href: "/director", label: "Сегодня", icon: "bell", match: ["/director", "/director/shipments", "/director/details"] },
  { href: "/director/profit", label: "Доходность", icon: "bars", match: ["/director/profit"] },
  { href: "/director/changes", label: "Динамика", icon: "trend", match: ["/director/changes"] },
];
