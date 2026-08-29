"use client";

import { useMemo, useState, useCallback } from "react";
import DOMPurify from "isomorphic-dompurify";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeRaw from "rehype-raw";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import CodeViewerModal from "@/components/CodeViewerModal";

interface ProblemStatementViewProps {
  content?: string | null;
  className?: string;
}

const DOMPURIFY_CONFIG = {
  ADD_TAGS: [
    "iframe",
    "video",
    "math",
    "annotation",
    "semantics",
    "mtext",
    "mn",
    "mo",
    "mi",
    "mspace",
    "mover",
    "munder",
    "munderover",
    "msup",
    "msub",
    "msubsup",
    "mfrac",
    "mroot",
    "msqrt",
    "mtable",
    "mtr",
    "mtd",
    "span",
    "div",
    "p",
    "table",
    "thead",
    "tbody",
    "tr",
    "th",
    "td",
    "img",
    "details",
    "summary",
    "kbd",
    "picture",
    "figure",
    "figcaption",
    "sub",
    "sup",
  ],
  ADD_ATTR: [
    "target",
    "rel",
    "allow",
    "allowfullscreen",
    "frameborder",
    "scrolling",
    "class",
    "style",
    "src",
    "alt",
    "href",
    "title",
    "align",
    "border",
  ],
};

export default function ProblemStatementView({
  content,
  className = "",
}: ProblemStatementViewProps) {
  const [playgroundUrl, setPlaygroundUrl] = useState<string | null>(null);

  // Sanitize content with DOMPurify — but preserve code blocks untouched.
  // DOMPurify strips <bits/stdc++.h> and <int> from code blocks because it
  // sees them as HTML tags. We split on fenced code blocks, sanitize only
  // the prose parts, then rejoin.
  const sanitizedContent = useMemo(() => {
    if (!content) return "";
    const parts = content.split(/(```[\s\S]*?```)/g);
    const sanitized = parts.map((part, i) => {
      if (i % 2 === 1) return part;
      return DOMPurify.sanitize(part, DOMPURIFY_CONFIG);
    });
    return sanitized.join("");
  }, [content]);

  // Intercept clicks on "View Implementation Code" links (LeetCode playgrounds)
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const anchor = target.closest("a");
    if (!anchor) return;

    const href = anchor.getAttribute("href") || "";
    if (href.includes("leetcode.com/playground/")) {
      e.preventDefault();
      setPlaygroundUrl(href);
    }
  }, []);

  if (!sanitizedContent) {
    return null;
  }

  return (
    <>
      <div
        className={`markdown-body ${className}`}
        onClick={handleClick}
        style={{
          fontSize: 13,
          color: "var(--text-secondary)",
          lineHeight: 1.8,
        }}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMath]}
          rehypePlugins={[rehypeRaw, rehypeKatex]}
        >
          {sanitizedContent}
        </ReactMarkdown>
      </div>
      <CodeViewerModal url={playgroundUrl} onClose={() => setPlaygroundUrl(null)} />
    </>
  );
}
