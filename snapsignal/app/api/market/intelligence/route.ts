import { NextRequest, NextResponse } from "next/server";
import { getMarketData } from "@/app/lib/pipeline/store";
import { FALLBACK } from "@/app/lib/pipeline/process";

// Dashboard calls this — returns split data by user type + pill
export async function GET(req: NextRequest) {
  try {
    const userType = req.nextUrl.searchParams.get("type") ?? "agent"; // agent|seller|buyer
    const pill = req.nextUrl.searchParams.get("pill") ?? "all"; // all|rates|market|tech|legal|pain|trending

    const [viewData, fullSignals, cityData, news, dashStats] = await Promise.all([
      getMarketData(`market:${userType}_view`),
      getMarketData("market:signals"),
      getMarketData("market:city_sentiment"),
      getMarketData(pill === "all" ? "market:news:all" : `market:news:${pill}`),
      getMarketData("market:dashboard_stats"),
    ]);

    if (!viewData) {
      const fb = FALLBACK;
      return NextResponse.json({
        userType,
        pill,
        summary: fb.weekly_summary[userType as "agent" | "seller" | "buyer"] ?? fb.weekly_summary.agent,
        pain_points: fb.pain_points,
        trending: fb.trending_topics,
        market_signals: fb.market_signals,
        city_sentiment: fb.city_sentiment,
        news: [],
        dashboard_stats: fb.dashboard_stats,
        updatedAt: null,
        isFallback: true,
      });
    }

    return NextResponse.json({
      userType,
      pill,
      ...viewData,
      market_signals: fullSignals?.market_signals,
      city_sentiment: cityData?.city_sentiment,
      news: news?.news ?? [],
      dashboard_stats: dashStats?.stats ?? null,
      updatedAt: viewData.updatedAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
