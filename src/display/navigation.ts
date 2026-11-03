/**
 * Framework-free navigation model for the 320x240 display. The same table maps to LVGL screens:
 * tabs are root screens, sub-screens push onto a stack and have a back button.
 */
export type TabId = "home" | "temperature" | "ams" | "control" | "menu";
export type SubScreenId = "info" | "settings" | "notifications" | "fans" | "move" | "history";
export type ScreenId = TabId | SubScreenId;

export const TABS: readonly { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "temperature", label: "Temp" },
  { id: "ams", label: "AMS" },
  { id: "control", label: "Control" },
  { id: "menu", label: "More" },
];

export const SUB_SCREENS: Readonly<Record<SubScreenId, { title: string; parent: TabId }>> = {
  info: { title: "Printer info", parent: "menu" },
  settings: { title: "Settings", parent: "menu" },
  notifications: { title: "Notifications", parent: "menu" },
  fans: { title: "Fans", parent: "control" },
  move: { title: "Move axes", parent: "control" },
  history: { title: "Print history", parent: "menu" },
};

export interface NavState {
  screen: ScreenId;
  /** Screens to return to, most recent last. */
  stack: ScreenId[];
}

export const INITIAL_NAV: NavState = { screen: "home", stack: [] };

export function isTab(screen: ScreenId): screen is TabId {
  return TABS.some((t) => t.id === screen);
}

/** The tab highlighted in the bottom bar for any screen. */
export function activeTab(screen: ScreenId): TabId {
  return isTab(screen) ? screen : SUB_SCREENS[screen].parent;
}

export function navigate(nav: NavState, to: ScreenId): NavState {
  if (to === nav.screen) return nav;
  // Tabs are roots: selecting one clears the history.
  if (isTab(to)) return { screen: to, stack: [] };
  return { screen: to, stack: [...nav.stack, nav.screen] };
}

export function back(nav: NavState): NavState {
  const previous = nav.stack.at(-1);
  if (previous !== undefined) return { screen: previous, stack: nav.stack.slice(0, -1) };
  if (!isTab(nav.screen)) return { screen: SUB_SCREENS[nav.screen].parent, stack: [] };
  return nav.screen === "home" ? nav : { screen: "home", stack: [] };
}
