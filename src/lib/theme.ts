export type ThemeChoice = "system" | "light" | "dark";

const KEY = "gocash-theme";

export function readTheme(): ThemeChoice {
  if (typeof window === "undefined") return "system";
  const v = window.localStorage.getItem(KEY);
  return v === "light" || v === "dark" ? v : "system";
}

export function applyTheme(choice: ThemeChoice) {
  const dark =
    choice === "dark" ||
    (choice === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0e1626" : "#f5f6f2");
}

export function saveTheme(choice: ThemeChoice) {
  window.localStorage.setItem(KEY, choice);
  applyTheme(choice);
}
