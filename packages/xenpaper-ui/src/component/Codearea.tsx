import React, {useCallback} from 'react';
import styled, {keyframes} from 'styled-components';
import {Text} from '../component/Text';
import {textStyle, typography} from 'styled-system';

type Props = {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    charElements: React.ReactNode;
    freeze: boolean;
    onTextareaClick?: (e: React.MouseEvent<HTMLTextAreaElement>) => void;
};

export const Codearea = (props: Props): React.ReactElement => {
    const {value, onChange, charElements, freeze, onTextareaClick} = props;

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if ((e.ctrlKey || e.metaKey) && e.key === '/') {
            e.preventDefault();
            const ta = e.currentTarget;
            const selStart = ta.selectionStart;
            const selEnd = ta.selectionEnd;
            const lineStart = value.lastIndexOf('\n', selStart - 1) + 1;
            const effectiveEnd = selEnd > selStart && value[selEnd - 1] === '\n' ? selEnd - 1 : selEnd;
            const nextNl = value.indexOf('\n', effectiveEnd);
            const blockEnd = nextNl === -1 ? value.length : nextNl;
            const lines = value.slice(lineStart, blockEnd).split('\n');

            const shouldUncomment =
                lines.some(l => /^\s*#/.test(l)) &&
                lines.every(l => l.trim().length === 0 || /^\s*#/.test(l));

            let firstDelta = 0;
            let totalDelta = 0;
            const newLines = lines.map((line, idx) => {
                const updated = shouldUncomment
                    ? line.replace(/^(\s*)# ?/, '$1')
                    : `# ${line}`;
                const d = updated.length - line.length;
                if (idx === 0) firstDelta = d;
                totalDelta += d;
                return updated;
            });

            const nextValue =
                value.slice(0, lineStart) + newLines.join('\n') + value.slice(blockEnd);
            const nextStart =
                selStart === lineStart && selEnd > selStart
                    ? selStart
                    : Math.max(lineStart, selStart + firstDelta);
            const nextEnd = Math.max(nextStart, selEnd + totalDelta);

            onChange({target: {value: nextValue}} as React.ChangeEvent<HTMLTextAreaElement>);
            requestAnimationFrame(() => {
                ta.setSelectionRange(nextStart, nextEnd);
            });
        }
    }, [value, onChange]);

    const content = value === ''
        ? <Text color="text.placeholder" style={{fontStyle: "italic"}}>
            Type your tune here
            <br /><br />
        </Text>
        : <>{charElements}<br /><br /></>;

    return <Outer fontSize={["1.1rem", "1.4rem"]} disabled={freeze}>
        <Inner>
            <Textarea
                value={value}
                onChange={onChange}
                onKeyDown={handleKeyDown}
                onClick={onTextareaClick}
                autoCapitalize="off"
                autoComplete="off"
                autoCorrect="off"
                spellCheck="false"
                disabled={freeze}
            />
            <Highlight aria-hidden="true" freeze={freeze}>{content}</Highlight>
        </Inner>
    </Outer>;
};

type OuterProps = {
    fontSize: unknown;
    disabled: boolean;
};

const Outer = styled.div<OuterProps>`
    height: 100%;
    overflow: auto;
    ${textStyle}
    ${typography}
    line-height: 1.4em;
    position: relative;

    &:before {
        content: "";
        display: block;
        width: 3px;
        height: 4rem;
        background-color: transparent;
        transition: background-color .2s ease-out;
        position: absolute;
        top: 12px;
    }

    &:focus-within {
        &:before {
            background-color: ${props => props.theme.colors.focus};
        }
    }

    ${props => props.disabled ? `
        cursor: default;
        user-select: none;
        pointer-events: none;
    ` : ''}
`;

const Inner = styled.div`
    position: relative;
    text-align: left;
    box-sizing: border-box;
    padding: 0px;
    overflow: hidden;
    font-variant-ligatures: common-ligatures;
    min-height: 100%;
`;

const Textarea = styled.textarea`
    margin: 0;
    border: 0;
    background: none;
    box-sizing: inherit;
    display: inherit;
    font-family: inherit;
    font-size: inherit;
    font-style: inherit;
    font-variant-ligatures: inherit;
    font-weight: inherit;
    letter-spacing: inherit;
    line-height: inherit;
    tab-size: inherit;
    text-indent: inherit;
    text-rendering: inherit;
    text-transform: inherit;
    white-space: pre-wrap;
    word-break: keep-all;
    overflow-wrap: break-word;
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    width: 100%;
    resize: none;
    color: inherit;
    overflow: hidden;
    -webkit-text-fill-color: transparent;
    -webkit-font-smoothing: antialiased;
    padding: 1rem 1rem 1rem 2rem;
    outline: 0;

    &::selection {
        background: #22cece;
    }

    &:disabled {
        user-select: none;
        opacity: 0;
    }
`;

const flashAnim = keyframes`
    0%, 100% {
        background-color: transparent;
    }
    25%, 75% {
        background-color: rgba(255, 255, 255, 0.35);
    }
`;

type HighlightProps = {
    freeze: boolean;
};

const Highlight = styled.pre<HighlightProps>`
    margin: 0px;
    border: 0px;
    background: none;
    box-sizing: inherit;
    display: inherit;
    font-family: inherit;
    font-size: inherit;
    font-style: inherit;
    font-variant-ligatures: inherit;
    font-weight: inherit;
    letter-spacing: inherit;
    line-height: inherit;
    tab-size: inherit;
    text-indent: inherit;
    text-rendering: inherit;
    text-transform: inherit;
    white-space: pre-wrap;
    word-break: keep-all;
    overflow-wrap: break-word;
    position: relative;
    pointer-events: ${props => props.freeze ? 'auto' : 'none'};
    padding: 1rem 1rem 1rem 2rem;
    user-select: none;

    .char {
        color: ${props => props.theme.colors.highlights.unknown};
        transition: color 0.2s 0s ease-out;
    }
    .char.hl-delimiter { color: ${props => props.theme.colors.highlights.delimiter}; }
    .char.hl-pitch { color: ${props => props.theme.colors.highlights.pitch}; }
    .char.hl-chord { color: ${props => props.theme.colors.highlights.chord}; }
    .char.hl-percussion { color: ${props => props.theme.colors.highlights.percussion}; }
    .char.hl-setterGroup { color: ${props => props.theme.colors.highlights.setterGroup}; }
    .char.hl-setter { color: ${props => props.theme.colors.highlights.setter}; }
    .char.hl-scaleGroup { color: ${props => props.theme.colors.highlights.scaleGroup}; }
    .char.hl-scale { color: ${props => props.theme.colors.highlights.scale}; }
    .char.hl-comment { color: ${props => props.theme.colors.highlights.comment}; }
    .char.hl-commentStart { color: ${props => props.theme.colors.highlights.commentStart}; }
    .char.hl-unknown { color: ${props => props.theme.colors.highlights.unknown}; }
    .char.hl-error {
        color: ${props => props.theme.colors.highlights.error};
        transition: color 0.2s 0.5s ease-out;
    }
    .char.hl-errorMessage { color: ${props => props.theme.colors.highlights.errorMessage}; }
    .char.warn {
        color: #e6c229;
        text-decoration: underline wavy #e6c229;
    }
    .char.flash {
        animation: ${flashAnim} 0.9s ease-in-out;
        border-radius: 2px;
    }
    .char.active {
        transition: color 0s 0s linear;
        color: #fff;
    }
    .play-start {
        position: absolute;
        left: 0.8rem;
        border: none;
        display: block;
        cursor: pointer;
        color: ${props => props.theme.colors.text.placeholder};
        outline: none;
        opacity: 0.2;
        pointer-events: auto;
        transition: opacity 0.2s ease-out;

        &:hover,
        &:focus,
        &:active {
            opacity: 1;
        }
    }
    .play-start.selected {
        opacity: 1;
    }
`;
