import Link from "next/link";
import { Container } from "@/components/Container";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 border-b border-border/70 bg-background/55 backdrop-blur">
      <Container className="flex h-16 items-center justify-between">
        <Link href="/" className="flex items-center gap-2">
          <span className="neo-ring inline-flex h-8 w-8 items-center justify-center rounded-xl bg-surface">
            <span className="h-2.5 w-2.5 rounded-full bg-accent" />
          </span>
          <span className="text-sm font-semibold tracking-wide">VoltAI</span>
        </Link>

        <nav className="flex items-center gap-6 text-sm text-muted">
          <Link href="/privacy" className="hover:text-foreground transition">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-foreground transition">
            Terms
          </Link>
        </nav>
      </Container>
    </header>
  );
}

