import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://voltai.uz";
  const lastModified = new Date();

  const langs = ["uz", "ru", "en"] as const;

  const entries: MetadataRoute.Sitemap = [];

  for (const lang of langs) {
    entries.push({
      url: `${baseUrl}/${lang}`,
      lastModified,
      changeFrequency: "weekly",
      priority: lang === "uz" ? 1 : 0.8,
    });
    entries.push({
      url: `${baseUrl}/${lang}/privacy`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    });
    entries.push({
      url: `${baseUrl}/${lang}/terms`,
      lastModified,
      changeFrequency: "monthly",
      priority: 0.6,
    });
  }

  return entries;
}

