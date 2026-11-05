import React, { useState, useCallback, useEffect, useRef } from "react";
import { AppWrapper } from "./AppWrapper";
import { IconToggle } from "./component/IconToggle";
import { Codearea } from "./component/Codearea";
import { ErrorMessage, WarningMessage } from "./component/ErrorMessage";
import { Timeline } from "./component/Timeline";
import { LoaderPane } from "./component/LoaderPane";
import { Box, Flex } from "./layout/Layout";
import { Sidebar, SidebarInfo, SidebarShare } from "./Sidebars";
import styled from "styled-components";

import { PitchRuler, useRulerState } from "./PitchRuler";

import { XenpaperGrammarParser } from "./data/grammar";

import { grammarToChars } from "./data/grammar-to-chars";
import { processGrammar } from "./data/process-grammar";
import type { InitialRulerState, Chapter, BarWarning } from "./data/process-grammar";
import type { MoscNoteMs } from "@xenpaper/mosc";
import type { HighlightColor, CharData } from "./data/grammar-to-chars";

import { useHash, hashify } from "./hooks/useHash";
import { useWindowLoaded } from "./hooks/useWindowLoaded";
import { useAnimationFrame } from "./hooks/useAnimationFrame";

import { useDendriform, useInput } from "dendriform";
import type { Dendriform } from "dendriform";
import { setAutoFreeze, enableMapSet } from "immer";
setAutoFreeze(false); // sadly I am relying on mutations within the xenpaper AST because who cares
enableMapSet();

import { scoreToMs } from "@xenpaper/mosc";
import type { SoundEngine } from "@xenpaper/mosc";
import { SoundEngineTonejs } from "@xenpaper/sound-engine-tonejs";

import { Helmet } from "react-helmet";

//
// sound engine instance
//

const soundEngine: SoundEngine = new SoundEngineTonejs();

//
// xenpaper ast parsing
//

class Boxed<T> {
    value: T;
    constructor(value: T) {
        this.value = value;
    }
}

type LineToken = {
    text: string;
    color: HighlightColor;
    playTime?: [number, number];
    warning?: string;
};

type ParsedLine = {
    text: string;
    chars: (CharData | undefined)[];
    tokens: LineToken[];
    signature: string;
};

type ParsedData = {
    chars: CharData[];
    lines: ParsedLine[];
    chapters: Chapter[];
    barWarnings: BarWarning[];
};

type Parsed = {
    data: Boxed<ParsedData>;
    initialRulerState?: InitialRulerState;
    error: string;
    // char index of a parse error, if known
    errorAt?: number;
};

const tokenizeLine = (
    text: string,
    lineChars?: (CharData | undefined)[]
): { tokens: LineToken[]; signature: string } => {
    const len = text.length;
    if (len === 0) {
        return { tokens: [], signature: "" };
    }
    const tokens: LineToken[] = [];
    let curColor: HighlightColor = lineChars?.[0]?.color || "unknown";
    let curPlayTime = lineChars?.[0]?.playTime;
    let curWarning = lineChars?.[0]?.warning;
    let runStart = 0;
    let signature = "";

    const push = (end: number) => {
        tokens.push({
            text: text.slice(runStart, end),
            color: curColor,
            playTime: curPlayTime,
            warning: curWarning,
        });
        signature += `${curColor}:${end - runStart}:${curPlayTime ? 1 : 0}:${
            curWarning ?? ""
        };`;
    };

    for (let i = 1; i < len; i++) {
        const cd = lineChars?.[i];
        const color: HighlightColor = cd?.color || "unknown";
        const playTime = cd?.playTime;
        const warning = cd?.warning;
        if (
            color !== curColor ||
            playTime !== curPlayTime ||
            warning !== curWarning
        ) {
            push(i);
            curColor = color;
            curPlayTime = playTime;
            curWarning = warning;
            runStart = i;
        }
    }
    push(len);

    return { tokens, signature };
};

const buildParsedLines = (unparsed: string, chars: CharData[]): ParsedLine[] => {
    const rawLines = unparsed.split("\n");
    const lines: ParsedLine[] = new Array(rawLines.length);
    let offset = 0;
    for (let i = 0; i < rawLines.length; i++) {
        const text = rawLines[i];
        const len = text.length;
        const lineChars = chars.slice(offset, offset + len);
        const { tokens, signature } = tokenizeLine(text, lineChars);
        lines[i] = { text, chars: lineChars, tokens, signature };
        offset += len + 1;
    }
    return lines;
};

