import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/app/lib/pipeline/store";

const SNAPCAC_URL = process.env.SNAPCAC_API_URL || "http://localhost:5001";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
  }

  const source = String(body.source ?? "").toLowerCase();
  if (source.includes("reddit")) {
    try {
      const stored = await getMarketData("market:reddit_posts");
      if (stored?.posts) {
        const allPosts: Array<{ title: string; subreddit: string; url: string; selftext?: string; score?: number }> = [];
        for (const sub of Object.values(stored.posts) as Array<typeof allPosts>) {
          allPosts.push(...sub);
        }
        body.reddit_posts = allPosts
          .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 15)
          .map((p) => ({ title: p.title, subreddit: p.subreddit, url: p.url, selftext: (p.selftext ?? "").slice(0, 150) }));
      }
    } catch { /* non-blocking */ }
  }

  try {
    const resp = await fetch(`${SNAPCAC_URL}/generate-script`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: `Script generation failed: ${msg}` }, { status: 503 });
  }
}
