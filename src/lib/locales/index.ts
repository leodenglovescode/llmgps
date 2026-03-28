export { en, type Locale } from "./en";
export { zh } from "./zh";

export type Language = "auto" | "en" | "zh";

export function detectBrowserLocale(): "en" | "zh" {
  if (typeof navigator === "undefined") return "en";
  const lang = (navigator.language || "en").toLowerCase();
  return lang.startsWith("zh") ? "zh" : "en";
}

export function resolveLocale(language: Language): "en" | "zh" {
  if (language === "auto") return detectBrowserLocale();
  return language;
}
