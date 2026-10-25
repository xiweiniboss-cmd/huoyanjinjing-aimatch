// 火眼金睛 · Cloudflare Pages 真锁 Worker
// 根目录放 _worker.js：/admin 走这里验签，其余走 env.ASSETS 静态资源
// 真锁原理：后台密码只存在 Cloudflare Pages 环境变量 HYJJ_ADMIN_KEY 里，
// 绝不写进仓库、绝不写进前端页面。登录成功后服务器发一个 HMAC 签名 Cookie，
// 每次进 /admin 都在服务器端验签，密码本身从不发给浏览器、也不存在 Cookie 里。
// 未配置 HYJJ_ADMIN_KEY 时 /admin 只显示配置指引，不放行。
// Pages 项目设置：Framework 预设选 None，构建命令留空，构建输出目录留空/根目录，
// 然后在 设置 → 环境变量 里添加 HYJJ_ADMIN_KEY，值就是你的后台密码，重新部署生效。

const COOKIE = 'hyjj_admin';
const MAX_AGE = 24 * 3600;

function getKey(env) {
  return env.HYJJ_ADMIN_KEY || env.ADMIN_KEY || '';
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
async function hmacHex(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
async function validCookie(request, env) {
  const key = getKey(env);
  if (!key) return false;
  const token = parseCookies(request.headers.get('Cookie'))[COOKIE];
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const expect = await hmacHex(key, exp);
  return sig === expect;
}
function loginPage(msg) {
  return new Response(
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>后台管理 · 火眼金睛</title><style>body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:linear-gradient(180deg,#fff0f5,#eef7ff);color:#222}.w{max-width:420px;margin:80px auto;padding:20px}.c{background:#fff;border-radius:16px;padding:22px;box-shadow:0 2px 12px rgba(0,0,0,.08)}input{width:100%;padding:12px;border:1px solid #ddd;border-radius:10px;font-size:16px;box-sizing:border-box}button{border:0;border-radius:999px;padding:12px 20px;background:#ff6b9d;color:#fff;font-size:16px;font-weight:700;cursor:pointer;width:100%;margin-top:12px}.e{color:#e11d48;font-size:14px;min-height:20px}.s{color:#666;font-size:13px;line-height:1.7}</style></head><body><div class="w"><div class="c"><h2>🔐 后台管理</h2><p class="s">请输入后台密码，服务器验证通过后才能进入抽题测试。</p><form method="POST" action="/api/admin/login"><input type="password" name="password" placeholder="后台密码" autofocus><button type="submit">进入后台</button></form><p class="e">${esc(msg || '')}</p><p class="s"><a href="/">← 回首页</a></p></div></div></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const isAdminPage = path === '/admin' || path === '/admin/' || path === '/admin/index.html';

    if (path === '/api/admin/login' && request.method === 'POST') {
      const key = getKey(env);
      if (!key) return loginPage('未配置管理密码：请在 Cloudflare Pages 项目 → 设置 → 环境变量里添加 HYJJ_ADMIN_KEY，重新部署后再试。');
      let pw = '';
      const ct = request.headers.get('Content-Type') || '';
      try {
        if (ct.includes('application/json')) {
          pw = (await request.json()).password || '';
        } else {
          pw = (await request.formData()).get('password') || '';
        }
      } catch {}
      if (pw !== key) return loginPage('密码不对，再试一次。');
      const exp = String(Math.floor(Date.now() / 1000) + MAX_AGE);
      const sig = await hmacHex(key, exp);
      const token = `${exp}.${sig}`;
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/admin',
          'Set-Cookie': `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/admin; Max-Age=${MAX_AGE}`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (path === '/api/admin/logout') {
      return new Response(null, {
        status: 302,
        headers: {
          Location: '/admin',
          'Set-Cookie': `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/admin; Max-Age=0`,
          'Cache-Control': 'no-store',
        },
      });
    }

    if (isAdminPage) {
      if (!getKey(env)) return loginPage('未配置管理密码：请在 Cloudflare Pages 项目 → 设置 → 环境变量里添加 HYJJ_ADMIN_KEY，值就是你的后台密码，重新部署后再试。');
      if (!(await validCookie(request, env))) return loginPage('');
      // 已验签：把 /admin 映射到静态 admin/index.html
      const target = new URL('/admin/index.html', url.origin);
      return env.ASSETS.fetch(new Request(target, request));
    }

    if (env.ASSETS && typeof env.ASSETS.fetch === 'function') {
      return env.ASSETS.fetch(request);
    }
    return new Response('静态资源未配置', { status: 500 });
  },
};
