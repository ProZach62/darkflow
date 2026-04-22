function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeUrl(url) {
  const trimmed = String(url || '').trim();
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  return '';
}

function applyInline(text) {
  const escaped = escapeHtml(text);
  const codeChunks = [];
  let html = escaped.replace(/`([^`]+)`/g, function(_match, code) {
    const token = '__DW_CODE_' + codeChunks.length + '__';
    codeChunks.push('<code>' + code + '</code>');
    return token;
  });

  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function(_match, label, url) {
    const safeUrl = sanitizeUrl(url);
    if (!safeUrl) return label;
    return '<a href="' + escapeHtml(safeUrl) + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  });
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  for (let i = 0; i < codeChunks.length; i++) {
    html = html.replace('__DW_CODE_' + i + '__', codeChunks[i]);
  }

  return html;
}

export function renderAnnouncementMarkdown(markdown) {
  const source = String(markdown || '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n');
  const html = [];
  let paragraph = [];
  let quote = [];
  let listType = null;
  let codeFence = false;
  let codeLines = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    html.push('<p>' + applyInline(paragraph.join(' ')) + '</p>');
    paragraph = [];
  }

  function flushQuote() {
    if (!quote.length) return;
    html.push('<blockquote><p>' + quote.map(line => applyInline(line)).join('<br>') + '</p></blockquote>');
    quote = [];
  }

  function closeList() {
    if (!listType) return;
    html.push('</' + listType + '>');
    listType = null;
  }

  function flushCode() {
    if (!codeFence) return;
    html.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
    codeFence = false;
    codeLines = [];
  }

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    if (codeFence) {
      if (/^```/.test(trimmed)) {
        flushCode();
      } else {
        codeLines.push(rawLine);
      }
      continue;
    }

    if (/^```/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      closeList();
      codeFence = true;
      codeLines = [];
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushQuote();
      closeList();
      continue;
    }

    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      closeList();
      html.push('<hr>');
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushParagraph();
      flushQuote();
      closeList();
      const level = heading[1].length;
      html.push('<h' + level + '>' + applyInline(heading[2]) + '</h' + level + '>');
      continue;
    }

    const unordered = rawLine.match(/^\s*[-*]\s+(.*)$/);
    const ordered = rawLine.match(/^\s*\d+\.\s+(.*)$/);
    if (unordered || ordered) {
      flushParagraph();
      flushQuote();
      const nextType = unordered ? 'ul' : 'ol';
      if (listType !== nextType) {
        closeList();
        html.push('<' + nextType + '>');
        listType = nextType;
      }
      html.push('<li>' + applyInline((unordered || ordered)[1]) + '</li>');
      continue;
    }

    if (/^\s*>/.test(rawLine)) {
      flushParagraph();
      closeList();
      quote.push(rawLine.replace(/^\s*>\s?/, ''));
      continue;
    }

    flushQuote();
    closeList();
    paragraph.push(trimmed);
  }

  flushParagraph();
  flushQuote();
  closeList();
  flushCode();

  return html.join('');
}
