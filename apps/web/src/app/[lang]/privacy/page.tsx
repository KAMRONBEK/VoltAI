import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { defaultLocale, toLocale } from "@/i18n/config";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";

type Props = {
  // Next 16: route params arrive as a Promise and must be awaited — reading them
  // synchronously yields undefined, which silently fell back to the default locale.
  params: Promise<{ lang: string }>;
};

const supportEmail = "support@voltai.uz";

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { lang: raw } = await params;
  const lang = toLocale(raw) ?? defaultLocale;
  const t = getDictionary(lang);
  return {
    title: t.legal.privacy.title,
    description: t.legal.privacy.description,
    alternates: {
      canonical: `/${lang}/privacy`,
      languages: {
        uz: "/uz/privacy",
        ru: "/ru/privacy",
        en: "/en/privacy",
      },
    },
  };
}

export default async function PrivacyByLang({ params }: Props) {
  const { lang: raw } = await params;
  const lang: Locale = toLocale(raw) ?? defaultLocale;
  const t = getDictionary(lang);

  return (
    <PageShell
      title={t.legal.privacy.title}
      description={t.legal.privacy.description}
      supportEmail={supportEmail}
      lang={lang}
      dict={t}
    >
      <p>
        {t.legal.effectiveDateLabel}:{" "}
        <span className="text-foreground/90">{t.legal.placeholderDate}</span>
      </p>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">{t.legal.overviewTitle}</h2>
        <p>{t.legal.overviewBody}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.privacy.infoCollectTitle}
        </h2>
        <p>{t.legal.privacy.infoCollectIntro}</p>
        <ul className="list-disc pl-5 space-y-1">
          {t.legal.privacy.infoCollectBullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">{t.legal.privacy.useTitle}</h2>
        <ul className="list-disc pl-5 space-y-1">
          {t.legal.privacy.useBullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.privacy.sharingTitle}
        </h2>
        <p>{t.legal.privacy.sharingIntro}</p>
        <ul className="list-disc pl-5 space-y-1">
          {t.legal.privacy.sharingBullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.privacy.retentionTitle}
        </h2>
        <p>{t.legal.privacy.retentionBody}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.privacy.choicesTitle}
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          {t.legal.privacy.choicesBullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">{t.legal.contactTitle}</h2>
        <p>
          {t.legal.contactBodyPrefix}{" "}
          <a
            className="text-foreground/90 underline decoration-border hover:text-foreground transition"
            href={`mailto:${supportEmail}`}
          >
            {supportEmail}
          </a>
          .
        </p>
      </section>
    </PageShell>
  );
}

