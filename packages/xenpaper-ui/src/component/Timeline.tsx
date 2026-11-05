import React, { useEffect, useRef, useCallback, useState, useMemo } from "react";
import styled from "styled-components";
import type { SoundEngine, MoscNoteMs } from "@xenpaper/mosc";
import type { Chapter } from "../data/process-grammar";
import { useAnimationFrame } from "../hooks/useAnimationFrame";

const TRACK_COLORS = ["#22cece", "#ff541e", "#d61ba4", "#a490b3", "#e6c229", "#5fd35f"];
const KEY_STEP_MS = 5000;

const formatMs = (ms: number): string => {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

type Props = {
    engine: SoundEngine;
    // changes whenever the score is re-parsed, triggers a redraw of the overview
    scoreKey: unknown;
    chapters?: Chapter[];
    // where playback will start from when not playing
    getIdleMs: () => number;
    onSeek: (ms: number) => void;
};

export function Timeline(props: Props): React.ReactElement {
    const { engine, scoreKey, chapters = [], getIdleMs, onSeek } = props;

    const barRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const playedRef = useRef<HTMLDivElement>(null);
    const headRef = useRef<HTMLDivElement>(null);
    const hoverRef = useRef<HTMLDivElement>(null);
    const elapsedRef = useRef<HTMLSpanElement>(null);
    const remainingRef = useRef<HTMLSpanElement>(null);
    const dragMsRef = useRef<number | null>(null);
    const lastTextRef = useRef("");

    const [muted, setMuted] = useState<Set<string>>(() => new Set());
    const [solo, setSolo] = useState<string | null>(null);

    const tracks = useMemo(() => {
        const list: { id: string; color: string }[] = [];
        const seen = new Set<string>();
        const seq = engine.scoreMs?.sequence ?? [];
        seq.forEach((item) => {
            if (item.type !== "NOTE_MS") return;
            const id = item.track ?? "";
            if (!seen.has(id)) {
                seen.add(id);
                list.push({
                    id,
                    color: TRACK_COLORS[(list.length) % TRACK_COLORS.length],
                });
            }
        });
        return list;
    }, [engine, scoreKey]);

    const effectiveMuted = useMemo(() => {
        if (solo !== null && tracks.some((t) => t.id === solo)) {
            const set = new Set<string>();
            tracks.forEach((t) => {
                if (t.id !== solo) set.add(t.id);
            });
            return set;
        }
        return muted;
    }, [muted, solo, tracks]);

    useEffect(() => {
        engine.setMutedTracks(effectiveMuted);
    }, [engine, effectiveMuted]);

    const toggleMute = (id: string, e: React.MouseEvent) => {
        if (e.shiftKey || e.altKey) {
            setSolo((prev) => (prev === id ? null : id));
            return;
        }
        setSolo(null);
        setMuted((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const toggleSolo = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSolo((prev) => (prev === id ? null : id));
    };

    const lengthMs = (): number => engine.scoreMs?.lengthMs ?? 0;

    // draw a mini piano-roll of the whole score, coloured by track
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const score = engine.scoreMs;
        if (!canvas) return;
        const dpr = window.devicePixelRatio || 1;
        const w = canvas.clientWidth;
        const h = canvas.clientHeight;
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);

        const len = score?.lengthMs ?? 0;
        if (!score || len <= 0) return;

        const notes = score.sequence.filter(
            (item) => item.type === "NOTE_MS"
        ) as MoscNoteMs[];
        if (notes.length === 0) return;

        let lo = Infinity;
        let hi = -Infinity;
        notes.forEach((n) => {
            const p = Math.log2(n.hz);
            if (p < lo) lo = p;
            if (p > hi) hi = p;
        });
        const range = hi - lo || 1;
        const pad = 3;
        const noteH = Math.max(1.5, Math.min(3, (h - pad * 2) / 24));

        const trackColors = new Map<string, string>();
        notes.forEach((n) => {
            const track = n.track ?? "";
            let color = trackColors.get(track);
            if (!color) {
                color = TRACK_COLORS[trackColors.size % TRACK_COLORS.length];
                trackColors.set(track, color);
            }
            ctx.fillStyle = color;
            ctx.globalAlpha = effectiveMuted.has(track) ? 0.18 : 0.9;
            const x = (n.ms / len) * w;
            const nw = Math.max(1, ((n.msEnd - n.ms) / len) * w);
            const y = pad + (1 - (Math.log2(n.hz) - lo) / range) * (h - pad * 2 - noteH);
            ctx.fillRect(x, y, nw, noteH);
        });
        ctx.globalAlpha = 1;
    }, [engine, effectiveMuted]);

    useEffect(draw, [draw, scoreKey]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || typeof ResizeObserver === "undefined") return;
        const observer = new ResizeObserver(() => draw());
        observer.observe(canvas);
        return () => observer.disconnect();
    }, [draw]);

    // playhead + labels are updated imperatively to avoid react re-renders every frame
    useAnimationFrame(() => {
        const len = lengthMs();
        const ms =
            dragMsRef.current ?? (engine.playing() ? engine.position() : getIdleMs());
        const clamped = Math.min(Math.max(ms, 0), len);
        const pct = len > 0 ? (clamped / len) * 100 : 0;
        if (playedRef.current) playedRef.current.style.width = `${pct}%`;
        if (headRef.current) headRef.current.style.left = `${pct}%`;

        const text = `${formatMs(clamped)}|-${formatMs(len - clamped)} / ${formatMs(len)}`;
        if (text !== lastTextRef.current) {
            lastTextRef.current = text;
            const [elapsed, remaining] = text.split("|");
            if (elapsedRef.current) elapsedRef.current.textContent = elapsed;
            if (remainingRef.current) remainingRef.current.textContent = remaining;
            barRef.current?.setAttribute("aria-valuenow", String(Math.round(clamped)));
            barRef.current?.setAttribute("aria-valuemax", String(Math.round(len)));
        }
    }, []);

    const msFromEvent = (e: React.PointerEvent): number => {
        const rect = barRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return 0;
        const ratio = Math.min(Math.max((e.clientX - rect.left) / rect.width, 0), 1);
        return ratio * lengthMs();
    };

    const chapterAtMs = (ms: number): string | undefined => {
        let active: string | undefined;
        for (let i = 0; i < chapters.length; i++) {
            if (chapters[i].time[0] <= ms) active = chapters[i].label;
            else break;
        }
        return active;
    };

    const handlePointerDown = (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        dragMsRef.current = msFromEvent(e);
    };

    const handlePointerMove = (e: React.PointerEvent) => {
        if (hoverRef.current) {
            const rect = barRef.current?.getBoundingClientRect();
            const len = lengthMs();
            if (rect && len > 0) {
                const ms = msFromEvent(e);
                const ch = chapterAtMs(ms);
                hoverRef.current.style.left = `${(ms / len) * 100}%`;
                hoverRef.current.textContent = ch
                    ? `${formatMs(ms)} · ${ch}`
                    : formatMs(ms);
            }
        }
        if (dragMsRef.current !== null) {
            dragMsRef.current = msFromEvent(e);
        }
    };

    const handlePointerUp = (e: React.PointerEvent) => {
        if (dragMsRef.current === null) return;
        const ms = msFromEvent(e);
        dragMsRef.current = null;
        onSeek(ms);
    };

    const handlePointerCancel = () => {
        dragMsRef.current = null;
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        const len = lengthMs();
        const current = engine.playing() ? engine.position() : getIdleMs();
        let next: number | undefined;
        if (e.key === "ArrowRight") next = current + KEY_STEP_MS;
        if (e.key === "ArrowLeft") next = current - KEY_STEP_MS;
        if (e.key === "Home") next = 0;
        if (e.key === "End") next = len;
        if (next === undefined) return;
        e.preventDefault();
        onSeek(Math.min(Math.max(next, 0), len));
    };

    const totalLen = lengthMs();
    const showTracks = tracks.length > 1 || (tracks.length === 1 && tracks[0].id !== "");

    return (
        <Wrapper>
            {showTracks && (
                <TrackList>
                    {tracks.map((t) => {
                        const isMuted = effectiveMuted.has(t.id);
                        const isSolo = solo === t.id;
                        return (
                            <TrackPill
                                key={t.id}
                                color={t.color}
                                muted={isMuted}
                                onClick={(e) => toggleMute(t.id, e)}
                                title={`Click to mute/unmute "${t.id || "default"}" (Shift+Click or S to solo)`}
                            >
                                <TrackDot color={t.color} muted={isMuted} />
                                <span>{t.id || "main"}</span>
                                <SoloBadge
                                    active={isSolo}
                                    onClick={(e) => toggleSolo(t.id, e)}
                                    title={`Solo "${t.id || "default"}"`}
                                >
                                    S
                                </SoloBadge>
                            </TrackPill>
                        );
                    })}
                </TrackList>
            )}
            <Time ref={elapsedRef}>0:00</Time>
            <Bar
                ref={barRef}
                role="slider"
                tabIndex={0}
                aria-label="Playback position"
                aria-valuemin={0}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
                onKeyDown={handleKeyDown}
            >
                <Canvas ref={canvasRef} />
                {totalLen > 0 &&
                    chapters.map((c, idx) => (
                        <ChapterTick
                            key={idx}
                            style={{ left: `${(c.time[0] / totalLen) * 100}%` }}
                            title={c.label}
                            onPointerDown={(e) => {
                                e.stopPropagation();
                                onSeek(c.time[0]);
                            }}
                        />
                    ))}
                <Played ref={playedRef} />
                <Head ref={headRef} />
                <Hover ref={hoverRef} />
            </Bar>
            <Time ref={remainingRef} right>
                -0:00 / 0:00
            </Time>
        </Wrapper>
    );
}

