// Data collection — FRED API + Brave Search + RSS feeds + Reddit direct JSON
// Manual trigger: GET /api/cron/collect?secret=clark-cron

const FRED_BASE  = "https://api.stlouisfed.org/fred/series/observations";
const BRAVE_BASE = "https://api.search.brave.com/res/v1/web/search";
const FRED_KEY   = process.env.FRED_API_KEY!;
const BRAVE_KEY  = process.env.BRAVE_SEARCH_API_KEY!;

const REDDIT_HEADERS = { "User-Agent": "ClarkAgent/1.0 by Snaphomz" };

// ─────────────────────────────────────────
// RSS — real estate news channels
// ─────────────────────────────────────────
const RSS_FEEDS = [
  { url: "https://www.inman.com/feed/",                        source: "Inman News",      category: "industry" },
  { url: "https://www.housingwire.com/feed/",                  source: "HousingWire",     category: "market"   },
  { url: "https://www.realtrends.com/feed/",                   source: "RealTrends",      category: "industry" },
  { url: "https://therealdeal.com/feed/",                      source: "The Real Deal",   category: "market"   },
  { url: "https://www.redfin.com/news/feed/",                  source: "Redfin",          category: "market"   },
  { url: "https://www.nar.realtor/blogs/economists-outlook/feed", source: "NAR",           category: "rates"    },
  { url: "https://www.calculatedriskblog.com/feeds/posts/default", source: "Calculated Risk", category: "rates" },
  { url: "https://nationalmortgagenews.com/feed",              source: "National Mortgage News", category: "rates" },
];

function parseRSSItem(xml: string): Array<{ title: string; url: string; description: string; pubDate: string }> {
  const items: Array<{ title: string; url: string; description: string; pubDate: string }> = [];
  const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
  for (const match of itemMatches) {
    const block = match[1];
    const title = block.match(/<title[^>]*><!\[CDATA\[([^\]]*)\]\]><\/title>|<title[^>]*>([^<]*)<\/title>/)?.[1] ?? block.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? "";
    const link  = block.match(/<link>([^<]*)<\/link>|<link[^>]*href="([^"]*)"[^>]*\/>/)?.[1] ?? block.match(/<link[^>]*href="([^"]*)"[^>]*\/>/)?.[2] ?? "";
    const desc  = block.match(/<description><!\[CDATA\[([^\]]*)\]\]><\/description>|<description>([^<]*)<\/description>/)?.[1] ?? "";
    const date  = block.match(/<pubDate>([^<]*)<\/pubDate>/)?.[1] ?? "";
    if (title && link) items.push({ title: title.trim(), url: link.trim(), description: desc.trim().slice(0, 200), pubDate: date });
    if (items.length >= 5) break;
  }
  return items;
}

export async function collectRSSNews(): Promise<Array<{ title: string; description: string; url: string; category: string; source: string; age?: string }>> {
  const all: Array<{ title: string; description: string; url: string; category: string; source: string; age?: string }> = [];
  await Promise.all(RSS_FEEDS.map(async (feed) => {
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "ClarkAgent/1.0 (real estate intelligence)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) return;
      const xml = await res.text();
      const items = parseRSSItem(xml);
      for (const item of items) {
        all.push({ title: item.title, description: item.description, url: item.url, category: feed.category, source: feed.source, age: item.pubDate ? "Recent" : undefined });
      }
    } catch { /* skip feed on error */ }
  }));
  return all;
}

// ─────────────────────────────────────────
// FRED — mortgage rates + market indicators
// ─────────────────────────────────────────
export async function collectRates() {
  const series = {
    rate_30yr:           "MORTGAGE30US",
    rate_15yr:           "MORTGAGE15US",
    treasury_10yr:       "DGS10",
    home_price_index:    "MSPUS",
    existing_home_sales: "EXHOSLUSM495S",
    housing_starts:      "HOUST",
    building_permits:    "PERMIT",
  };

  const results: Record<string, { value: number; date: string }> = {};

  await Promise.all(
    Object.entries(series).map(async ([key, seriesId]) => {
      try {
        const url = `${FRED_BASE}?series_id=${seriesId}&api_key=${FRED_KEY}&sort_order=desc&limit=2&file_type=json`;
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const data = await res.json();
        const obs = data?.observations ?? [];
        const latest = obs.find((o: { value: string }) => o.value !== ".");
        if (latest) results[key] = { value: parseFloat(latest.value), date: latest.date };
      } catch { /* skip series on error */ }
    })
  );

  return results;
}

