
const root = document.documentElement;
const toggle = document.getElementById("themeToggle");

function getSavedTheme() {
  try {
    return localStorage.getItem("site-theme");
  } catch {
    return null;
  }
}

function saveTheme(theme) {
  try {
    localStorage.setItem("site-theme", theme);
  } catch {
    // Storage may be unavailable
  }
}

function getTheme() {
  const saved = getSavedTheme();

  if (saved === "light" || saved === "dark") {
    return saved;
  }

  return window.matchMedia(
    "(prefers-color-scheme: dark)"
  ).matches ? "dark" : "light";
}

function applyTheme(theme) {
  root.setAttribute("data-theme", theme);

  if (toggle) {
    toggle.textContent = theme === "dark"
      ? "☀️ Light Mode"
      : "🌙 Dark Mode";

    toggle.setAttribute(
      "aria-label",
      "Switch to " +
      (theme === "dark" ? "light" : "dark") +
      " mode"
    );
  }
}

// Apply the selected theme
applyTheme(getTheme());

// Handle button click
if (toggle) {
  toggle.addEventListener("click", () => {
    const current = root.getAttribute("data-theme");

    const next = current === "dark"
      ? "light"
      : "dark";

    saveTheme(next);
    applyTheme(next);
  });
}

// Sync theme across open tabs
window.addEventListener("storage", (event) => {
  if (event.key === "site-theme") {
    applyTheme(getTheme());
  }
});
