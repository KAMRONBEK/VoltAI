import Link from "next/link";
import { Container } from "@/components/Container";

type Props = {
  supportEmail: string;
};

export function SiteFooter({ supportEmail }: Props) {
  return (
    <footer className="mt-16 border-t border-border/70">
      <Container className="flex flex-col gap-6 py-10 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-muted">
          <div className="text-foreground font-medium">VoltAI</div>
          <div className="mt-1">
            Support:{" "}
            <a
              className="hover:text-foreground transition"
              href={`mailto:${supportEmail}`}
            >
              {supportEmail}
            </a>
          </div>
        </div>

        <div className="flex items-center gap-6 text-sm text-muted">
          <Link href="/privacy" className="hover:text-foreground transition">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-foreground transition">
            Terms of Service
          </Link>
        </div>
      </Container>
    </footer>
  );
}