const Wrapper = styled.div`
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.4rem 0.75rem;
    background-color: ${(props) => props.theme.colors.background.normal};
    border-top: 1px ${(props) => props.theme.colors.background.light} solid;
    flex-shrink: 0;
    z-index: 4;
`;

const TrackList = styled.div`
    display: flex;
    align-items: center;
    gap: 0.35rem;
    flex-wrap: wrap;
`;

const TrackPill = styled.button<{ color: string; muted: boolean }>`
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.15rem 0.4rem;
    border-radius: 3px;
    border: 1px solid ${(props) => (props.muted ? props.theme.colors.background.light : props.color)};
    background-color: ${(props) => props.theme.colors.background.light};
    color: ${(props) =>
        props.muted ? props.theme.colors.highlights.unknown : props.theme.colors.highlights.comment};
    opacity: ${(props) => (props.muted ? 0.5 : 1)};
    font-family: ${(props) => props.theme.fonts.mono};
    font-size: 0.75rem;
    cursor: pointer;
    outline: none;
`;

const TrackDot = styled.span<{ color: string; muted: boolean }>`
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background-color: ${(props) => (props.muted ? "transparent" : props.color)};
    border: 1px solid ${(props) => props.color};
`;

const SoloBadge = styled.span<{ active: boolean }>`
    padding: 0 0.2rem;
    border-radius: 2px;
    font-size: 0.65rem;
    background-color: ${(props) =>
        props.active ? "#e6c229" : "rgba(255, 255, 255, 0.08)"};
    color: ${(props) =>
        props.active ? props.theme.colors.background.normal : props.theme.colors.text.placeholder};
`;

