import type { ReactNode } from "react";
import { Container } from "@/components/Container";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

type Props = {
  title: string;
  description?: string;
  children: ReactNode;
  supportEmail: string;
};

export function PageShell({ title, description, children, supportEmail }: Props) {
  return (
    <div className="min-h-screen">
      <SiteHeader />
      <main className="py-12 sm:py-16">
        <Container>
          <div className="neo-card rounded-3xl p-8 sm:p-10">
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
      <SiteFooter supportEmail={supportEmail} />
    </div>
  );
}

