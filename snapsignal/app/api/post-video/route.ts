import { NextRequest, NextResponse } from "next/server";
import { logYouTubeVideo } from "@/app/lib/sheets";

const SNAPCAC_URL = process.env.SNAPCAC_API_URL || "http://localhost:5001";

export async function POST(req: NextRequest) {
  const body = await req.json();

  try {
    const resp = await fetch(`${SNAPCAC_URL}/post-video`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const data = await resp.json();

    // Log YouTube video ID to Google Sheets after successful upload
    const ytResult = data?.results?.youtube;
    if (ytResult?.success && ytResult?.video_id && !ytResult?.simulated) {
      void logYouTubeVideo({
        title:       body.title ?? "",
        filename:    body.filename ?? "",
        video_id:    ytResult.video_id,
        url:         ytResult.url ?? `https://youtube.com/shorts/${ytResult.video_id}`,
        signal_text: body.signal_text ?? "",
      });
    }

    return NextResponse.json(data, { status: resp.status });
  } catch {
    return NextResponse.json(
      { success: false, error: "SnapCAC server not running. Start: cd snap-cac && python api.py" },
      { status: 503 }
    );
  }
}
