import { useEffect, useState } from "preact/hooks";

export type Theme = "light" | "dark";
const KEY = "recipe-nutrition:theme";

function savedTheme(): Theme | null {
  try {
    const t = localStorage.getItem(KEY);
    return t === "light" || t === "dark" ? t : null;
  } catch {
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
}

/** Header switch. Follows the system until the user chooses; the choice is remembered. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => savedTheme() ?? systemTheme());

  // While the user hasn't chosen, track system changes (e.g. automatic dark mode at night).
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const onChange = () => {
      if (!savedTheme()) setTheme(systemTheme());
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    apply(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      /* not persisted; still applies for this visit */
    }
    setTheme(next);
  }

  const toLight = theme === "dark";
  return (
    <button
      type="button"
      class="theme-toggle"
      onClick={toggle}
      aria-label={toLight ? "Switch to light theme" : "Switch to dark theme"}
      title={toLight ? "Switch to light theme" : "Switch to dark theme"}
    >
      {toLight ? (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        </svg>
      )}
      {toLight ? "Light" : "Dark"}
    </button>
  );
}