// ─────────────────────────────────────────
// Brave Search helper
// ─────────────────────────────────────────
async function braveSearch(
  query: string,
  count = 10,
  freshness?: string
): Promise<Array<{ title: string; description: string; url: string; age?: string; source?: string }>> {
  try {
    const params = new URLSearchParams({ q: query, count: String(count) });
    if (freshness) params.set("freshness", freshness);
    const res = await fetch(`${BRAVE_BASE}?${params}`, {
      headers: { "X-Subscription-Token": BRAVE_KEY },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.web?.results ?? []).map((r: {
      title: string; description?: string; url: string; age?: string; meta_url?: { hostname?: string }
    }) => ({
      title:       r.title,
      description: r.description ?? "",
      url:         r.url,
      age:         r.age,
      source:      r.meta_url?.hostname ?? "",
    }));
  } catch { return []; }
}

// ─────────────────────────────────────────
// Brave — real estate news
// ─────────────────────────────────────────
export async function collectNews() {
  const queries = [
    { q: "US housing market news 2026",                         category: "market"     },
    { q: "mortgage rates forecast USA 2026",                    category: "rates"      },
    { q: "NAR realtor commission settlement news 2026",         category: "industry"   },
    { q: "real estate investing opportunities USA 2026",        category: "investment" },
    { q: "home prices rising falling USA 2026",                 category: "market"     },
    { q: "housing inventory crisis USA 2026",                   category: "market"     },
    { q: "first time homebuyer affordability 2026",             category: "market"     },
    { q: "Fed interest rate decision housing impact 2026",      category: "rates"      },
    { q: "real estate agent technology AI tools 2026",          category: "tech"       },
    { q: "luxury real estate market USA 2026",                  category: "investment" },
    { q: "commercial real estate office market 2026",           category: "investment" },
    { q: "housing starts building permits USA 2026",            category: "market"     },
    { q: "site:inman.com real estate news",                     category: "industry"   },
    { q: "site:housingwire.com mortgage market news",           category: "rates"      },
    { q: "site:therealdeal.com real estate market",             category: "market"     },
  ];

  const all: Array<{ title: string; description: string; url: string; category: string; age?: string; source?: string }> = [];

  for (const { q, category } of queries) {
    const results = await braveSearch(q, 5, "pw");
    results.forEach(r => all.push({ ...r, category }));
    await new Promise(r => setTimeout(r, 300));
  }

  const seen = new Set<string>();
  return all.filter(item => { if (seen.has(item.url)) return false; seen.add(item.url); return true; });
}

// ─────────────────────────────────────────
// Brave — X / Twitter posts
// ─────────────────────────────────────────
export async function collectXPosts() {
  const queries = [
    { q: "site:x.com real estate housing market USA 2026",  topic: "market"    },
    { q: "site:x.com mortgage rates USA homebuyers 2026",   topic: "rates"     },
    { q: "site:x.com housing inventory USA real estate",    topic: "inventory" },
    { q: "site:x.com NAR realtor commission 2026",          topic: "industry"  },
    { q: "site:x.com first time homebuyer struggling USA",  topic: "buyers"    },
    { q: "site:x.com home prices dropping USA 2026",        topic: "prices"    },
  ];

  const all: Array<{ title: string; description: string; url: string; topic: string; source: string }> = [];

  for (const { q, topic } of queries) {
    const results = await braveSearch(q, 4);
    results.forEach(r => all.push({ ...r, topic, source: "X/Twitter" }));
    await new Promise(r => setTimeout(r, 350));
  }

  const seen = new Set<string>();
  return all.filter(item => { if (seen.has(item.url)) return false; seen.add(item.url); return true; });
}

// ─────────────────────────────────────────
// Reddit — direct public JSON (no auth)
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
      title:        c.data.title,
      url:          `https://www.reddit.com${c.data.permalink}`,
      selftext:     (c.data.selftext ?? "").slice(0, 300),
      score:        c.data.score ?? 0,
      num_comments: c.data.num_comments ?? 0,
      created_utc:  c.data.created_utc ?? 0,
    }));
  } catch { return []; }
}

const SUBREDDITS = [
  { sub: "RealEstate",          type: "general" },
  { sub: "FirstTimeHomeBuyer",  type: "buyer"   },
  { sub: "Mortgages",           type: "buyer"   },
  { sub: "HousingMarket",       type: "general" },
  { sub: "realestateinvesting", type: "agent"   },
  { sub: "homeowners",          type: "seller"  },
];

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
        title:     p.title,
        score:     p.score,
        comments:  p.num_comments,
        subreddit: sub,
        type,
        feed:      sort,
        created:   p.created_utc,
        url:       p.url,
        selftext:  p.selftext,
      }));
      await new Promise(r => setTimeout(r, 400));
    }
  }

  const map = new Map<string, typeof allPosts[0]>();
  for (const p of allPosts) { if (!map.has(p.url)) map.set(p.url, p); }
  return Array.from(map.values());
}

export async function collectTrending() {
  const posts = await fetchRedditFeed("RealEstate", "hot", 5);
  return posts.map(p => ({ title: p.title, description: p.selftext.slice(0, 150), url: p.url }));
}
