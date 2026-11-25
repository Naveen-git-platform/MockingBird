const test = require('node:test');
const assert = require('node:assert/strict');
const { render, escapeHtml } = require('../src/renderer/markdown');

test('escapeHtml escapes the five dangerous characters', () => {
  assert.equal(escapeHtml(`<a href="x">&'</a>`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('paragraphs, line breaks and inline styles', () => {
  assert.equal(render('Hello **bold** and *it* and _it2_ and `code`'), '<p>Hello <strong>bold</strong> and <em>it</em> and <em>it2</em> and <code>code</code></p>');
  assert.equal(render('line one\nline two'), '<p>line one<br>line two</p>');
  assert.equal(render('a\n\nb'), '<p>a</p>\n<p>b</p>');
  assert.equal(render(''), '');
  assert.equal(render(null), '');
});

test('snake_case and math-like asterisks are left alone', () => {
  assert.equal(render('use my_var_name here'), '<p>use my_var_name here</p>');
  assert.equal(render('2 * 3 * 4'), '<p>2 * 3 * 4</p>');
});

test('headings shift down one level so h1 stays the page title', () => {
  assert.equal(render('# Title'), '<h2>Title</h2>');
  assert.equal(render('### Deep ###'), '<h4>Deep</h4>');
  assert.equal(render('###### Max'), '<h6>Max</h6>');
});

test('lists, quotes and rules', () => {
  assert.equal(render('- a\n- b'), '<ul><li>a</li><li>b</li></ul>');
  assert.equal(render('1. one\n2) two'), '<ol><li>one</li><li>two</li></ol>');
  assert.equal(render('> quoted **x**'), '<blockquote><p>quoted <strong>x</strong></p></blockquote>');
  assert.equal(render('---'), '<hr>');
});

test('fenced code is escaped, labelled and gets a copy button', () => {
  const html = render('```python\nif a < b:\n    print("<hi>")\n```');
  assert.match(html, /<pre class="code">/);
  assert.match(html, /<span>python<\/span>/);
  assert.match(html, /data-copy/);
  assert.match(html, /if a &lt; b:\n    print\(&quot;&lt;hi&gt;&quot;\)/);
  assert.doesNotMatch(html, /<hi>/);
});

test('markdown inside code blocks is not interpreted', () => {
  const html = render('```\n**not bold** # not heading\n```');
  assert.match(html, /\*\*not bold\*\* # not heading/);
  assert.doesNotMatch(html, /<strong>|<h2>/);
});

test('an unclosed fence (mid-stream) renders as code to the end', () => {
  const html = render('Intro\n```js\nconst x = 1;');
  assert.match(html, /<p>Intro<\/p>/);
  assert.match(html, /<code>const x = 1;<\/code>/);
});

test('longer fences can contain shorter ones', () => {
  const html = render('````\n```inner```\n````');
  assert.match(html, /<code>```inner```<\/code>/);
});

test('unusual language tags are not echoed as markup', () => {
  const html = render('```"><script>alert(1)</script>\ncode\n```');
  assert.doesNotMatch(html, /<script/);
});

test('tables render header and rows', () => {
  const html = render('| Name | Big-O |\n|---|---|\n| sort | n log n |\n| scan | **n** |');
  assert.match(html, /<th>Name<\/th><th>Big-O<\/th>/);
  assert.match(html, /<td>sort<\/td><td>n log n<\/td>/);
  assert.match(html, /<td><strong>n<\/strong><\/td>/);
});

test('XSS: raw HTML is escaped everywhere', () => {
  for (const payload of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '"><svg onload=alert(1)>', '**<b onmouseover=x>**']) {
    const html = render(payload);
    assert.doesNotMatch(html, /<script|<img|<svg|<b /i, payload);
  }
  assert.match(render('- <script>x</script>'), /&lt;script&gt;/);
  assert.match(render('| <i>a</i> | b |\n|---|---|\n| <u>c</u> | d |'), /&lt;i&gt;a/);
});

test('XSS: only http, https and mailto links are linked', () => {
  assert.match(render('[ok](https://example.com/a?b=1&c=2)'), /<a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">ok<\/a>/);
  assert.match(render('[mail](mailto:a@b.co)'), /href="mailto:a@b\.co"/);
  for (const href of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html;base64,AAAA', 'vbscript:x', '//evil.com']) {
    const html = render(`[x](${href})`);
    assert.doesNotMatch(html, /<a /, href);
  }
});

test('XSS: link URLs cannot break out of the href attribute', () => {
  const html = render('[x](https://a.com/"onmouseover="alert(1))');
  assert.doesNotMatch(html, /onmouseover="/);
});

test('inline code protects its contents from other inline rules', () => {
  assert.equal(render('`**x** [a](https://b.c)`'), '<p><code>**x** [a](https://b.c)</code></p>');
});