const parse = (unparsed: string): Parsed => {
    try {
        const parsed = XenpaperGrammarParser(unparsed);
        const { score, initialRulerState, chapters = [], barWarnings = [] } =
            processGrammar(parsed);
        const chars = grammarToChars(parsed);

        // chars share objects per token, so copy before tagging a single char
        barWarnings.forEach(({ pos, message }) => {
            chars[pos] = { ...(chars[pos] ?? { color: "delimiter" }), warning: message };
        });

        if (score) {
            const scoreMs = scoreToMs(score);
            soundEngine.setScore(scoreMs);
        }

        return {
            data: new Boxed({
                chars,
                lines: buildParsedLines(unparsed, chars),
                chapters,
                barWarnings,
            }),
            initialRulerState,
            error: "",
        };
    } catch (e) {
        const matched = e.message.match(/Unexpected token at (\d+):(\d+)/);

        const lineNumber: number = matched ? Number(matched[1]) - 1 : -1;
        const colNumber: number = matched ? Number(matched[2]) - 1 : -1;

        const chars: CharData[] = [];
        let lineCount = 0;
        let colCount = 0;
        let error;
        let errorAt;

        if (lineNumber >= 0 && colNumber >= 0) {
            for (let i = 0; i <= unparsed.length; i++) {
                if (lineCount === lineNumber && colCount === colNumber) {
                    errorAt = i;
                    break;
                }
                if (unparsed[i] === "\n") {
                    lineCount++;
                    colCount = 0;
                } else {
                    colCount++;
                }
            }
        }

        if (typeof errorAt === "number") {
            error =
                unparsed[errorAt] !== undefined
                    ? e.message.replace(
                          "Unexpected token ",
                          `Unexpected token "${unparsed[errorAt]}" `
                      )
                    : e.message;

            chars[errorAt] = {
                color: "error",
            };
        } else {
            error = e.message;
        }

        return {
            data: new Boxed({
                chars,
                lines: buildParsedLines(unparsed, chars),
                chapters: [],
                barWarnings: [],
            }),
            initialRulerState: undefined,
            error,
            errorAt,
        };
    }
};

const getMsAtLine = (
    tune: string,
    chars: CharData[] | undefined,
    line: number
): number => {
    if (line === 0) {
        return 0;
    }
    let ms = 0;
    let counted = 0;
    for (let i = 0; i < tune.length; i++) {
        const chr = tune[i];
        const ch = chars?.[i];
        if (counted >= line) {
            const [start] = ch?.playTime ?? [];
            if (start !== undefined) {
                return start;
            }
        } else {
            const [, end] = ch?.playTime ?? [];
            if (end !== undefined) {
                ms = end;
            }
        }
        if (chr === "\n") {
            counted++;
        }
    }
    return ms;
};

//
// icons
//

const FOLLOW_PAUSE_MS = 3000;

const isInteractiveElement = (target: EventTarget | null): boolean => {
    const el = target as HTMLElement | null;
    if (!el || !el.tagName) return false;
    return (
        ["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A"].includes(el.tagName) ||
        el.isContentEditable ||
        el.getAttribute("role") === "slider"
    );
};

const PLAY_PATHS = {
    paused: ["M 0 0 L 12 6 L 0 12 Z"],
    playing: ["M 0 0 L 4 0 L 4 12 L 0 12 Z", "M 8 0 L 12 0 L 12 12 L 8 12 Z"],
    // stopped: ['M 0 0 L 12 0 L 12 12 L 0 12 Z'],
};

//
// application component with loader
//

export function Xenpaper(): React.ReactElement {
    const loaded = useWindowLoaded();

    return (
        <AppWrapper>
            <LoaderPane height="100vh" loaded={loaded}>
                <XenpaperApp loaded={loaded} />
            </LoaderPane>
        </AppWrapper>
    );
}

//
// application component
//

export type SidebarState = "info" | "share" | "ruler" | "none";

// type RealtimeState = {
//     on: boolean;
//     activeNotes: number[];
// };

export type TuneForm = {
    tune: string;
    embed: boolean;
    hash: string;
    url: string;
    urlEmbed: string;
};

type Props = {
    loaded: boolean;
};

