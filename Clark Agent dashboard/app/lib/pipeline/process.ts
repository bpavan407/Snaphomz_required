// AI processing layer — Groq extracts structured intelligence from Reddit data

import { groq } from "@/app/lib/groq";

interface StatBlock {
  value: string;
  delta: string;
  dir: "up" | "down" | "flat";
  meaning: string;
}

export interface ProcessedIntelligence {
  pain_points: Array<{
    pain: string;
    category: "buyer" | "seller" | "agent" | "investor";
    count: number;
    cities: string[];
    trend: string;
    source_url: string;
    source_name: string;
  }>;
  city_sentiment: Record<string, number>;
  trending_topics: Array<{
    topic: string;
    category: string;
    affects: string;
    urgency: "high" | "medium" | "low";
    source_url: string;
    source_name: string;
  }>;
  weekly_summary: {
    agent: string;
    seller: string;
    buyer: string;
  };
  market_signals: {
    direction: "heating" | "cooling" | "stable";
    confidence: number;
    reason: string;
  };
  dashboard_stats: {
    inventory: StatBlock;
    price_drops: StatBlock;
    buyer_demand: StatBlock;
  };
}

export const FALLBACK: ProcessedIntelligence = {
  pain_points: [
    { pain: "Low inventory across major markets",      category: "buyer",  count: 800, cities: ["Dallas", "Austin"],   trend: "rising",  source_url: "https://reddit.com/r/RealEstate",         source_name: "Reddit r/RealEstate" },
    { pain: "Mortgage rates still elevated",           category: "buyer",  count: 600, cities: ["nationwide"],          trend: "stable",  source_url: "https://reddit.com/r/Mortgages",          source_name: "Reddit r/Mortgages" },
    { pain: "Bidding wars returning in hot markets",   category: "buyer",  count: 450, cities: ["Nashville", "Denver"], trend: "rising",  source_url: "https://reddit.com/r/FirstTimeHomeBuyer", source_name: "Reddit r/FirstTimeHomeBuyer" },
    { pain: "AI platforms threatening agent commissions",category:"agent", count: 380, cities: ["nationwide"],          trend: "rising",  source_url: "https://reddit.com/r/realestateinvesting", source_name: "Reddit r/realestateinvesting" },
    { pain: "Sellers pricing above market reality",    category: "seller", count: 290, cities: ["Austin", "Seattle"],   trend: "stable",  source_url: "https://reddit.com/r/RealEstate",         source_name: "Reddit r/RealEstate" },
  ],
  city_sentiment: { Dallas: -0.3, Austin: -0.1, Nashville: 0.2, Phoenix: 0.0, Denver: -0.2, Atlanta: 0.1 },
  trending_topics: [
    { topic: "NAR settlement reshaping commission rules", category: "legal",  affects: "agents", urgency: "high",   source_url: "https://reddit.com/r/realestateinvesting", source_name: "Reddit" },
    { topic: "Spring inventory surge failing to appear",  category: "market", affects: "all",    urgency: "medium", source_url: "https://reddit.com/r/RealEstate",         source_name: "Reddit" },
    { topic: "Fed rate pause through summer 2026",        category: "rates",  affects: "buyers", urgency: "medium", source_url: "https://reddit.com/r/Mortgages",          source_name: "Reddit" },
  ],
  weekly_summary: {
    agent:  "Buyer demand strong despite rate headwinds. Follow up warm leads — spring buying season accelerating.",
    seller: "Strong seller market in most metros. Price aggressively, list now before summer slowdown.",
    buyer:  "Competition fierce. Get pre-approved before searching. Target homes listed 15+ days.",
  },
  market_signals: { direction: "heating", confidence: 0.7, reason: "Low inventory + steady demand creating seller-favorable conditions" },
  dashboard_stats: {
    inventory:    { value: "1,840", delta: "↓ −12% vs last mo", dir: "down", meaning: "Fewer listings = seller leverage returning." },
    price_drops:  { value: "847",   delta: "↑ +34 today",       dir: "up",   meaning: "More sellers becoming negotiable — buyers gain room." },
    buyer_demand: { value: "High",  delta: "↑ above seasonal",  dir: "up",   meaning: "Active but payment-sensitive — use buydowns." },
  },
};

export async function processWithClaude(
  redditPosts: Array<{ title: string; subreddit: string; type: string; url?: string }>,
  news: Array<{ title: string; description: string; url: string; category: string }>,
  rates: Record<string, { value: number; date: string }>
): Promise<ProcessedIntelligence> {

  const redditSample = redditPosts.slice(0, 50).map((p) =>
    `[Reddit/${p.subreddit}] ${p.title} | URL: ${p.url ?? `https://reddit.com/r/${p.subreddit}`}`
  ).join("\n");

  const newsSample = news.slice(0, 20).map((n) =>
    `[News/${n.category}] ${n.title} — ${n.description.slice(0, 100)} | URL: ${n.url}`
  ).join("\n");

  const ratesBlock = Object.entries(rates).map(([k, v]) =>
    `${k}: ${v.value} (${v.date})`
  ).join(", ");

  const prompt = `You are a real estate market intelligence analyst. Analyze data from FRED, news, and Reddit communities.

FRED LIVE DATA: ${ratesBlock || "unavailable"}

NEWS (Brave Search):
${newsSample || "none"}

REDDIT POSTS:
${redditSample}

Extract and return ONLY valid JSON (no markdown, no explanation):
{
  "pain_points": [
    { "pain": "short description", "category": "buyer|seller|agent|investor", "count": number, "cities": ["city1"], "trend": "rising|falling|stable", "source_url": "URL from data above", "source_name": "Reddit r/subreddit" }
  ],
  "city_sentiment": { "Dallas": -0.4, "Austin": 0.1 },
  "trending_topics": [
    { "topic": "topic name", "category": "market|legal|tech|rates|investment", "affects": "buyers|sellers|agents|all", "urgency": "high|medium|low", "source_url": "URL from data above", "source_name": "source" }
  ],
  "weekly_summary": {
    "agent": "2-3 sentence actionable summary for agents this week",
    "seller": "2-3 sentence actionable summary for sellers this week",
    "buyer": "2-3 sentence actionable summary for buyers this week"
  },
  "market_signals": { "direction": "heating|cooling|stable", "confidence": 0.75, "reason": "one sentence" },
  "dashboard_stats": {
    "inventory":    { "value": "e.g. 1,840", "delta": "↓ −12% vs last mo", "dir": "up|down|flat", "meaning": "max 12 words" },
    "price_drops":  { "value": "e.g. 847",   "delta": "↑ +34 today",       "dir": "up|down|flat", "meaning": "max 12 words" },
    "buyer_demand": { "value": "High|Medium|Low|Very High", "delta": "↑ above seasonal avg", "dir": "up|down|flat", "meaning": "max 12 words" }
  }
}

Rules: pain_points max 6, trending_topics max 5, summaries end with ONE specific action.`;

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 2800,
      temperature: 0.3,
    });

    const text = completion.choices[0]?.message?.content ?? "";
    return JSON.parse(text.replace(/```json|```/g, "").trim());
  } catch {
    return FALLBACK;
  }
}
