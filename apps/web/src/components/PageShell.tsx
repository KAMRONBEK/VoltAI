import type { ReactNode } from "react";
import { Container } from "@/components/Container";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";
import type { Locale } from "@/i18n/config";
import type { Dictionary } from "@/i18n/dictionary";

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
  supportEmail: string;
  lang: Locale;
  dict: Pick<Dictionary, "nav" | "languageShort" | "footer">;
};

export function PageShell({
  title,
  description,
  children,
  supportEmail,
  lang,
  dict,
}: Props) {
  return (
    <div className="min-h-screen">
      <SiteHeader lang={lang} labels={{ ...dict.nav, languageShort: dict.languageShort }} />
      <main className="py-12 sm:py-16">
        <Container>
          <div className="app-card rounded-3xl p-8 sm:p-10">
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              {title}
            </h1>
            {description ? (
              <p className="mt-2 text-sm text-muted sm:text-base">{description}</p>
            ) : null}

            <div className="mt-8 space-y-6 text-sm leading-7 text-muted sm:text-base">
              {children}
            </div>
          </div>
        </Container>
      </main>
      <SiteFooter
        supportEmail={supportEmail}
        lang={lang}
        labels={dict.footer}
      />
    </div>
  );
}