export function XenpaperApp(props: Props): React.ReactElement {
    const { loaded } = props;

    //
    // dendriforms with application state
    //

    const [hash, setHash] = useHash();

    const tuneForm = useDendriform<TuneForm>(
        () => {
            let embed = false;
            let tune = hash;
            if (tune.startsWith("embed:")) {
                embed = true;
                tune = tune.substr(6);
            }
            return {
                tune,
                embed,
                hash: "",
                url: "",
                urlEmbed: "",
            };
        },
        { history: 300 }
    );

    tuneForm.useDerive((newValue) => {
        let hash = newValue.tune;
        const hashified = hashify(hash);

        if (newValue.embed) {
            hash = `embed:${hash}`;
        }

        const url = `https://dxinteractive.github.io/xenpaper/#${hashified}`;
        const urlEmbed = `https://dxinteractive.github.io/xenpaper/#embed:${hashified}`;

        tuneForm.branch("hash").set(hash);
        tuneForm.branch("url").set(url);
        tuneForm.branch("urlEmbed").set(urlEmbed);
    });

    tuneForm.branch("hash").useChange((hash) => {
        setHash(hash);
    });

    const parsedForm = useDendriform<Parsed>(() => parse(tuneForm.value.tune));

    tuneForm.useDerive((value) => {
        parsedForm.set(parse(value.tune));
    });

    //
    // state syncing between sound engine and react
    //

    const playing = useDendriform<boolean>(false);
    const selectedLine = useDendriform<number>(0);
    // position chosen on the timeline while stopped, used as the next play start
    const pendingSeekMs = useRef<number | null>(null);
    selectedLine.useChange((line) => {
        pendingSeekMs.current = null;
        soundEngine.setLoopStart(
            getMsAtLine(tuneForm.value.tune, parsedForm.value.data.value.chars, line)
        );
    });

    useEffect(() => {
        return soundEngine.onEnd(() => {
            playing.set(false);
        });
    }, []);

    const looping = useDendriform<boolean>(false);

    //
    // ruler state
    //

    const rulerState = useRulerState(parsedForm.value.initialRulerState);

    useEffect(() => {
        let frameId = 0;
        const pendingActive = new Map<string, MoscNoteMs | null>();
        const pendingCollected = new Map<string, MoscNoteMs>();

        const flush = () => {
            frameId = 0;
            if (pendingActive.size === 0 && pendingCollected.size === 0) {
                return;
            }
            const collect = rulerState.value.collect;
            rulerState.set((draft) => {
                pendingActive.forEach((note, id) => {
                    if (note) {
                        draft.notesActive.set(id, note);
                    } else {
                        draft.notesActive.delete(id);
                    }
                });
                if (collect) {
                    pendingCollected.forEach((note, pitchId) => {
                        if (!draft.notes.has(pitchId)) {
                            draft.notes.set(pitchId, note);
                        }
                    });
                }
            });
            pendingActive.clear();
            pendingCollected.clear();
        };

        const unsubscribe = soundEngine.onNote((note, on) => {
            const id = `${note.track ?? ""}-${note.ms}-${note.hz}`;
            if (on) {
                pendingActive.set(id, note);
                const pitchId = `${note.hz}-${note.label}`;
                if (!rulerState.value.notes.has(pitchId)) {
                    pendingCollected.set(pitchId, note);
                }
            } else {
                pendingActive.set(id, null);
            }
            if (!frameId) {
                frameId = requestAnimationFrame(flush);
            }
        });

        return () => {
            unsubscribe();
            if (frameId) {
                cancelAnimationFrame(frameId);
            }
        };
    }, []);

    parsedForm.branch("initialRulerState").useChange((initialRulerState) => {
        rulerState.set((draft) => {
            draft.rootHz = initialRulerState?.rootHz;
            draft.octaveSize = initialRulerState?.octaveSize;
            draft.plots = initialRulerState?.plots;
            if (draft.colourMode.startsWith("proxplot")) {
                const index = Number(draft.colourMode.replace("proxplot", ""));
                if (index >= (draft.plots ?? []).length) {
                    draft.colourMode = "gradient";
                }
            }
        });
    });

    //
    // sound engine callbacks
    //

    const getLineStartMs = useCallback(
        (): number =>
            getMsAtLine(
                tuneForm.value.tune,
                parsedForm.value.data.value.chars,
                selectedLine.value
            ),
        []
    );

    const getIdleMs = useCallback(
        (): number => pendingSeekMs.current ?? getLineStartMs(),
        []
    );

    const handleSetPlayback = useCallback((play: boolean) => {
        if (parsedForm.value.error) return;

        if (play) {
            // resume from a paused / seeked position, else from the selected line
            const startMs = getIdleMs();
            pendingSeekMs.current = null;
            soundEngine.gotoMs(startMs);
            playing.set(true);
            soundEngine.play();
            rulerState.set((draft) => {
                draft.notes.clear();
            });
        } else {
            if (soundEngine.playing()) {
                pendingSeekMs.current = soundEngine.position();
            }
            playing.set(false);
            soundEngine.pause();
        }
    }, []);

    const handleRestart = useCallback(() => {
        pendingSeekMs.current = null;
        handleSetPlayback(true);
    }, []);

    const handleTogglePlayback = useCallback((state: string) => {
        handleSetPlayback(state === "paused");
    }, []);

    const handleSeek = useCallback((ms: number) => {
        if (soundEngine.playing()) {
            soundEngine.gotoMs(ms);
        } else {
            pendingSeekMs.current = ms;
        }
    }, []);

    const handleSelectLine = useCallback((line: number) => {
        pendingSeekMs.current = null;
        selectedLine.set(line);
    }, []);

    // ctrl/cmd/alt + click on a note plays from that note
    const handlePlayFromChar = useCallback((index: number) => {
        const tune = tuneForm.value.tune;
        const chars = parsedForm.value.data.value.chars;
        const startOf = (i: number) =>
            tune[i] !== "\n" ? chars[i]?.playTime?.[0] : undefined;

        let ms = startOf(index) ?? startOf(index - 1);
        for (let i = index + 1; ms === undefined && i < tune.length && tune[i] !== "\n"; i++) {
            ms = startOf(i);
        }
        for (let i = index - 2; ms === undefined && i >= 0 && tune[i] !== "\n"; i--) {
            ms = startOf(i);
        }
        if (ms === undefined) return;

        if (soundEngine.playing()) {
            soundEngine.gotoMs(ms);
        } else {
            pendingSeekMs.current = ms;
            handleSetPlayback(true);
        }
    }, []);

    const handleToggleLoop = useCallback(() => {
        const newValue = !looping.value;
        looping.set(newValue);
        soundEngine.setLoopActive(newValue);
    }, []);

    //
    // special key combos
    //

    useEffect(() => {
        const callback = (event: KeyboardEvent) => {
            if ((event.ctrlKey || event.metaKey) && event.keyCode === 13) {
                handleRestart();
            }
            // space toggles play/pause when not typing or using a control
            if (
                event.code === "Space" &&
                !event.ctrlKey &&
                !event.metaKey &&
                !event.altKey &&
                !isInteractiveElement(event.target)
            ) {
                event.preventDefault();
                handleSetPlayback(!playing.value);
            }
            if ((event.ctrlKey || event.metaKey) && event.keyCode === 90) {
                event.preventDefault();
                if (event.shiftKey) {
                    tuneForm.redo();
                } else {
                    tuneForm.undo();
                }
            }
        };

        document.addEventListener("keydown", callback);
        return () => document.removeEventListener("keydown", callback);
    }, []);

    //
    // sidebar state
    //

    const [sidebarState, setSidebar] = useState<SidebarState>(() => {
        return parsedForm.value?.initialRulerState?.lowHz ? "ruler" : "info";
    });

    const toggleSidebarInfo = useCallback(() => {
        setSidebar((s) => (s !== "info" ? "info" : "none"));
    }, []);

    const toggleSidebarShare = useCallback(() => {
        setSidebar((s) => (s !== "share" ? "share" : "none"));
    }, []);

    const toggleSidebarRuler = useCallback(() => {
        setSidebar((s) => (s !== "ruler" ? "ruler" : "none"));
    }, []);

    const onSetTune = useCallback(async (tune: string): Promise<void> => {
        tuneForm.branch("tune").set(tune);
        pendingSeekMs.current = null;
        await soundEngine.gotoMs(0);
        handleSetPlayback(true);
    }, []);

    const codepaneContainerProps = { "data-codepane": true };

    //
    // elements
    //

    const playPause = playing.render(
        (form) => {
            return (
                <IconToggle
                    state={form.useValue() ? "playing" : "paused"}
                    paths={PLAY_PATHS}
                    onClick={handleTogglePlayback}
                    loaded={loaded}
                    hoverBackground
                    large={!tuneForm.branch("embed").useValue()}
                />
            );
        },
        [loaded]
    );

    const undoRedo = tuneForm.render((form) => {
        const { canUndo, canRedo } = form.useHistory();
        return (
            <>
                <SideButton onClick={form.undo} disabled={!canUndo}>
                    Undo
                </SideButton>
                <SideButton onClick={form.redo} disabled={!canRedo}>
                    Redo
                </SideButton>
            </>
        );
    });

    const loop = looping.render((looping) => {
        return (
            <SideButton onClick={handleToggleLoop} active={looping.useValue()}>
                Loop
            </SideButton>
        );
    });

    const sidebarToggles = (
        <>
            <SideButton
                onClick={toggleSidebarInfo}
                active={sidebarState === "info"}
            >
                Info
            </SideButton>
            <SideButton
                onClick={toggleSidebarShare}
                active={sidebarState === "share"}
            >
                Share
            </SideButton>
            <SideButton
                onClick={toggleSidebarRuler}
                active={sidebarState === "ruler"}
            >
                Ruler
            </SideButton>
        </>
    );

    const sidebar = (
        <>
            {sidebarState === "info" && (
                <SidebarInfo onSetTune={onSetTune} setSidebar={setSidebar} />
            )}
            {sidebarState === "share" &&
                tuneForm.render((form) => {
                    const url = form.branch("url").useValue();
                    const urlEmbed = form.branch("urlEmbed").useValue();
                    return (
                        <SidebarShare
                            setSidebar={setSidebar}
                            url={url}
                            urlEmbed={urlEmbed}
                        />
                    );
                })}
            {sidebarState === "ruler" && (
                <Sidebar
                    setSidebar={setSidebar}
                    title="Pitch ruler"
                    desc="Click and drag to pan, use mousewheel to zoom."
                    wide
                >
                    <PitchRuler rulerState={rulerState} />
                </Sidebar>
            )}
        </>
    );

    const code = (
        <CodePanel
            tuneForm={tuneForm}
            parsedForm={parsedForm}
            selectedLine={selectedLine}
            onSelectLine={handleSelectLine}
            onPlayFromChar={handlePlayFromChar}
        />
    );

    const htmlTitle = <SetHtmlTitle tuneForm={tuneForm} />;

    const timeline = parsedForm.render("data", (form) => {
        const data = form.useValue();
        return (
            <Timeline
                engine={soundEngine}
                scoreKey={data}
                chapters={data.value.chapters}
                getIdleMs={getIdleMs}
                onSeek={handleSeek}
            />
        );
    });

    const openOnXenpaper = tuneForm.render("url", (form) => (
        <EditOnXenpaperButton href={form.useValue()} target="_blank">
            Edit on Xenpaper
        </EditOnXenpaperButton>
    ));

    const embedLayout = tuneForm.branch("embed").useValue();

    if (embedLayout) {
        return (
            <EmbedLayout
                playPause={playPause}
                loop={loop}
                code={code}
                openOnXenpaper={openOnXenpaper}
                htmlTitle={htmlTitle}
                timeline={timeline}
                codepaneContainerProps={codepaneContainerProps}
            />
        );
    }

    return (
        <NormalLayout
            playPause={playPause}
            undoRedo={undoRedo}
            loop={loop}
            code={code}
            htmlTitle={htmlTitle}
            timeline={timeline}
            sidebarToggles={sidebarToggles}
            sidebar={sidebar}
            codepaneContainerProps={codepaneContainerProps}
        />
    );
}

