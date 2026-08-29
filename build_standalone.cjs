const fs = require('fs');
const path = require('path');

const ROOT = '/workspace/public';
const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
const ai = fs.readFileSync(path.join(ROOT, 'js/ai.js'), 'utf8');
const app = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// Escape any literal </script> inside JS strings to <\/script>
function escapeClosingScript(src) {
  return src.replace(/<\/script>/g, '<\\/script>');
}

// Extract index.html's <head> children except external <link rel=stylesheet> (we inline)
// Extract <body> children except external <script defer> (we inline)
function extractHead(htmlStr) {
  const m = htmlStr.match(/<head>([\s\S]*?)<\/head>/i);
  if (!m) return '';
  let head = m[1];
  // Remove css <link rel=stylesheet href="css/style.css" />
  head = head.replace(/<link\b[^>]*rel=["']stylesheet["'][^>]*>/gi, '');
  // Remove script defer tags (socket.io / ai.js / app.js) — just in case, also below
  head = head.replace(/<script\b[^>]*defer[^>]*><\/script>/gi, '');
  return head.trim();
}

function extractBody(htmlStr) {
  const m = htmlStr.match(/<body>([\s\S]*?)<\/body>/i);
  if (!m) return '';
  let body = m[1];
  // Remove external defer scripts
  body = body.replace(/<script\b[^>]*src=["'][^"']+["'][^>]*>(<\/script>)?/gi, '');
  return body.trim();
}

const headContent = extractHead(html);
const bodyContent = extractBody(html);

// Standalone bootstrap: MOON_CHESS_STANDALONE flag + fake io + online tip dialog
const bootstrap = `
window.MOON_CHESS_STANDALONE = true;
if (typeof window.io !== "function") {
  window.io = function(){ return { on(){}, emit(){}, disconnect(){} }; };
}
window.__moon_chess_showOnlineTip = function() {
  var TIP_ID = '__mc_online_tip_v3__';
  if (document.getElementById(TIP_ID)) return;
  var wrap = document.createElement('div');
  wrap.id = TIP_ID;
  wrap.style.cssText = 'position:fixed;inset:0;background:rgba(4,6,15,.92);z-index:999999;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif';
  var dialog = document.createElement('div');
  dialog.style.cssText = 'max-width:440px;background:linear-gradient(180deg,rgba(26,10,64,.96),rgba(10,15,34,.98));border:1px solid rgba(199,125,255,.28);border-radius:18px;padding:24px;box-shadow:0 20px 80px rgba(0,0,0,.7),0 0 60px rgba(157,78,221,.25)';
  var h3 = document.createElement('h3');
  h3.textContent = '联机对战提示';
  h3.style.cssText = 'margin:0 0 10px;font-size:18px;letter-spacing:2px;background:linear-gradient(90deg,#c77dff,#4cc9f0);-webkit-background-clip:text;background-clip:text;color:transparent';
  var p = document.createElement('p');
  p.innerHTML = '当前是纯静态分享版本，<b style="color:#4cc9f0">单机对战（含三档 AI、慢速思考+预选提示、消失闪烁、重开确认、横幅结果、响应式）全部正常</b>。联机对战（房间邀请制、实时同步）需要部署 Node WebSocket 服务端。';
  p.style.cssText = 'color:#cdd5ff;line-height:1.8;font-size:13px;margin:0 0 14px';
  var pre = document.createElement('pre');
  pre.style.cssText = 'background:#05070f;color:#8dd;font-size:11px;padding:10px 12px;border-radius:10px;overflow:auto;margin:0 0 14px';
  pre.textContent = '【推荐 Koyeb 免费层一键部署（无需绑卡）】\\nhttps://app.koyeb.com/apps/deploy?type=git&repository=github.com/Warpeas/moon-chess&branch=main&builder=dockerfile&ports=3000;http;/&name=moon-chess\\n\\n【Docker 自托管】\\ndocker build -t moon-chess . && docker run -p 3000:3000 moon-chess';
  var btn = document.createElement('button');
  btn.textContent = '知道了';
  btn.style.cssText = 'width:100%;padding:10px;border-radius:999px;background:linear-gradient(135deg,#7b2cbf,#c77dff);color:#fff;border:0;font-weight:600;letter-spacing:2px;cursor:pointer';
  btn.onclick = function(){ wrap.remove(); };
  dialog.appendChild(h3); dialog.appendChild(p); dialog.appendChild(pre); dialog.appendChild(btn);
  wrap.appendChild(dialog);
  document.body.appendChild(wrap);
};
`.trim();

const finalHtml = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
${headContent}
  <style>
${css}
  </style>
</head>
<body>
${bodyContent}
  <script>
${escapeClosingScript(bootstrap)}
  <\/script>
  <script>
${escapeClosingScript(ai)}
  <\/script>
  <script>
${escapeClosingScript(app)}
  <\/script>
</body>
</html>
`;

const out = path.join(ROOT, 'moon-chess-standalone.html');
fs.writeFileSync(out, finalHtml, 'utf8');
console.log('✓ Standalone built:', out, (fs.statSync(out).size / 1024).toFixed(1), 'KB');

// Quick sanity checks
const checks = [
  ['.preview-move', /preview-move/],
  ['end-banner', /end-banner/],
  ['confirm-dialog', /confirm-dialog/],
  ['marked-to-remove', /marked-to-remove/],
  ['AI scheduleAiMove', /scheduleAiMove/],
  ['showConfirm handleRestart local', /showConfirm\(\s*\{/],
  ['hideRematchBar() local in render', /this\.mode === 'local'\)\s*\{\s*this\.hideRematchBar/],
  ['fading class', /fading/],
];
for (const [name, re] of checks) {
  console.log(re.test(finalHtml) ? '  ✓ ' + name : '  ✗ MISSING: ' + name);
}
