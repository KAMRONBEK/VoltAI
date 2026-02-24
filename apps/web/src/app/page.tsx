import { Container } from "@/components/Container";
import { NeoButton } from "@/components/NeoButton";
import { SiteFooter } from "@/components/SiteFooter";
import { SiteHeader } from "@/components/SiteHeader";

export default function Home() {
  const supportEmail = "support@voltai.uz";
  const storeLinks = {
    googlePlay: undefined as string | undefined,
    appStore: undefined as string | undefined,
  };

  const features = [
    {
      title: "Find stations fast",
      body: "Search charging points nearby and along your route, with clear station details.",
    },
    {
      title: "Smart filters",
      body: "Filter by connector type, power, availability, and amenities to match your needs.",
    },
    {
      title: "Save favorites",
      body: "Bookmark reliable stations for quick access next time.",
    },
    {
      title: "Navigate with confidence",
      body: "Open directions in your preferred maps app and get there quickly.",
    },
    {
      title: "Coverage that grows",
      body: "VoltAI focuses on making it easy to discover more charging options over time.",
    },
    {
      title: "Dark-first design",
      body: "A clean interface optimized for night driving and quick readability.",
    },
  ];

  return (
    <div className="min-h-screen">
      <SiteHeader />

      <main>
        <section className="py-16 sm:py-24">
          <Container>
            <div className="neo-card rounded-3xl p-8 sm:p-12">
              <div className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-surface px-3 py-1 text-xs text-muted">
                <span className="h-1.5 w-1.5 rounded-full bg-accent-2" />
                EV charging stations, in one place
              </div>

              <div className="mt-6 grid gap-8 lg:grid-cols-2 lg:items-center">
                <div>
                  <h1 className="text-3xl font-semibold tracking-tight sm:text-5xl">
                    VoltAI helps you find EV chargers quickly.
                  </h1>
                  <p className="mt-4 text-base leading-7 text-muted sm:text-lg">
                    Discover charging stations, compare options, and get directions —
                    with a dark-first interface designed for clarity on the road.
                  </p>

                  <div className="mt-7 flex flex-col gap-3 sm:flex-row">
                    <NeoButton
                      href={storeLinks.googlePlay}
                      disabled={!storeLinks.googlePlay}
                      ariaLabel="Get it on Google Play (coming soon)"
                    >
                      Get it on Google Play
                      <span className="text-xs text-muted">(coming soon)</span>
                    </NeoButton>
                    <NeoButton
                      href={storeLinks.appStore}
                      disabled={!storeLinks.appStore}
                      variant="secondary"
                      ariaLabel="Download on the App Store (coming soon)"
                    >
                      Download on the App Store
                      <span className="text-xs text-muted">(coming soon)</span>
                    </NeoButton>
                  </div>

                  <div className="mt-6 text-sm text-muted">
                    Need help?{" "}
                    <a
                      className="text-foreground/90 underline decoration-border hover:text-foreground transition"
                      href={`mailto:${supportEmail}`}
                    >
                      {supportEmail}
                    </a>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="neo-card rounded-2xl p-5">
                    <div className="text-sm font-medium">Search</div>
                    <div className="mt-1 text-sm text-muted">
                      Find stations near you and along your route.
                    </div>
                  </div>
                  <div className="neo-card rounded-2xl p-5">
                    <div className="text-sm font-medium">Filter</div>
                    <div className="mt-1 text-sm text-muted">
                      Connector, power, and availability.
                    </div>
                  </div>
                  <div className="neo-card rounded-2xl p-5">
                    <div className="text-sm font-medium">Navigate</div>
                    <div className="mt-1 text-sm text-muted">
                      Open directions in your maps app.
                    </div>
                  </div>
                  <div className="neo-card rounded-2xl p-5">
                    <div className="text-sm font-medium">Save</div>
                    <div className="mt-1 text-sm text-muted">
                      Keep favorites for one-tap access.
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>

        <section className="py-10 sm:py-14">
          <Container>
            <div className="flex items-end justify-between gap-8">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Why VoltAI
                </h2>
                <p className="mt-2 text-sm text-muted sm:text-base">
                  Simple, fast, and built for real-world charging workflows.
                </p>
              </div>
            </div>

            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="neo-card rounded-2xl p-6">
                  <div className="text-base font-medium">{f.title}</div>
                  <div className="mt-2 text-sm leading-6 text-muted">{f.body}</div>
                </div>
              ))}
            </div>
          </Container>
        </section>

        <section className="py-10 sm:py-14">
          <Container>
            <div className="neo-card rounded-3xl p-8 sm:p-10">
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Screenshots
              </h2>
              <p className="mt-2 text-sm text-muted sm:text-base">
                Placeholder frames for now — drop in real app images anytime.
              </p>

              <div className="mt-7 grid gap-4 md:grid-cols-3">
                {["Search", "Station details", "Filters"].map((label) => (
                  <div
                    key={label}
                    className="rounded-2xl border border-border/70 bg-surface p-4"
                  >
                    <div className="aspect-[9/16] rounded-xl bg-gradient-to-b from-white/10 to-transparent" />
                    <div className="mt-3 text-sm text-muted">{label}</div>
                  </div>
                ))}
              </div>
            </div>
          </Container>
        </section>

        <section className="py-10 sm:py-14">
          <Container>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              FAQ
            </h2>
            <div className="mt-6 grid gap-3">
              {[
                {
                  q: "Is VoltAI free?",
                  a: "The app experience may include free features; pricing details will be shared in-app when available.",
                },
                {
                  q: "Does VoltAI show all charging stations?",
                  a: "VoltAI aims to list as many relevant EV charging locations as possible and expand coverage over time.",
                },
                {
                  q: "How do I report an incorrect station?",
                  a: `Email ${supportEmail} with the station name/location and what needs updating.`,
                },
                {
                  q: "Do you track my location?",
                  a: "Location may be used to show nearby stations. Details will be described in the Privacy Policy.",
                },
                {
                  q: "When will the app be available?",
                  a: "Soon. The download buttons will become active once store listings are ready.",
                },
              ].map((item) => (
                <details
                  key={item.q}
                  className="neo-card rounded-2xl px-6 py-4"
                >
                  <summary className="cursor-pointer select-none text-sm font-medium">
                    {item.q}
                  </summary>
                  <div className="mt-3 text-sm leading-6 text-muted">{item.a}</div>
                </details>
              ))}
            </div>
          </Container>
        </section>
      </main>

      <SiteFooter supportEmail={supportEmail} />
    </div>
  );
}