//
// layouts
//

type NormalLayoutProps = {
    playPause: React.ReactNode;
    undoRedo: React.ReactNode;
    loop: React.ReactNode;
    code: React.ReactNode;
    htmlTitle: React.ReactNode;
    sidebarToggles: React.ReactNode;
    sidebar: React.ReactNode;
    timeline: React.ReactNode;
    codepaneContainerProps: { [prop: string]: unknown };
};

function NormalLayout(props: NormalLayoutProps): React.ReactElement {
    const {
        playPause,
        undoRedo,
        loop,
        code,
        htmlTitle,
        sidebarToggles,
        sidebar,
        timeline,
        codepaneContainerProps,
    } = props;

    return (
        <Flex height="100vh" flexDirection="column" overflow="hidden">
            {/* toolbar on mobile */}
            <Toolbar
                display={["flex", "none"]}
                alignItems="center"
                justifyContent="space-between"
                width="100%"
                flexShrink="0"
                overflowX="auto"
                borderBottom="1px solid"
                borderColor="background.light"
            >
                <Flex alignItems="center" flexShrink="0">
                    {playPause}
                    {undoRedo}
                    {loop}
                </Flex>
                <Flex alignItems="center" flexShrink="0">
                    {sidebarToggles}
                </Flex>
            </Toolbar>
            <Flex
                display={["flex", "flex"]}
                flexDirection={["column", "row"]}
                flexGrow="1"
                flexShrink="1"
                minHeight="0"
                position="relative"
                overflow="hidden"
            >
                {/* toolbar on desktop */}
                <Toolbar display={["none", "block"]} mt={4} px={2} pt="12px" flexShrink="0">
                    <Box mb={3}>{playPause}</Box>
                    {undoRedo}
                    {loop}
                    <Hr my={2} />
                    {sidebarToggles}
                </Toolbar>
                {/* codepane */}
                <Box
                    flexGrow="1"
                    flexShrink="1"
                    minHeight="0"
                    pl={[0, 3]}
                    overflow="auto"
                    mt={[0, 3]}
                    pt={[2, 3]}
                    {...codepaneContainerProps}
                >
                    {code}
                </Box>
                {/* sidebars */}
                {sidebar}
            </Flex>
            {timeline}
            {htmlTitle}
        </Flex>
    );
}

