import type { Metadata } from "next";
import Image from "next/image";
import { AppButton } from "@/components/AppButton";
import { Container } from "@/components/Container";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import { VoltWordmark } from "@/components/VoltWordmark";
import { defaultLocale, toLocale } from "@/i18n/config";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";

type Props = {
  // Next 16: route params arrive as a Promise and must be awaited — reading them
  // synchronously yields undefined, which silently fell back to the default locale.
  params: Promise<{ lang: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang: raw } = await params;
  const lang = toLocale(raw) ?? defaultLocale;
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

/** The three store screenshots shipped in /public/screens, in display order. */
const SCREENS = ["map", "details", "planner"] as const;
const SCREEN_FILES: Record<(typeof SCREENS)[number], string> = {
  map: "/screens/map.webp",
  details: "/screens/station.webp",
  planner: "/screens/plan.webp",
};

export default async function HomeByLang({ params }: Props) {
  // Avoid redirect loops in edge/cached scenarios; fall back to default.
  const { lang: raw } = await params;
  const lang: Locale = toLocale(raw) ?? defaultLocale;
  const t = getDictionary(lang);

  const supportEmail = "support@voltai.uz";
  const storeLinks = {
    googlePlay: undefined as string | undefined,
    appStore: undefined as string | undefined,
  };

  const faq = t.faq.map((item, idx) =>
    idx === 2 ? { ...item, a: `${item.a} ${supportEmail}.` } : item
  );

  const quickCards = [
    { title: t.quickCards.searchTitle, body: t.quickCards.searchBody },
    { title: t.quickCards.filterTitle, body: t.quickCards.filterBody },
    { title: t.quickCards.navigateTitle, body: t.quickCards.navigateBody },
    { title: t.quickCards.saveTitle, body: t.quickCards.saveBody },
  ];

  return (
    <div className="min-h-screen">
      <SiteHeader lang={lang} labels={{ ...t.nav, languageShort: t.languageShort }} />

      <main>
        {/* Hero — the app's map screenshot carries it, the way the store listing does. */}
        <section className="py-14 sm:py-20">
          <Container>
            <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
              <div>
                <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-muted">
                  <span className="volt-charge-dot h-1.5 w-1.5 rounded-full bg-status-available" />
                  {t.hero.badge}
                </div>

                <h1 className="mt-6 text-4xl font-semibold leading-[1.08] tracking-tight sm:text-6xl">
                  {t.hero.title}
                </h1>
                <p className="mt-5 max-w-xl text-base leading-7 text-muted sm:text-lg">
                  {t.hero.subtitle}
                </p>

                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <AppButton
                    href={storeLinks.googlePlay}
                    disabled={!storeLinks.googlePlay}
                    hint={t.hero.comingSoon}
                    ariaLabel={`${t.hero.ctaGooglePlay} ${t.hero.comingSoon}`}
                  >
                    {t.hero.ctaGooglePlay}
                  </AppButton>
                  <AppButton
                    href={storeLinks.appStore}
                    disabled={!storeLinks.appStore}
                    variant="secondary"
                    hint={t.hero.comingSoon}
                    ariaLabel={`${t.hero.ctaAppStore} ${t.hero.comingSoon}`}
                  >
                    {t.hero.ctaAppStore}
                  </AppButton>
                </div>

                <div className="mt-6 text-sm text-muted">
                  {t.hero.needHelp}{" "}
                  <a
                    className="text-foreground underline decoration-border underline-offset-4 transition hover:decoration-accent"
                    href={`mailto:${supportEmail}`}
                  >
                    {supportEmail}
                  </a>
                </div>
              </div>

              <div className="relative mx-auto w-full max-w-[320px] lg:max-w-[360px]">
                {/* The icon's bloom, behind the phone. */}
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute -inset-10 -z-10 rounded-full opacity-70 blur-3xl"
                  style={{
                    background:
                      "radial-gradient(circle at 50% 40%, rgba(47,226,138,0.20), transparent 65%)",
                  }}
                />
                <div className="app-phone">
                  <Image
                    src={SCREEN_FILES.map}
                    alt={t.screenshotLabels.map}
                    width={640}
                    height={1385}
                    priority
                  />
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* Quick cards */}
        <section className="py-8 sm:py-10">
          <Container>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {quickCards.map((card) => (
                <div key={card.title} className="app-card rounded-2xl p-5">
                  <div className="text-sm font-semibold">{card.title}</div>
                  <div className="mt-1.5 text-sm leading-6 text-muted">{card.body}</div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        <section className="py-10 sm:py-16">
          <Container>
            <div className="app-eyebrow">{t.sections.whyTitle}</div>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-4xl">
              {t.sections.whySubtitle}
            </h2>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {t.features.map((f) => (
                <div key={f.title} className="app-card rounded-2xl p-6">
                  <div className="text-base font-semibold">{f.title}</div>
                  <div className="mt-2 text-sm leading-6 text-muted">{f.body}</div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        {/* Screenshots — the real store assets, no longer empty frames. */}
        <section className="py-10 sm:py-16">
          <Container>
            <div className="app-eyebrow">{t.sections.screenshotsTitle}</div>
            <h2 className="mt-3 max-w-2xl text-2xl font-semibold tracking-tight sm:text-4xl">
              {t.sections.screenshotsSubtitle}
            </h2>

            <div className="mt-10 grid gap-8 sm:grid-cols-3">
              {SCREENS.map((key) => (
                <figure key={key} className="mx-auto w-full max-w-[300px]">
                  <div className="app-phone">
                    <Image
                      src={SCREEN_FILES[key]}
                      alt={t.screenshotLabels[key]}
                      width={640}
                      height={1385}
                    />
                  </div>
                  <figcaption className="mt-3 text-center text-sm text-muted">
                    {t.screenshotLabels[key]}
                  </figcaption>
                </figure>
              ))}
            </div>
          </Container>
        </section>

        <section className="py-10 sm:py-16">
          <Container>
            <div className="app-eyebrow">{t.sections.faqTitle}</div>
            <div className="mt-6 grid gap-3">
              {faq.map((item) => (
                <details key={item.q} className="app-card app-faq rounded-2xl px-6 py-4">
                  <summary className="flex cursor-pointer select-none list-none items-center justify-between gap-4 text-sm font-semibold">
                    {item.q}
                  </summary>
                  <div className="mt-3 text-sm leading-6 text-muted">{item.a}</div>
                </details>
              ))}
            </div>
          </Container>
        </section>

        {/* Closing band — the wordmark, once, at full size. */}
        <section className="py-10 sm:py-16">
          <Container>
            <div className="app-card flex flex-col items-center gap-5 rounded-3xl px-6 py-12 text-center">
              <VoltWordmark className="text-3xl sm:text-4xl" />
              <p className="max-w-md text-sm leading-6 text-muted">{t.hero.subtitle}</p>
              <div className="flex flex-col gap-3 sm:flex-row">
                <AppButton
                  href={storeLinks.googlePlay}
                  disabled={!storeLinks.googlePlay}
                  hint={t.hero.comingSoon}
                  ariaLabel={`${t.hero.ctaGooglePlay} ${t.hero.comingSoon}`}
                >
                  {t.hero.ctaGooglePlay}
                </AppButton>
                <AppButton
                  href={storeLinks.appStore}
                  disabled={!storeLinks.appStore}
                  variant="secondary"
                  hint={t.hero.comingSoon}
                  ariaLabel={`${t.hero.ctaAppStore} ${t.hero.comingSoon}`}
                >
                  {t.hero.ctaAppStore}
                </AppButton>
              </div>
            </div>
          </Container>
        </section>
      </main>

      <SiteFooter supportEmail={supportEmail} lang={lang} labels={t.footer} />
    </div>
  );
}
