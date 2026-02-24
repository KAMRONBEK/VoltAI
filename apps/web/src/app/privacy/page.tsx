import type { Metadata } from "next";
import { PageShell } from "@/components/PageShell";

const supportEmail = "support@voltai.uz";

export const metadata: Metadata = {
  title: "Privacy Policy | VoltAI",
  description: "Privacy Policy for the VoltAI app and website.",
};

export default function PrivacyPage() {
  return (
    <PageShell
      title="Privacy Policy"
      description="How VoltAI collects and uses information."
      supportEmail={supportEmail}
    >
      <p>
        Effective date: <span className="text-foreground/90">[add date]</span>
      </p>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Overview</h2>
        <p>
          This Privacy Policy describes how VoltAI (&ldquo;we&rdquo;, &ldquo;us&rdquo;)
          collects, uses, and shares information when you use the VoltAI mobile
          application and this website (together, the &ldquo;Services&rdquo;).
          Replace placeholders in brackets with your final details before publishing.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Information we collect</h2>
        <p>
          Depending on how you use the Services, we may collect the following types
          of information:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <span className="text-foreground/90">Usage data</span> (e.g. screens
            viewed, feature interactions, app diagnostics).
          </li>
          <li>
            <span className="text-foreground/90">Device data</span> (e.g. device
            model, OS version, app version, language).
          </li>
          <li>
            <span className="text-foreground/90">Approximate location</span> if you
            enable location access, to show stations near you.
          </li>
          <li>
            <span className="text-foreground/90">Support communications</span> (the
            content you send us when you contact support).
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">How we use information</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>Provide and improve the Services (search, filtering, navigation).</li>
          <li>Diagnose and fix bugs, prevent abuse, and keep the Services secure.</li>
          <li>Respond to your requests and support inquiries.</li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Sharing</h2>
        <p>
          We do not sell your personal information. We may share information with:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Service providers that help us operate the Services (hosting, analytics,
            crash reporting), under appropriate agreements.
          </li>
          <li>
            Authorities when required by law or to protect rights, safety, and
            security.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Data retention</h2>
        <p>
          We keep information only as long as necessary for the purposes described
          in this policy, unless a longer retention period is required by law.
        </p>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Your choices</h2>
        <ul className="list-disc pl-5 space-y-1">
          <li>You can disable location access in your device settings.</li>
          <li>
            You can contact us to request updates or deletion where applicable.
          </li>
        </ul>
      </section>

      <section className="space-y-2">
        <h2 className="text-foreground font-medium">Contact</h2>
        <p>
          If you have questions about this Privacy Policy, contact us at{" "}
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

