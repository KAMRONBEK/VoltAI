import Link from "next/link";
import { Container } from "@/components/Container";
import { VoltMark } from "@/components/VoltMark";
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
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/55 backdrop-blur">
      <Container className="flex h-16 items-center justify-between">
        <Link href={`/${lang}`} className="flex items-center gap-2">
          <VoltMark />
          <span className="text-sm font-semibold tracking-wide">VoltAI</span>
        </Link>

        <nav className="flex items-center gap-6 text-sm text-muted">
          <div className="hidden items-center gap-2 sm:flex">
            {locales.map((l) => (
              <Link
                key={l}
                href={`/${l}`}
                className={cx(
                  "rounded-full border border-transparent px-2 py-1 text-xs transition hover:text-foreground",
                  l === lang ? "border-border/70 bg-surface text-foreground" : ""
                )}
                aria-label={`Switch language to ${l}`}
              >
                {labels.languageShort[l]}
              </Link>
            ))}
          </div>
          <Link
            href={`/${lang}/privacy`}
            className="hover:text-foreground transition"
          >
            {labels.privacy}
          </Link>
          <Link
            href={`/${lang}/terms`}
            className="hover:text-foreground transition"
          >
            {labels.terms}
          </Link>
        </nav>
      </Container>
    </header>
  );
}