type EmbedLayoutProps = {
    playPause: React.ReactNode;
    loop: React.ReactNode;
    code: React.ReactNode;
    openOnXenpaper: React.ReactNode;
    htmlTitle: React.ReactNode;
    timeline: React.ReactNode;
    codepaneContainerProps: { [prop: string]: unknown };
};

function EmbedLayout(props: EmbedLayoutProps): React.ReactElement {
    const {
        playPause,
        loop,
        code,
        htmlTitle,
        openOnXenpaper,
        timeline,
        codepaneContainerProps,
    } = props;

    return (
        <Flex height="100vh" flexDirection="column" overflow="hidden">
            <Toolbar
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                width="100%"
                flexShrink="0"
                borderBottom="1px solid"
                borderColor="background.light"
            >
                <Flex alignItems="center" flexShrink="0">
                    {playPause}
                    {loop}
                </Flex>
                <Flex alignItems="center" flexShrink="0">
                    {openOnXenpaper}
                </Flex>
            </Toolbar>
            <Box
                flexGrow="1"
                flexShrink="1"
                minHeight="0"
                overflow="auto"
                mt={[0, 3]}
                pt={[2, 3]}
                {...codepaneContainerProps}
            >
                {code}
            </Box>
            {timeline}
            {htmlTitle}
        </Flex>
    );
}