const Time = styled.span<{ right?: boolean }>`
    font-family: ${(props) => props.theme.fonts.mono};
    font-size: 0.8rem;
    color: ${(props) => props.theme.colors.text.placeholder};
    white-space: nowrap;
    min-width: ${(props) => (props.right ? "6.5rem" : "2.5rem")};
    text-align: ${(props) => (props.right ? "right" : "left")};
    font-variant-numeric: tabular-nums;
`;

const Bar = styled.div`
    position: relative;
    flex-grow: 1;
    height: 2.5rem;
    cursor: pointer;
    touch-action: none;
    user-select: none;
    background-color: ${(props) => props.theme.colors.background.light};
    border-radius: 3px;
    outline: none;

    &:focus-visible {
        box-shadow: 0 0 0 2px ${(props) => props.theme.colors.focus};
    }

    &:hover > div:last-child {
        display: block;
    }
`;

const Canvas = styled.canvas`
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    opacity: 0.85;
    pointer-events: none;
`;

const ChapterTick = styled.div`
    position: absolute;
    top: 0;
    bottom: 0;
    width: 1px;
    background-color: rgba(255, 255, 255, 0.25);
    &:hover {
        width: 3px;
        margin-left: -1px;
        background-color: #ffffff;
    }
`;

const Played = styled.div`
    position: absolute;
    top: 0;
    bottom: 0;
    left: 0;
    width: 0;
    background-color: rgba(255, 255, 255, 0.08);
    border-radius: 3px 0 0 3px;
    pointer-events: none;
`;

const Head = styled.div`
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    margin-left: -1px;
    background-color: #ffffff;
    box-shadow: 0 0 6px rgba(255, 255, 255, 0.6);
    pointer-events: none;
`;

const Hover = styled.div`
    display: none;
    position: absolute;
    bottom: 100%;
    transform: translate(-50%, -4px);
    padding: 1px 4px;
    font-family: ${(props) => props.theme.fonts.mono};
    font-size: 0.7rem;
    color: ${(props) => props.theme.colors.background.normal};
    background-color: ${(props) => props.theme.colors.text.placeholder};
    border-radius: 2px;
    pointer-events: none;
    white-space: nowrap;
`;
