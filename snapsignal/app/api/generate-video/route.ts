import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/app/lib/pipeline/store";

export const maxDuration = 300;

const SNAPCAC_URL = process.env.SNAPCAC_API_URL || "http://localhost:5001";

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Empty or invalid request body" }, { status: 400 });
  }

  // If source is Reddit → enrich body with stored Reddit posts so snap-cac
  // writes the script from actual Reddit discussions, not generic market data
  const source = String(body.source ?? "").toLowerCase();
  if (source.includes("reddit")) {
    try {
      const stored = await getMarketData("market:reddit_posts");
      if (stored?.posts) {
        // Flatten all subreddits into a list of top posts, max 15
        const allPosts: Array<{ title: string; subreddit: string; url: string; selftext?: string }> = [];
        for (const sub of Object.values(stored.posts) as Array<typeof allPosts>) {
          allPosts.push(...sub);
        }
        body.reddit_posts = allPosts
          .sort((a: { score?: number }, b: { score?: number }) => (b.score ?? 0) - (a.score ?? 0))
          .slice(0, 15)
          .map((p: { title: string; subreddit: string; url: string; selftext?: string }) => ({
            title: p.title,
            subreddit: p.subreddit,
            url: p.url,
            selftext: (p.selftext ?? "").slice(0, 150),
          }));
      }
    } catch { /* non-blocking — proceed without Reddit posts */ }
  }

  try {
    const resp = await fetch(`${SNAPCAC_URL}/generate-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(270_000),
    });

    const data = await resp.json();

    if (data.video_url) {
      data.video_url = `/api/serve-video/${encodeURIComponent(data.filename)}`;
    }

    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const isTimeout = msg.includes("abort") || msg.includes("timeout") || msg.includes("The operation was aborted");
    const isDev = process.env.NODE_ENV === "development";
    return NextResponse.json(
      {
        success: false,
        error: isTimeout
          ? "Video generation timed out. The signal may be too complex — try again."
          : isDev
            ? `SnapCAC error: ${msg}. Start: cd snap-cac && python api.py`
            : "Video service unavailable. Please try again in a moment.",
      },
      { status: 503 }
    );
  }
}
