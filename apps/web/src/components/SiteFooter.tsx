import Link from "next/link";
import { Container } from "@/components/Container";
import type { Locale } from "@/i18n/config";

type Props = {
  supportEmail: string;
  lang: Locale;
  labels: {
    supportLabel: string;
    privacyPolicy: string;
    termsOfService: string;
  };
};

export function SiteFooter({ supportEmail, lang, labels }: Props) {
  return (
    <footer className="mt-16 border-t border-border/70">
      <Container className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted">
          <div className="text-foreground font-medium">VoltAI</div>
          <div className="mt-1">
            {labels.supportLabel}:{" "}
            <a
              className="hover:text-foreground transition"
              href={`mailto:${supportEmail}`}
            >
              {supportEmail}
            </a>
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm text-muted">
          <Link
            href={`/${lang}/privacy`}
            className="hover:text-foreground transition"
          >
            {labels.privacyPolicy}
          </Link>
          <Link
            href={`/${lang}/terms`}
            className="hover:text-foreground transition"
          >
            {labels.termsOfService}
          </Link>
        </div>
      </Container>
    </footer>
  );
}

