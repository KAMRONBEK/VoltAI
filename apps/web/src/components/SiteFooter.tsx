import Link from "next/link";
import { Container } from "@/components/Container";
import { VoltMark } from "@/components/VoltMark";
import { VoltWordmark } from "@/components/VoltWordmark";
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
    <footer className="mt-16 border-t border-border">
      <Container className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted">
          <div className="flex items-center gap-2.5">
            <VoltMark />
            <VoltWordmark className="text-base" />
          </div>
          <div className="mt-2">
            {labels.supportLabel}:{" "}
            <a className="transition hover:text-foreground" href={`mailto:${supportEmail}`}>
              {supportEmail}
            </a>
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm text-muted">
          <Link href={`/${lang}/privacy`} className="transition hover:text-foreground">
            {labels.privacyPolicy}
          </Link>
          <Link href={`/${lang}/terms`} className="transition hover:text-foreground">
            {labels.termsOfService}
          </Link>
        </div>
      </Container>
    </footer>
  );
}
