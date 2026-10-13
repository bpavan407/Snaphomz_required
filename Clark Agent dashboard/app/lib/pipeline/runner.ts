// Pipeline runner — FRED + Brave + Reddit → Groq → Redis
// Manual trigger: GET /api/cron/collect?secret=clark-cron

import { collectRates, collectNews, collectXPosts, collectRedditPosts, collectRSSNews } from "./collect";
import { processWithClaude } from "./process";
import { storeIntelligence } from "./store";
import { logPipelineRun, logRedditPosts, logSignals } from "@/app/lib/sheets";

export async function runPipeline() {
  console.log("[Pipeline] Starting — sources: FRED + Brave Search + Reddit direct");
  const startTime = Date.now();

  // Collect all sources in parallel
  const [rates, braveNews, rssNews, xPosts, redditPosts] = await Promise.all([
    collectRates(),
    collectNews(),
    collectRSSNews(),
    collectXPosts(),
    collectRedditPosts(),
  ]);

  const news = [...braveNews, ...rssNews];
  console.log(`[Pipeline] Collected: FRED ${Object.keys(rates).length} series, Brave ${braveNews.length}, RSS ${rssNews.length}, X ${xPosts.length}, Reddit ${redditPosts.length}`);

  // Process with Groq — pass all sources
  console.log("[Pipeline] Processing with Groq...");
  const intelligence = await processWithClaude(redditPosts, news, rates);

  // Store to Redis
  console.log("[Pipeline] Storing to Redis...");
  const timestamp = await storeIntelligence(intelligence, rates, news, redditPosts);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Pipeline] Done in ${duration}s`);

  // Log to Google Sheets (fire-and-forget)
  void logPipelineRun({
    fred_series:      Object.keys(rates).length,
    news_articles:    news.length,
    reddit_posts:     redditPosts.length,
    x_posts:          xPosts.length,
    duration_s:       parseFloat(duration),
    market_direction: intelligence.market_signals?.direction,
    confidence:       intelligence.market_signals?.confidence,
    rate_30yr:        rates.rate_30yr?.value,
  });
  void logRedditPosts(redditPosts);
  void logSignals(intelligence.trending_topics?.map(t => ({
    headline:   t.topic,
    category:   t.category,
    source_url: t.source_url,
    urgency:    t.urgency,
  })) ?? []);

  return {
    success: true,
    duration: `${duration}s`,
    collected: {
      fred_series:  Object.keys(rates).length,
      news:         news.length,
      x_posts:      xPosts.length,
      reddit_posts: redditPosts.length,
    },
    timestamp,
  };
}
