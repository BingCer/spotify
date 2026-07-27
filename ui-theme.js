"use strict";

(function () {
  const STORAGE_KEY = "bingspoti.theme";
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const media = window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: light)")
    : null;

  function savedChoice() {
    const value = localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  }

  function resolvedTheme(choice) {
    if (choice === "light" || choice === "dark") return choice;
    return media && media.matches ? "light" : "dark";
  }

  function updateButtons(choice) {
    document.querySelectorAll("[data-theme-option]").forEach(function (button) {
      const selected = button.getAttribute("data-theme-option") === choice;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-pressed", selected ? "true" : "false");
    });
  }

  function applyTheme(choice) {
    const resolved = resolvedTheme(choice);
    document.documentElement.setAttribute("data-theme", resolved);
    document.documentElement.setAttribute("data-theme-choice", choice);
    if (themeColor) {
      themeColor.setAttribute("content", resolved === "light" ? "#f7f9ff" : "#111318");
    }
    updateButtons(choice);
  }

  function chooseTheme(choice) {
    if (choice === "auto") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, choice);
    applyTheme(choice);
  }

  applyTheme(savedChoice());

  document.addEventListener("DOMContentLoaded", function () {
    updateButtons(savedChoice());
    document.querySelectorAll("[data-theme-option]").forEach(function (button) {
      button.addEventListener("click", function () {
        chooseTheme(button.getAttribute("data-theme-option"));
      });
    });
  });

  function systemThemeChanged() {
    if (savedChoice() === "auto") applyTheme("auto");
  }

  if (media) {
    if (media.addEventListener) media.addEventListener("change", systemThemeChanged);
    else if (media.addListener) media.addListener(systemThemeChanged);
  }
})();
