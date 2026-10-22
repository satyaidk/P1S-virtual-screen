import { DevelopmentConsole } from "@/components/development-console/DevelopmentConsole";

export default async function Home({ searchParams }: { searchParams: Promise<{ demo?: string }> }) {
  const { demo } = await searchParams;
  return <DevelopmentConsole demo={demo === "1"} />;
}