//
// codepanel
//

type CodeLineProps = {
    lineIndex: number;
    lineText: string;
    tokens: LineToken[];
    signature: string;
    hasPlayStart: boolean;
    hasNewline: boolean;
    isSelected: boolean;
    onSelectLine: (line: number) => void;
    spansByLineRef: React.MutableRefObject<(HTMLSpanElement | null)[][]>;
};

const CodeLine = React.memo(
    function CodeLine(props: CodeLineProps): React.ReactElement {
        const {
            lineIndex,
            tokens,
            hasPlayStart,
            hasNewline,
            isSelected,
            onSelectLine,
            spansByLineRef,
        } = props;

        const lineSpansRef = useRef<(HTMLSpanElement | null)[]>([]);
        lineSpansRef.current.length = tokens.length;
        spansByLineRef.current[lineIndex] = lineSpansRef.current;

        const handlePlayStartClick = useCallback(() => {
            onSelectLine(lineIndex);
        }, [onSelectLine, lineIndex]);

        return (
            <>
                {hasPlayStart && (
                    <span
                        className={
                            isSelected ? "play-start selected" : "play-start"
                        }
                        onClick={handlePlayStartClick}
                    >
                        {">"}
                    </span>
                )}
                {tokens.map((token, idx) =>
                    token.playTime ? (
                        <span
                            key={idx}
                            className={`char hl-${token.color}`}
                            ref={(el) => {
                                lineSpansRef.current[idx] = el;
                            }}
                        >
                            {token.text}
                        </span>
                    ) : (
                        <span
                            key={idx}
                            className={`char hl-${token.color}${
                                token.warning ? " warn" : ""
                            }`}
                            data-warn={token.warning}
                        >
                            {token.text}
                        </span>
                    )
                )}
                {hasNewline && <span className="char hl-delimiter">{"\n"}</span>}
            </>
        );
    },
    (prev, next) =>
        prev.lineIndex === next.lineIndex &&
        prev.lineText === next.lineText &&
        prev.signature === next.signature &&
        prev.hasPlayStart === next.hasPlayStart &&
        prev.hasNewline === next.hasNewline &&
        prev.isSelected === next.isSelected
);

type CodePanelProps = {
    tuneForm: Dendriform<TuneForm>;
    parsedForm: Dendriform<Parsed>;
    selectedLine: Dendriform<number>;
    onSelectLine: (line: number) => void;
    onPlayFromChar: (index: number) => void;
};

const MAX_WARNINGS_SHOWN = 5;

// scroll a highlighted span into view, flash it, and optionally put the caret there
const revealInCode = (el: Element | undefined | null, charIndex?: number): void => {
    if (el) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
        el.classList.remove("flash");
        void (el as HTMLElement).offsetWidth; // restart the animation
        el.classList.add("flash");
    }
    if (charIndex !== undefined) {
        const textarea = document.querySelector<HTMLTextAreaElement>(
            "[data-codepane] textarea"
        );
        if (textarea && !textarea.disabled) {
            textarea.focus({ preventScroll: true });
            textarea.setSelectionRange(charIndex, charIndex);
        }
    }
};

