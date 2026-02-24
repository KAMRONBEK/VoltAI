import type { Metadata } from "next";
import { Container } from "@/components/Container";
import { NeoButton } from "@/components/NeoButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { defaultLocale, isLocale } from "@/i18n/config";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";

type Props = {
  params: { lang: string };
};

export function generateMetadata({ params }: Props): Metadata {
  const lang = isLocale(params.lang) ? params.lang : defaultLocale;
  const t = getDictionary(lang);
  return {
    title: "VoltAI",
    description: t.hero.subtitle,
    alternates: {
      canonical: `/${lang}`,
      languages: {
        uz: "/uz",
        ru: "/ru",
        en: "/en",
      },
    },
  };
}

export default function HomeByLang({ params }: Props) {
  // Avoid redirect loops in edge/cached scenarios; fall back to default.
  const lang: Locale = isLocale(params.lang) ? params.lang : defaultLocale;
  const t = getDictionary(lang);

  const supportEmail = "support@voltai.uz";
  const storeLinks = {
    googlePlay: undefined as string | undefined,
    appStore: undefined as string | undefined,
  };

  const faq = t.faq.map((item, idx) =>
    idx === 2 ? { ...item, a: `${item.a} ${supportEmail}.` } : item
  );

  return (
    <div className="min-h-screen">
      <SiteHeader
        lang={lang}
        labels={{ ...t.nav, languageShort: t.languageShort }}
      />

      <main>
        <section className="py-16 sm:py-24">
          <Container>
            <div className="neo-card rounded-3xl p-8 sm:p-12">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface px-3 py-1 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-2" />
                {t.hero.badge}
              </div>

              <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:items-center">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
                    {t.hero.title}
                  </h1>
                  <p className="mt-4 text-base leading-7 text-muted sm:text-lg">
                    {t.hero.subtitle}
                  </p>

                  <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                    <NeoButton
                      href={storeLinks.googlePlay}
                      disabled={!storeLinks.googlePlay}
                      ariaLabel={`${t.hero.ctaGooglePlay} ${t.hero.comingSoon}`}
                    >
                      {t.hero.ctaGooglePlay}
                      <span className="text-xs text-muted">{t.hero.comingSoon}</span>
                    </NeoButton>
                    <NeoButton
                      href={storeLinks.appStore}
                      disabled={!storeLinks.appStore}
                      variant="secondary"
                      ariaLabel={`${t.hero.ctaAppStore} ${t.hero.comingSoon}`}
                    >
                      {t.hero.ctaAppStore}
                      <span className="text-xs text-muted">{t.hero.comingSoon}</span>
                    </NeoButton>
                  </div>

                  <div className="mt-6 text-sm text-muted">
                    {t.hero.needHelp}{" "}
                    <a
                      className="text-foreground/90 underline decoration-border hover:text-foreground transition"
                      href={`mailto:${supportEmail}`}
                    >
                      {supportEmail}
                    </a>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="neo-card rounded-2xl p-5">
                    <div className="text-sm font-medium">{t.quickCards.searchTitle}</div>
                    <div className="mt-1 text-sm text-muted">{t.quickCards.searchBody}</div>
                  </div>
                  <div className="neo-card rounded-2xl p-5">
                    <div className="text-sm font-medium">{t.quickCards.filterTitle}</div>
                    <div className="mt-1 text-sm text-muted">{t.quickCards.filterBody}</div>
                  </div>
                  <div className="neo-card rounded-2xl p-5">
                    <div className="text-sm font-medium">{t.quickCards.navigateTitle}</div>
                    <div className="mt-1 text-sm text-muted">{t.quickCards.navigateBody}</div>
                  </div>
                  <div className="neo-card rounded-2xl p-5">
                    <div className="text-sm font-medium">{t.quickCards.saveTitle}</div>
                    <div className="mt-1 text-sm text-muted">{t.quickCards.saveBody}</div>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        <section className="py-10 sm:py-14">
          <Container>
            <div className="flex items-end justify-between gap-8">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  {t.sections.whyTitle}
                </h2>
                <p className="mt-2 text-sm text-muted sm:text-base">
                  {t.sections.whySubtitle}
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {t.features.map((f) => (
                <div key={f.title} className="neo-card rounded-2xl p-6">
                  <div className="text-base font-medium">{f.title}</div>
                  <div className="mt-2 text-sm leading-6 text-muted">{f.body}</div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        <section className="py-10 sm:py-14">
          <Container>
            <div className="neo-card rounded-3xl p-8 sm:p-10">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                {t.sections.screenshotsTitle}
              </h2>
              <p className="mt-2 text-sm text-muted sm:text-base">
                {t.sections.screenshotsSubtitle}
              </p>

              <div className="mt-7 grid gap-4 md:grid-cols-3">
                {[
                  t.screenshotLabels.search,
                  t.screenshotLabels.details,
                  t.screenshotLabels.filters,
                ].map((label) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-border/70 bg-surface p-4"
                  >
                    <div className="aspect-[9/16] rounded-xl bg-gradient-to-b from-white/10 to-transparent" />
                    <div className="mt-3 text-sm text-muted">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        <section className="py-10 sm:py-14">
          <Container>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {t.sections.faqTitle}
            </h2>
            <div className="mt-6 grid gap-3">
              {faq.map((item) => (
                <details key={item.q} className="neo-card rounded-2xl px-6 py-4">
                  <summary className="cursor-pointer select-none text-sm font-medium">
                    {item.q}
                  </summary>
                  <div className="mt-3 text-sm leading-6 text-muted">{item.a}</div>
                </details>
              ))}
            </div>
          </Container>
        </section>
      </main>

      <SiteFooter supportEmail={supportEmail} lang={lang} labels={t.footer} />
    </div>
  );
}

