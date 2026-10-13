// Pipeline runner — Reddit → Groq → Redis
// Sources: Reddit direct JSON API only (no Brave, no FRED, no API keys beyond Groq)
// Manual trigger: GET /api/cron/collect?secret=snapsignal-cron

import { collectRedditPosts } from "./collect";
import { processWithClaude } from "./process";
import { storeIntelligence } from "./store";
import { logPipelineRun, logRedditPosts, logSignals } from "@/app/lib/sheets";

export async function runPipeline() {
  console.log("[Pipeline] Starting — source: Reddit (direct JSON API) + Groq");
  const startTime = Date.now();

  // Step 1: Collect Reddit posts via direct JSON API (no API key)
  const redditPosts = await collectRedditPosts();

  console.log(`[Pipeline] Collected: Reddit ${redditPosts.length} posts`);

  // Step 2: Process with Groq — extract intelligence from Reddit data
  console.log("[Pipeline] Processing with Groq...");
  const intelligence = await processWithClaude(redditPosts, [], {});

  // Step 3: Store to Redis
  console.log("[Pipeline] Storing to Redis...");
  const timestamp = await storeIntelligence(intelligence, {}, [], redditPosts);

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[Pipeline] Done in ${duration}s`);

  // Log to Google Sheets (fire-and-forget)
  void logPipelineRun({
    fred_series:      0,
    news_articles:    0,
    reddit_posts:     redditPosts.length,
    x_posts:          0,
    duration_s:       parseFloat(duration),
    market_direction: intelligence.market_signals?.direction,
    confidence:       intelligence.market_signals?.confidence,
    rate_30yr:        undefined,
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
      reddit_posts: redditPosts.length,
    },
    timestamp,
  };
}
