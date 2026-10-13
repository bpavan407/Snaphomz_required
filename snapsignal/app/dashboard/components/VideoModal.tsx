"use client";
import { useState, useEffect, useRef, useCallback } from "react";

const STEPS = [
  { label: "Writing AI script",  detail: "Groq LLM analyzing signal…"     },
  { label: "Generating voice",   detail: "edge-tts synthesizing audio…"    },
  { label: "Building video",     detail: "Ken Burns + captions rendering…" },
  { label: "Finalizing",        detail: "Encoding 9:16 MP4…"              },
];

interface ScriptScene {
  key: string;
  headline: string;
  body: string;
  spoken: string;
}

interface ScriptData {
  title: string;
  caption: string;
  script: string;
  scenes: ScriptScene[];
}

export function VideoModal({ signal, contentType, source, onClose }: {
  signal: string; contentType: string; source?: string; onClose: () => void;
}) {
  const [view, setView]               = useState<"generating" | "player" | "error">("generating");
  const [step, setStep]               = useState(0);
  const [scriptData, setScriptData]   = useState<ScriptData | null>(null);
  const [videoUrl, setVideoUrl]       = useState("");
  const [videoTitle, setVideoTitle]   = useState("");
  const [videoTs, setVideoTs]         = useState("");
  const [videoFile, setVideoFile]     = useState("");
  const [errMsg, setErrMsg]           = useState("");
  const [posting, setPosting]         = useState<string | null>(null);
  const [postDone, setPostDone]       = useState<string[]>([]);
  const fired       = useRef(false);
  const mounted     = useRef(true);
  const abortRef    = useRef<AbortController | null>(null);
  const scriptRef   = useRef<ScriptData | null>(null);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; abortRef.current?.abort(); };
  }, []);

  // Step animation — advance slowly, never block
  useEffect(() => {
    if (view !== "generating") return;
    setStep(0);
    const t1 = setTimeout(() => setStep(1), 60000);
    const t2 = setTimeout(() => setStep(2), 120000);
    const t3 = setTimeout(() => setStep(3), 200000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [view]);

  const buildPayload = useCallback(() => ({
    content_type: contentType,
    signal_text:  signal,
    zip_code:     "10001",
    source:       source ?? "",
  }), [contentType, signal, source]);

  const tryFallbackVideo = useCallback(async () => {
    if (!mounted.current) return;
    try {
      const r = await fetch("/api/list-videos");
      if (!r.ok) { setView("error"); return; }
      const d = await r.json();
      const videos: Array<{ filename: string; title: string; video_url: string; generated_at: string }> = d.videos ?? [];
      if (!videos.length) { setView("error"); return; }
      // prefer video whose filename matches current content type
      const slug = contentType.replace(/_/g, "").toLowerCase();
      const match = videos.find(v => v.filename.replace(/[_-]/g, "").toLowerCase().includes(slug));
      const pick  = match ?? videos[0];
      if (mounted.current) {
        setVideoUrl(`/api/serve-video/${encodeURIComponent(pick.filename)}`);
        setVideoTitle(`${pick.title.replace(/_/g, " ")} (saved)`);
        setVideoTs(pick.generated_at ? new Date(pick.generated_at).toLocaleString() : "");
        setVideoFile(pick.filename);
        setPostDone([]);
        setView("player");
      }
    } catch {
      if (mounted.current) setView("error");
    }
  }, [contentType]);

  const generate = useCallback(async () => {
    if (!mounted.current) return;
    setView("generating");
    setScriptData(null);
    scriptRef.current = null;
    const payload = buildPayload();

    // Phase 1 — no abort signal (fast ~5s, don't let StrictMode double-mount kill it)
    try {
      const sResp = await fetch("/api/generate-script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (sResp.ok) {
        const sData = await sResp.json();
        if (sData.success && sData.script_data) {
          scriptRef.current = sData.script_data;
          if (mounted.current) {
            setScriptData(sData.script_data);
            setStep(1);
          }
        }
      }
    } catch { /* non-blocking */ }

    if (!mounted.current) return;

    // Phase 2 — long build, abort only on modal close
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const vResp = await fetch("/api/generate-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...payload,
          script_data: scriptRef.current,
        }),
        signal: ctrl.signal,
      });

      if (!mounted.current) return;
      const vData = await vResp.json();

      if (vData.success && vData.video_url) {
        setVideoUrl(vData.video_url);
        setVideoTitle(vData.title || "Snaphomz Video");
        setVideoTs(new Date().toLocaleString());
        setVideoFile(vData.filename || "");
        setPostDone([]);
        if (!scriptRef.current && vData.script) {
          setScriptData({ title: vData.title, caption: vData.caption ?? "", script: vData.script, scenes: [] });
        }
        setView("player");
        return;
      }

      setErrMsg(vData.error || "Generation failed.");
      await tryFallbackVideo();
    } catch (e) {
      if (!mounted.current) return;
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes("abort") && !msg.includes("AbortError")) {
        setErrMsg("Video generation failed. Please try again.");
        await tryFallbackVideo();
      }
    }
  }, [buildPayload, tryFallbackVideo]);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    generate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function postTo(platform: "youtube" | "x") {
    if (!videoFile) return;
    setPosting(platform);
    try {
      const resp = await fetch("/api/post-video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: videoFile, title: videoTitle, caption: scriptData?.caption ?? "", platforms: [platform] }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.success) setPostDone(p => [...p, platform]);
    } finally { setPosting(null); }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 900, background: "rgba(7,17,31,.9)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ width: view === "player" ? 880 : 820, maxWidth: "95vw", background: "#0F1C2E", border: "1px solid rgba(255,107,0,.25)", borderRadius: 18, overflow: "hidden", boxShadow: "0 32px 80px rgba(0,0,0,.7)" }}
        onClick={e => e.stopPropagation()}
      >
        <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes pulse{0%,100%{opacity:.4}50%{opacity:1}}`}</style>

        {/* Header */}
        <div style={{ padding: "14px 20px", borderBottom: "1px solid rgba(255,255,255,.07)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: "#fff" }}>
              {view === "player" ? (videoTitle || "Video Ready") : view === "generating" ? "Generating Video…" : "Generation Failed"}
            </div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,.3)", marginTop: 2 }}>Powered by Snaphomz SnapCAC</div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", color: "rgba(255,255,255,.35)", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: "0 4px" }}>×</button>
        </div>

        {/* Signal strip */}
        <div style={{ padding: "8px 20px", background: "rgba(245,127,46,.06)", borderBottom: "1px solid rgba(255,255,255,.04)" }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#F57F2E", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 2 }}>Signal</div>
          <div style={{ fontSize: 11, color: "rgba(255,255,255,.55)" }}>{signal.slice(0, 140)}{signal.length > 140 ? "…" : ""}</div>
        </div>

        {/* Body — two columns */}
        <div style={{ display: "grid", gridTemplateColumns: view === "player" ? "auto 1fr" : "1fr 1fr", gap: 0 }}>

          {/* LEFT — steps or video player */}
          <div style={{ padding: 20, borderRight: "1px solid rgba(255,255,255,.06)" }}>

            {view === "generating" && (
              <div>
                {/* Progress bar */}
                <div style={{ height: 3, background: "rgba(255,255,255,.06)", borderRadius: 2, marginBottom: 20, overflow: "hidden" }}>
                  <div style={{ height: "100%", background: "linear-gradient(90deg,#F57F2E,#E84C85)", borderRadius: 2,
                    width: `${[8, 30, 60, 85][step]}%`, transition: "width 30s ease" }} />
                </div>
                {STEPS.map((s, i) => {
                  const done = i < step, active = i === step;
                  return (
                    <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
                      <div style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, display: "grid", placeItems: "center",
                        background: done ? "#0B5D3B" : active ? "rgba(245,127,46,.15)" : "rgba(255,255,255,.04)",
                        border: done ? "none" : active ? "1.5px solid #F57F2E" : "1.5px solid rgba(255,255,255,.08)" }}>
                        {done
                          ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round"><polyline points="20 6 9 17 4 12"/></svg>
                          : active
                          ? <div style={{ width: 9, height: 9, border: "2px solid rgba(255,107,0,.2)", borderTop: "2px solid #F57F2E", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
                          : <div style={{ width: 5, height: 5, borderRadius: "50%", background: "rgba(255,255,255,.15)" }} />}
                      </div>
                      <div>
                        <div style={{ fontSize: 12, fontWeight: active ? 700 : 500, color: done ? "rgba(255,255,255,.4)" : active ? "#fff" : "rgba(255,255,255,.2)", textDecoration: done ? "line-through" : "none" }}>{s.label}</div>
                        {active && <div style={{ fontSize: 10, color: "rgba(255,107,0,.7)", marginTop: 2, animation: "pulse 1.5s ease infinite" }}>{s.detail}</div>}
                      </div>
                    </div>
                  );
                })}
                <div style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,.2)", marginTop: 8 }}>Generating your video — keep this open</div>
              </div>
            )}

            {view === "player" && (
              <div style={{ width: 200 }}>
                <div style={{ borderRadius: 10, overflow: "hidden", background: "#000", aspectRatio: "9/16", maxHeight: 360, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 12 }}>
                  <video src={videoUrl} controls autoPlay muted loop style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                </div>
                <div style={{ fontSize: 10, color: "rgba(255,255,255,.25)", marginBottom: 10 }}>{videoTs}</div>
                <button onClick={() => postTo("youtube")} disabled={!!posting || postDone.includes("youtube")}
                  style={{ width: "100%", padding: "8px 0", borderRadius: 7, border: "none", background: postDone.includes("youtube") ? "#0B5D3B" : posting === "youtube" ? "#333" : "#CC0000", color: "#fff", fontWeight: 700, fontSize: 11, cursor: posting || postDone.includes("youtube") ? "default" : "pointer", marginBottom: 6 }}>
                  {postDone.includes("youtube") ? "✓ Posted" : "▶ Post to YouTube"}
                </button>
                <button onClick={() => { fired.current = false; generate(); }}
                  style={{ width: "100%", padding: "7px 0", borderRadius: 7, background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.09)", color: "rgba(255,255,255,.4)", fontSize: 10, cursor: "pointer", fontWeight: 600 }}>
                  🎬 Regenerate
                </button>
              </div>
            )}

            {view === "error" && (
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "rgba(255,107,107,.12)", display: "grid", placeItems: "center", fontSize: 16 }}>⚠️</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#FF6B6B" }}>Generation failed</div>
                </div>
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.35)", background: "rgba(255,0,0,.04)", borderRadius: 8, padding: "10px 12px", lineHeight: 1.6, marginBottom: 14 }}>{errMsg}</div>
                <button onClick={() => { fired.current = false; generate(); }}
                  style={{ width: "100%", padding: "10px 0", background: "#F57F2E", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
                  Try Again
                </button>
              </div>
            )}
          </div>

          {/* RIGHT — script panel (inlined — no nested component to avoid remount) */}
          <div style={{ padding: 20, minWidth: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#F57F2E", textTransform: "uppercase", letterSpacing: ".1em", marginBottom: 12 }}>
              {view === "generating" ? "AI Script" : "Script"}
            </div>
            {!scriptData ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 200, gap: 10 }}>
                <div style={{ width: 28, height: 28, border: "2.5px solid rgba(245,127,46,.2)", borderTop: "2.5px solid #F57F2E", borderRadius: "50%", animation: "spin .8s linear infinite" }} />
                <div style={{ fontSize: 11, color: "rgba(255,255,255,.25)" }}>AI writing script…</div>
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 8, overflowY: "auto", maxHeight: 420 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#F57F2E", marginBottom: 4 }}>{scriptData.title}</div>
                {scriptData.scenes?.length > 0
                  ? scriptData.scenes.map((sc, i) => (
                      <div key={i} style={{ borderRadius: 8, background: "rgba(255,255,255,.04)", border: `1px solid ${{ hook:"#F57F2E", problem:"#E84C85", insight:"#0A84FF", snaphomz_angle:"#30D158", cta:"#FF9F0A" }[sc.key] ?? "#F57F2E"}22`, padding: "10px 12px" }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: { hook:"#F57F2E", problem:"#E84C85", insight:"#0A84FF", snaphomz_angle:"#30D158", cta:"#FF9F0A" }[sc.key] ?? "#F57F2E", textTransform: "uppercase", letterSpacing: ".08em", marginBottom: 4 }}>{sc.key.replace("_", " ")}</div>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#fff", lineHeight: 1.35, marginBottom: sc.body ? 4 : 0 }}>{sc.headline}</div>
                        {sc.body && <div style={{ fontSize: 10, color: "rgba(255,255,255,.45)", lineHeight: 1.4, marginBottom: 4 }}>{sc.body}</div>}
                        {sc.spoken && <div style={{ fontSize: 10, color: "rgba(255,255,255,.6)", fontStyle: "italic", borderLeft: `2px solid ${{ hook:"#F57F2E", problem:"#E84C85", insight:"#0A84FF", snaphomz_angle:"#30D158", cta:"#FF9F0A" }[sc.key] ?? "#F57F2E"}`, paddingLeft: 8 }}>🎙 {sc.spoken}</div>}
                      </div>
                    ))
                  : <div style={{ fontSize: 11, color: "rgba(255,255,255,.4)", lineHeight: 1.6 }}>{scriptData.script}</div>
                }
                {scriptData.caption && (
                  <div style={{ fontSize: 10, color: "rgba(255,255,255,.3)", borderTop: "1px solid rgba(255,255,255,.06)", paddingTop: 8, marginTop: 4 }}>{scriptData.caption}</div>
                )}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
