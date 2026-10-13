// Data collection — Reddit direct JSON API only (no Brave, no FRED, no API keys needed)
// Manual trigger: GET /api/cron/collect?secret=snapsignal-cron

const REDDIT_HEADERS = { "User-Agent": "SnapSignal/1.0 by Snaphomz" };
const SUBREDDITS = [
  { sub: "RealEstate",          type: "general" },
  { sub: "FirstTimeHomeBuyer",  type: "buyer"   },
  { sub: "Mortgages",           type: "buyer"   },
  { sub: "HousingMarket",       type: "general" },
  { sub: "realestateinvesting", type: "agent"   },
  { sub: "homeowners",          type: "seller"  },
];

// ─────────────────────────────────────────
// Stub: rates (no FRED — use fallback in process layer)
// ─────────────────────────────────────────
export async function collectRates(): Promise<Record<string, { value: number; date: string }>> {
  return {};
}

// ─────────────────────────────────────────
// Stub: news (removed Brave — Reddit is primary source)
// ─────────────────────────────────────────
export async function collectNews(): Promise<Array<{ title: string; description: string; url: string; category: string }>> {
  return [];
}

// ─────────────────────────────────────────
// Stub: X posts (removed Brave)
// ─────────────────────────────────────────
export async function collectXPosts(): Promise<Array<{ title: string; description: string; url: string; topic: string; source: string }>> {
  return [];
}

// ─────────────────────────────────────────
// Reddit — direct public JSON API, no auth needed
// ─────────────────────────────────────────
async function fetchRedditFeed(
  subreddit: string,
  sort: "hot" | "top" | "new",
  limit = 10
): Promise<Array<{ title: string; url: string; selftext: string; score: number; num_comments: number; created_utc: number }>> {
  try {
    const res = await fetch(
      `https://www.reddit.com/r/${subreddit}/${sort}.json?limit=${limit}&t=week`,
      { headers: REDDIT_HEADERS, signal: AbortSignal.timeout(8000) }
    );
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.data?.children ?? []).map((c: {
      data: { title: string; url: string; selftext: string; score: number; num_comments: number; created_utc: number; permalink: string }
    }) => ({
      title:       c.data.title,
      url:         `https://www.reddit.com${c.data.permalink}`,
      selftext:    (c.data.selftext ?? "").slice(0, 300),
      score:       c.data.score ?? 0,
      num_comments:c.data.num_comments ?? 0,
      created_utc: c.data.created_utc ?? 0,
    }));
  } catch {
    return [];
  }
}

export async function collectRedditPosts() {
  const allPosts: Array<{
    title: string; score: number; comments: number;
    subreddit: string; type: string; created: number;
    url: string; selftext: string; feed: string;
  }> = [];

  for (const { sub, type } of SUBREDDITS) {
    for (const sort of ["hot", "top"] as const) {
      const posts = await fetchRedditFeed(sub, sort, 8);
      posts.forEach(p => allPosts.push({
        title:    p.title,
        score:    p.score,
        comments: p.num_comments,
        subreddit: sub,
        type,
        feed:     sort,
        created:  p.created_utc,
        url:      p.url,
        selftext: p.selftext,
      }));
      await new Promise(r => setTimeout(r, 400));
    }
  }

  // Dedupe by URL
  const map = new Map<string, typeof allPosts[0]>();
  for (const p of allPosts) {
    if (!map.has(p.url)) map.set(p.url, p);
  }
  return Array.from(map.values());
}

// ─────────────────────────────────────────
// Trending — derived from Reddit hot posts
// ─────────────────────────────────────────
export async function collectTrending() {
  const posts = await fetchRedditFeed("RealEstate", "hot", 5);
  return posts.map(p => ({
    title:       p.title,
    description: p.selftext.slice(0, 150),
    url:         p.url,
  }));
}