function CodePanel(props: CodePanelProps): React.ReactElement {
    const spansByLineRef = useRef<(HTMLSpanElement | null)[][]>([]);
    const tokensByLineRef = useRef<LineToken[][]>([]);
    const activeSpansRef = useRef<Set<HTMLSpanElement>>(new Set());
    const followTargetRef = useRef<HTMLSpanElement | null>(null);
    const lastUserScrollRef = useRef<number>(0);

    useEffect(() => {
        const markUserScroll = (e: Event) => {
            // only interactions with the code pane itself should pause following
            const target = e.target as Element | null;
            if (target?.closest?.("[data-codepane]")) {
                lastUserScrollRef.current = performance.now();
            }
        };
        const events = ["wheel", "touchmove", "keydown", "mousedown"];
        events.forEach((e) => window.addEventListener(e, markUserScroll, { passive: true }));
        return () =>
            events.forEach((e) => window.removeEventListener(e, markUserScroll));
    }, []);

    const { onSelectLine: handleSelectLine, onPlayFromChar } = props;

    const handleTextareaClick = useCallback(
        (e: React.MouseEvent<HTMLTextAreaElement>) => {
            if (e.ctrlKey || e.metaKey || e.altKey) {
                onPlayFromChar(e.currentTarget.selectionStart);
            }
        },
        [onPlayFromChar]
    );

    useAnimationFrame(() => {
        const activeSpans = activeSpansRef.current;
        if (!soundEngine.playing()) {
            if (activeSpans.size > 0) {
                activeSpans.forEach((el) => el.classList.remove("active"));
                activeSpans.clear();
            }
            return;
        }

        const time = soundEngine.position();
        const nextActive = new Set<HTMLSpanElement>();
        const tokensByLine = tokensByLineRef.current;
        const spansByLine = spansByLineRef.current;
        let firstActive: HTMLSpanElement | undefined;

        for (let l = 0; l < tokensByLine.length; l++) {
            const tokens = tokensByLine[l];
            const spans = spansByLine[l];
            if (!tokens || !spans) continue;
            for (let t = 0; t < tokens.length; t++) {
                const playTime = tokens[t].playTime;
                if (playTime && playTime[0] <= time && playTime[1] > time) {
                    const el = spans[t];
                    if (el) {
                        nextActive.add(el);
                        if (!firstActive) firstActive = el;
                        if (!activeSpans.has(el)) {
                            el.classList.add("active");
                        }
                    }
                }
            }
        }

        // keep the earliest playing note in view, unless the user recently scrolled/typed
        if (
            firstActive &&
            firstActive !== followTargetRef.current &&
            performance.now() - lastUserScrollRef.current > FOLLOW_PAUSE_MS
        ) {
            followTargetRef.current = firstActive;
            const pane = firstActive.closest("[data-codepane]");
            if (pane) {
                const r = firstActive.getBoundingClientRect();
                const p = pane.getBoundingClientRect();
                if (r.top < p.top || r.bottom > p.bottom) {
                    firstActive.scrollIntoView({ block: "center", behavior: "smooth" });
                }
            }
        }

        activeSpans.forEach((el) => {
            if (!nextActive.has(el)) {
                el.classList.remove("active");
            }
        });
        activeSpansRef.current = nextActive;
    }, []);

    return props.tuneForm.render((form) => {
        const embed = form.branch("embed").useValue();

        // get dendriform state values
        const { data, error, errorAt } = props.parsedForm.useValue();
        const parsedLines = data.value.lines;
        const barWarnings = data.value.barWarnings;
        const selectedLineValue = props.selectedLine.useValue();

        // use value with a 200ms debounce for perf reasons
        const inputProps = useInput(form.branch("tune"), 200);
        const rawLines = inputProps.value.split("\n");
        const numLines = rawLines.length;
        const hasPlayStartButtons = numLines > 1;

        let prefixLen = 0;
        const minLen = Math.min(numLines, parsedLines.length);
        while (
            prefixLen < minLen &&
            rawLines[prefixLen] === parsedLines[prefixLen].text
        ) {
            prefixLen++;
        }

        const lineTokensArray: LineToken[][] = new Array(numLines);
        const charElements: React.ReactNode[] = new Array(numLines);

        for (let i = 0; i < numLines; i++) {
            const lineText = rawLines[i];
            let matchedParsed: ParsedLine | undefined;
            if (i < prefixLen) {
                matchedParsed = parsedLines[i];
            } else {
                const suffixParsedIdx = parsedLines.length - (numLines - i);
                if (
                    suffixParsedIdx >= prefixLen &&
                    suffixParsedIdx >= 0 &&
                    rawLines[i] === parsedLines[suffixParsedIdx]?.text
                ) {
                    matchedParsed = parsedLines[suffixParsedIdx];
                } else {
                    matchedParsed =
                        parsedLines[Math.min(i, parsedLines.length - 1)];
                }
            }

            let tokens: LineToken[];
            let signature: string;
            if (matchedParsed && matchedParsed.text === lineText) {
                tokens = matchedParsed.tokens;
                signature = matchedParsed.signature;
            } else {
                const tokenized = tokenizeLine(lineText, matchedParsed?.chars);
                tokens = tokenized.tokens;
                signature = tokenized.signature;
            }

            lineTokensArray[i] = tokens;
            charElements[i] = (
                <CodeLine
                    key={i}
                    lineIndex={i}
                    lineText={lineText}
                    tokens={tokens}
                    signature={signature}
                    hasPlayStart={hasPlayStartButtons}
                    hasNewline={i < numLines - 1}
                    isSelected={selectedLineValue === i}
                    onSelectLine={handleSelectLine}
                    spansByLineRef={spansByLineRef}
                />
            );
        }

        tokensByLineRef.current = lineTokensArray;
        spansByLineRef.current.length = numLines;

        // stop event propagation here so we can detect clicks outside of this element in isolation
        const stopPropagation = (e: Event) => e.stopPropagation();

        const showError = () =>
            revealInCode(document.querySelector("[data-codepane] .hl-error"), errorAt);

        const showWarning = ({ pos, message }: BarWarning) => {
            const el = Array.from(
                document.querySelectorAll<HTMLElement>("[data-codepane] .warn")
            ).find((span) => span.dataset.warn === message);
            revealInCode(el, pos);
        };

        return (
            <Box onClick={stopPropagation}>
                <Codearea
                    {...inputProps}
                    charElements={charElements}
                    freeze={embed}
                    onTextareaClick={handleTextareaClick}
                />
                {error && (
                    <Box>
                        <ErrorMessage
                            onClick={errorAt !== undefined ? showError : undefined}
                            clickable={errorAt !== undefined}
                            title={errorAt !== undefined ? "Show error" : undefined}
                        >
                            Error: {error}
                        </ErrorMessage>
                    </Box>
                )}
                {!error && barWarnings.length > 0 && (
                    <Box>
                        {barWarnings.slice(0, MAX_WARNINGS_SHOWN).map((w) => (
                            <WarningMessage
                                key={w.pos}
                                onClick={() => showWarning(w)}
                                title="Show bar"
                            >
                                Warning: {w.message}
                            </WarningMessage>
                        ))}
                        {barWarnings.length > MAX_WARNINGS_SHOWN && (
                            <WarningMessage as="div">
                                ...and {barWarnings.length - MAX_WARNINGS_SHOWN} more
                            </WarningMessage>
                        )}
                    </Box>
                )}
            </Box>
        );
    });
}

