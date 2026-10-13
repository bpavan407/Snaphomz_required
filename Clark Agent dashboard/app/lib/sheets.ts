// Google Sheets integration — posts data to Apps Script webhook
// Webhook URL from Automation repo (SHEETS_WEBHOOK_URL in .env.local)
// Writes to separate tabs: PipelineRuns, YouTubeVideos, RedditPosts, Signals

const WEBHOOK = process.env.SHEETS_WEBHOOK_URL;

type SheetRow = Record<string, string | number | boolean | null>;

async function pushToSheet(sheet: string, row: SheetRow): Promise<void> {
  if (!WEBHOOK) return;
  try {
    await fetch(WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheet, action: "append", data: row }),
    });
  } catch (e) {
    console.error(`[Sheets] Failed to write to ${sheet}:`, e);
  }
}

// Called after every cron pipeline run
export async function logPipelineRun(stats: {
  fred_series: number;
  news_articles: number;
  reddit_posts: number;
  x_posts: number;
  duration_s: number;
  market_direction?: string;
  confidence?: number;
  rate_30yr?: number;
}) {
  await pushToSheet("PipelineRuns", {
    timestamp:        new Date().toISOString(),
    fred_series:      stats.fred_series,
    news_articles:    stats.news_articles,
    reddit_posts:     stats.reddit_posts,
    x_posts:          stats.x_posts,
    total_content:    stats.news_articles + stats.x_posts + stats.reddit_posts,
    duration_s:       stats.duration_s,
    market_direction: stats.market_direction ?? "",
    confidence:       stats.confidence ?? "",
    rate_30yr:        stats.rate_30yr ?? "",
  });
}

// Called after video posted to YouTube
export async function logYouTubeVideo(video: {
  title: string;
  filename: string;
  video_id: string;
  url: string;
  signal_text?: string;
}) {
  await pushToSheet("YouTubeVideos", {
    posted_at:   new Date().toISOString(),
    title:       video.title,
    filename:    video.filename,
    video_id:    video.video_id,
    url:         video.url,
    signal_text: (video.signal_text ?? "").slice(0, 200),
    views:       0,
    likes:       0,
  });
}

// Called after Reddit posts collected — logs top 10 per run
export async function logRedditPosts(posts: Array<{
  title: string; subreddit: string; url: string;
  score: number; feed?: string;
}>) {
  const top = posts.slice(0, 10);
  await Promise.all(top.map(p =>
    pushToSheet("RedditPosts", {
      collected_at: new Date().toISOString(),
      subreddit:    p.subreddit,
      feed:         p.feed ?? "hot",
      title:        p.title.slice(0, 200),
      url:          p.url,
      score:        p.score,
    })
  ));
}

// Called after signals processed — logs top signals
export async function logSignals(signals: Array<{
  headline: string; category: string;
  source_url?: string; urgency?: string;
}>) {
  const top = signals.slice(0, 5);
  await Promise.all(top.map(s =>
    pushToSheet("Signals", {
      logged_at: new Date().toISOString(),
      headline:  s.headline.slice(0, 200),
      category:  s.category,
      urgency:   s.urgency ?? "",
      source:    s.source_url ?? "",
    })
  ));
}
