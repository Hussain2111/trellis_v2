import type { ReactNode } from 'react';

/**
 * A very small markdown renderer, and no dependency for it.
 *
 * The model writes headings, lists and bold. Rendered with `white-space:
 * pre-wrap` those arrive on screen as literal `###` and `**` — the answer is
 * correct and looks like a debug dump. This handles the subset the model
 * actually produces and nothing else.
 *
 * It builds React elements rather than HTML strings, so there is no
 * `dangerouslySetInnerHTML` anywhere and no path from model output to markup.
 * Anything it does not recognise stays as text, which is the safe direction to
 * fail in.
 */
export function Markdown({ text }: { text: string }) {
  return <div className="space-y-3">{renderBlocks(text)}</div>;
}

type Block =
  | { kind: 'heading'; level: 3 | 4; lines: string[] }
  | { kind: 'ul' | 'ol'; lines: string[] }
  | { kind: 'p'; lines: string[] };

function renderBlocks(text: string): ReactNode[] {
  const blocks: Block[] = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();

    if (trimmed === '') {
      blocks.push({ kind: 'p', lines: [] });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    if (heading) {
      // Everything renders at h3/h4 — the page owns h1 and h2, and a model
      // heading is a subsection of an answer, not of the document.
      blocks.push({
        kind: 'heading',
        level: heading[1]!.length <= 3 ? 3 : 4,
        lines: [heading[2]!],
      });
      continue;
    }

    const bullet = /^[-*+]\s+(.*)$/.exec(trimmed);
    const numbered = /^\d+[.)]\s+(.*)$/.exec(trimmed);
    const item = bullet ?? numbered;
    if (item) {
      const kind = bullet ? 'ul' : 'ol';
      const last = blocks[blocks.length - 1];
      if (last && last.kind === kind) last.lines.push(item[1]!);
      else blocks.push({ kind, lines: [item[1]!] });
      continue;
    }

    const last = blocks[blocks.length - 1];
    if (last && last.kind === 'p' && last.lines.length > 0) last.lines.push(trimmed);
    else blocks.push({ kind: 'p', lines: [trimmed] });
  }

  return blocks
    .filter((block) => block.lines.length > 0)
    .map((block, i) => {
      if (block.kind === 'heading') {
        const Tag = block.level === 3 ? 'h3' : 'h4';
        return (
          <Tag key={i} className="text-sm font-semibold text-[--color-ink]">
            {inline(block.lines[0]!)}
          </Tag>
        );
      }
      if (block.kind === 'ul' || block.kind === 'ol') {
        const Tag = block.kind === 'ul' ? 'ul' : 'ol';
        return (
          <Tag
            key={i}
            className={`space-y-1.5 pl-5 ${block.kind === 'ul' ? 'list-disc' : 'list-decimal'} marker:text-[--color-ink-faint]`}
          >
            {block.lines.map((line, j) => (
              <li key={j}>{inline(line)}</li>
            ))}
          </Tag>
        );
      }
      return <p key={i}>{block.lines.map((line) => inline(line))}</p>;
    });
}

/** Bold, and links — including bare URLs, which is how permalinks arrive. */
const INLINE = /(\*\*[^*]+\*\*)|(\[[^\]]+\]\((https?:\/\/[^)\s]+)\))|(https?:\/\/[^\s)]+)/g;

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of text.matchAll(INLINE)) {
    const start = match.index;
    if (start > cursor) out.push(text.slice(cursor, start));
    cursor = start + match[0].length;

    if (match[1]) {
      out.push(
        <strong key={key++} className="font-semibold">
          {match[1].slice(2, -2)}
        </strong>,
      );
    } else if (match[2]) {
      const label = match[2].slice(1, match[2].indexOf(']'));
      out.push(<ExternalLink key={key++} href={match[3]!} label={label} />);
    } else if (match[4]) {
      out.push(<ExternalLink key={key++} href={match[4]} label="View post" />);
    }
  }

  if (cursor < text.length) out.push(text.slice(cursor));
  return out;
}

function ExternalLink({ href, label }: { href: string; label: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex items-center rounded-full bg-[--color-accent-soft] px-2 py-0.5 text-xs font-medium text-[--color-ink] no-underline"
    >
      {label} ↗
    </a>
  );
}
