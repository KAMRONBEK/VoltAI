import Link from "next/link";
import { Container } from "@/components/Container";
import { VoltMark } from "@/components/VoltMark";
import { VoltWordmark } from "@/components/VoltWordmark";
import type { Locale } from "@/i18n/config";
import { locales } from "@/i18n/config";
import { cx } from "@/lib/cx";

type Props = {
  lang: Locale;
  labels: {
    privacy: string;
    terms: string;
    languageShort: Record<Locale, string>;
  };
};

export function SiteHeader({ lang, labels }: Props) {
  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <Container className="flex h-16 items-center justify-between gap-4">
        <Link href={`/${lang}`} className="flex items-center gap-2.5">
          <VoltMark />
          <VoltWordmark className="text-base" />
        </Link>

        <nav className="flex items-center gap-4 text-sm text-muted sm:gap-6">
          {/* The app's segmented control: a sunken track with the active item filled. */}
          <div className="hidden items-center gap-1 rounded-full border border-border bg-surface-sunken p-1 sm:flex">
            {locales.map((l) => (
              <Link
                key={l}
                href={`/${l}`}
                aria-current={l === lang ? "page" : undefined}
                className={cx(
                  "rounded-full px-2.5 py-1 text-xs font-medium transition",
                  l === lang
                    ? "bg-surface-2 text-foreground"
                    : "text-muted hover:text-foreground"
                )}
                aria-label={`Switch language to ${l}`}
              >
                {labels.languageShort[l]}
              </Link>
            ))}
          </div>
          <Link href={`/${lang}/privacy`} className="transition hover:text-foreground">
            {labels.privacy}
          </Link>
          <Link href={`/${lang}/terms`} className="transition hover:text-foreground">
            {labels.terms}
          </Link>
        </nav>
      </Container>
    </header>
  );
}
