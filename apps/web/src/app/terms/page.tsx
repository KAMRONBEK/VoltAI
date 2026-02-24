import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";

const supportEmail = "support@voltai.uz";

export const metadata: Metadata = {
  title: "Terms of Service | VoltAI",
  description: "Terms of Service for the VoltAI app and website.",
};

export default function TermsPage() {
  return (
    <PageShell
      title="Terms of Service"
      description="Rules and conditions for using VoltAI."
      supportEmail={supportEmail}
    >
      <p>
        Effective date: <span className="text-foreground/90">[add date]</span>
      </p>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Agreement</h2>
        <p>
          By using the VoltAI app and website (the &ldquo;Services&rdquo;), you agree
          to these Terms of Service. If you do not agree, do not use the Services.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">What VoltAI provides</h2>
        <p>
          VoltAI helps you discover EV charging stations and related information. We
          do not own or operate charging stations unless explicitly stated.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">User responsibilities</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Use the Services lawfully and respectfully.</li>
          <li>
            Verify station details in real life (availability, pricing, connector
            compatibility).
          </li>
          <li>Do not attempt to disrupt, reverse engineer, or abuse the Services.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Third-party services</h2>
        <p>
          The Services may link to third-party websites or services (e.g. mapping
          providers). We are not responsible for third-party content, policies, or
          availability.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Disclaimers</h2>
        <p>
          The Services are provided on an &ldquo;as is&rdquo; and
          &ldquo;as available&rdquo; basis. Station data can change and may be
          incomplete or inaccurate. To the fullest extent permitted by law, we
          disclaim warranties of merchantability, fitness for a particular purpose,
          and non-infringement.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Limitation of liability</h2>
        <p>
          To the fullest extent permitted by law, VoltAI will not be liable for any
          indirect, incidental, special, consequential, or punitive damages, or any
          loss of profits or revenues, whether incurred directly or indirectly.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Changes</h2>
        <p>
          We may update these Terms from time to time. If we make material changes,
          we will provide notice by updating the effective date and/or within the
          Services.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Contact</h2>
        <p>
          Questions about these Terms? Email{" "}
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

