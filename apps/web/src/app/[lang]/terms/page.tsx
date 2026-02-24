import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";
import { defaultLocale, toLocale } from "@/i18n/config";
import type { Locale } from "@/i18n/config";
import { getDictionary } from "@/i18n/getDictionary";

type Props = {
  params: { lang: string };
};

const supportEmail = "support@voltai.uz";

export function generateMetadata({ params }: Props): Metadata {
  const lang = toLocale(params.lang) ?? defaultLocale;
  const t = getDictionary(lang);
  return {
    title: t.legal.terms.title,
    description: t.legal.terms.description,
    alternates: {
      canonical: `/${lang}/terms`,
      languages: {
        uz: "/uz/terms",
        ru: "/ru/terms",
        en: "/en/terms",
      },
    },
  };
}

export default function TermsByLang({ params }: Props) {
  const lang: Locale = toLocale(params.lang) ?? defaultLocale;
  const t = getDictionary(lang);

  return (
    <PageShell
      title={t.legal.terms.title}
      description={t.legal.terms.description}
      supportEmail={supportEmail}
      lang={lang}
      dict={t}
    >
      <p>
        {t.legal.effectiveDateLabel}:{" "}
        <span className="text-foreground/90">{t.legal.placeholderDate}</span>
      </p>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.terms.agreementTitle}
        </h2>
        <p>{t.legal.terms.agreementBody}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.terms.providesTitle}
        </h2>
        <p>{t.legal.terms.providesBody}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.terms.responsibilitiesTitle}
        </h2>
        <ul className="list-disc pl-5 space-y-1">
          {t.legal.terms.responsibilitiesBullets.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.terms.thirdPartyTitle}
        </h2>
        <p>{t.legal.terms.thirdPartyBody}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.terms.disclaimersTitle}
        </h2>
        <p>{t.legal.terms.disclaimersBody}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.terms.liabilityTitle}
        </h2>
        <p>{t.legal.terms.liabilityBody}</p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">
          {t.legal.terms.changesTitle}
        </h2>
        <p>{t.legal.terms.changesBody}</p>
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

