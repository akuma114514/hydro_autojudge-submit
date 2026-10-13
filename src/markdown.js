'use strict';

const { Marked } = require('./vendor/marked');
const katex = require('./vendor/katex');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function renderMarkdown(content, baseUrl) {
  const markdown = new Marked({ gfm: true, breaks: false });
  const formula = (text, displayMode) => katex.renderToString(text, {
    output: 'mathml', displayMode, throwOnError: false, trust: false,
    strict: 'ignore', maxExpand: 1000
  });
  markdown.use({ extensions: [
    {
      name: 'displayMath', level: 'block',
      start(src) { return src.search(/\$\$|\\\[/); },
      tokenizer(src) {
        const match = /^(?:\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\])(?:\n|$)/.exec(src);
        if (match) return { type: 'displayMath', raw: match[0], text: match[1] ?? match[2] };
      },
      renderer(token) { return `<div class="math-block">${formula(token.text, true)}</div>`; }
    },
    {
      name: 'inlineMath', level: 'inline',
      start(src) { return src.search(/\$|\\\(/); },
      tokenizer(src) {
        const match = /^(?:\$\$([^\n]+?)\$\$|\$(?!\$)((?:\\.|[^$\\\n])+)\$|\\\(([^\n]+?)\\\))/.exec(src);
        if (match) return { type: 'inlineMath', raw: match[0], text: match[1] ?? match[2] ?? match[3], display: Boolean(match[1]) };
      },
      renderer(token) { return formula(token.text, token.display); }
    }
  ] });
  markdown.use({ renderer: {
    // Imported HTML is text; only the parser's own HTML may enter the webview.
    html({ text }) { return escape(text); },
    link({ href, title, tokens }) {
      const label = this.parser.parseInline(tokens);
      try {
        const url = new URL(href, baseUrl);
        if (!['https:', 'http:'].includes(url.protocol)) return label;
        return `<a href="${escape(url.toString())}"${title ? ` title="${escape(title)}"` : ''}>${label}</a>`;
      } catch { return label; }
    },
    image({ href, text }) {
      try {
        const url = new URL(href, baseUrl);
        if (url.protocol === 'https:') return `<img src="${escape(url.toString())}" alt="${escape(text)}" loading="lazy">`;
      } catch { /* Invalid image URL renders as alternate text. */ }
      return escape(text);
    }
  } });
  return markdown.parse(String(content ?? ''));
}

module.exports = { renderMarkdown };