//
// html title
//

type SetHtmlTitleProps = {
    tuneForm: Dendriform<TuneForm>;
};

function SetHtmlTitle(props: SetHtmlTitleProps): React.ReactElement {
    return props.tuneForm.render("tune", (form) => {
        const tune = form.useValue();
        // set title based on code in text area
        const titleLimit = 20;
        const title =
            tune.length === 0
                ? "Xenpaper"
                : tune.length > titleLimit
                ? `Xenpaper: ${tune.slice(0, titleLimit)}...`
                : `Xenpaper: ${tune}`;

        return (
            <Helmet>
                <title>{title}</title>
                <meta property="og:title" content={title} />
            </Helmet>
        );
    });
}

//
//
// styled components
//

const Toolbar = styled(Box)`
    background-color: ${(props) => props.theme.colors.background.normal};
    z-index: 4;
`;

const Hr = styled(Box)`
    border-top: 1px ${(props) => props.theme.colors.background.light} solid;
`;

type SideButtonProps = {
    active?: boolean;
    multiline?: boolean;
};

const SideButton = styled.button<SideButtonProps>`
    border: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 3rem;
    padding: ${(props) => (props.multiline ? ".5rem" : "0 0.5rem")};
    cursor: ${(props) => (props.disabled ? "default" : "pointer")};
    background-color: ${(props) =>
        props.active
            ? props.theme.colors.text.placeholder
            : props.theme.colors.background.normal};
    color: ${(props) =>
        props.disabled
            ? props.theme.colors.highlights.unknown
            : props.active
            ? props.theme.colors.background.normal
            : props.theme.colors.highlights.comment};
    position: relative;
    outline: none;
    font-family: ${(props) => props.theme.fonts.mono};
    font-size: ${(props) => (props.multiline ? "0.8rem" : "0.85rem")};
    text-align: center;
    width: auto;
    text-transform: uppercase;
    border-left: 3px solid transparent;
    flex-shrink: 0;

    ${(props) =>
        !props.active
            ? `&:hover, &:focus, &:active {
        background-color: ${props.theme.colors.background.light};
    }`
            : ``}

    @media all and (min-width: ${(props) => props.theme.widths.sm}) {
        display: block;
        height: auto;
        padding: 0.5rem;
        font-size: ${(props) => (props.multiline ? "0.9rem" : "1.1rem")};
        width: 5rem;
        ${(props) => props.multiline && `line-height: 1em;`}
    }
`;

type EditOnXenpaperButtonProps = {
    multiline?: boolean;
};

const EditOnXenpaperButton = styled.a<EditOnXenpaperButtonProps>`
    border: none;
    height: 3rem;
    line-height: 1rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: ${(props) => (props.multiline ? ".5rem" : "0 0.5rem")};
    cursor: pointer;
    background-color: ${(props) => props.theme.colors.background.normal};
    color: ${(props) => props.theme.colors.highlights.comment};
    position: relative;
    outline: none;
    font-family: ${(props) => props.theme.fonts.mono};
    font-size: ${(props) => (props.multiline ? "0.8rem" : "0.9rem")};
    text-align: center;
    width: auto;
    text-transform: uppercase;
    text-decoration: none;
    flex-shrink: 0;

    &:hover,
    &:focus,
    &:active {
        background-color: ${(props) => props.theme.colors.background.light};
        text-decoration: none;
    }

    margin-left: auto;

    @media all and (min-width: ${(props) => props.theme.widths.sm}) {
        display: block;
        height: 3rem;
        font-size: ${(props) => (props.multiline ? "0.9rem" : "1.1rem")};
        padding: ${(props) => (props.multiline ? ".5rem" : "1rem .5rem")};
        border-left: 3px solid transparent;
        ${(props) => props.multiline && `line-height: 1em;`}
    }
`;
