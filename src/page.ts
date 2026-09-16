// src/page.ts —— 管理页前端（一页原生 JS，无构建步骤）。
// 从 /g/<token> 路径提取 token：入页即"登录"（token 即凭据），API 调用带上它。

export function pageHtml(token: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>知识库</title>
<style>
  :root {
    --bg: #fafafa; --card: #ffffff; --ink: #1a1d26; --sub: #8a8f9e;
    --line: #ececf1; --accent: #4f6ef7; --accent-soft: #eef1fe;
    --danger: #e5484d; --radius: 14px;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC",
                 "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
    background: var(--bg); color: var(--ink); min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 720px; margin: 0 auto; padding: 32px 20px 48px; }

  header { display: flex; align-items: center; gap: 12px; margin-bottom: 24px; }
  .logo {
    width: 36px; height: 36px; border-radius: 10px; background: var(--accent-soft);
    display: flex; align-items: center; justify-content: center; font-size: 18px;
  }
  h1 { font-size: 17px; font-weight: 600; letter-spacing: .2px; }
  .spacer { flex: 1; }
  .iconbtn {
    border: 0; background: transparent; color: var(--sub); cursor: pointer;
    width: 32px; height: 32px; border-radius: 8px; font-size: 15px;
    display: flex; align-items: center; justify-content: center; transition: all .15s;
  }
  .iconbtn:hover { background: var(--line); color: var(--ink); }

  #drop {
    border: 1.5px dashed #d4d7e0; border-radius: var(--radius); padding: 34px 20px;
    text-align: center; color: var(--sub); background: var(--card);
    transition: all .15s; margin-bottom: 14px; font-size: 14px;
  }
  #drop.over { border-color: var(--accent); background: var(--accent-soft); color: var(--accent); }
  #drop .btn { margin: 10px 0 6px; }
  #drop small { display: block; font-size: 12px; opacity: .8; }

  .btn {
    border: 0; border-radius: 9px; padding: 9px 18px; font-size: 14px; cursor: pointer;
    background: var(--accent); color: #fff; font-weight: 500; transition: opacity .15s;
  }
  .btn:hover { opacity: .88; }

  .card {
    background: var(--card); border-radius: var(--radius); overflow: hidden;
    border: 1px solid var(--line);
  }
  table { width: 100%; border-collapse: collapse; }
  th {
    text-align: left; padding: 12px 16px; font-size: 12px; font-weight: 500;
    color: var(--sub); border-bottom: 1px solid var(--line);
    text-transform: uppercase; letter-spacing: .4px;
  }
  td { padding: 13px 16px; font-size: 14px; border-bottom: 1px solid var(--line); }
  tr:last-child td { border-bottom: 0; }
  tr.row:hover td { background: #f7f8fb; }
  .name { font-weight: 500; word-break: break-all; line-height: 1.45; }
  .size, .time { color: var(--sub); font-size: 13px; white-space: nowrap; }
  .act { white-space: nowrap; text-align: right; }
  .act a, .act button {
    display: inline-flex; align-items: center; justify-content: center;
    width: 30px; height: 30px; border-radius: 8px; font-size: 14px;
    text-decoration: none; transition: all .15s; margin-left: 4px;
  }
  .act a { color: var(--sub); }
  .act a:hover { background: var(--accent-soft); color: var(--accent); }
  .act button { border: 0; background: transparent; color: var(--sub); cursor: pointer; }
  .act button:hover { background: #fdeaea; color: var(--danger); }

  #empty { text-align: center; color: var(--sub); padding: 48px 0 52px; font-size: 14px; }
  #empty .big { font-size: 34px; margin-bottom: 12px; opacity: .5; }

  #toast {
    position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%) translateY(8px);
    background: #26282f; color: #fff; padding: 10px 20px; border-radius: 10px;
    font-size: 13.5px; opacity: 0; transition: all .25s; pointer-events: none;
    box-shadow: 0 8px 24px rgba(0,0,0,.18); max-width: 86vw;
  }
  #toast.show { opacity: .96; transform: translateX(-50%) translateY(0); }

  @media (max-width: 560px) {
    .time-col { display: none; }
    .wrap { padding: 20px 14px 40px; }
  }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <div class="logo">📚</div>
    <h1>知识库</h1>
    <div class="spacer"></div>
    <button class="iconbtn" title="刷新" onclick="refresh()">⟳</button>
  </header>

  <div id="drop">
    拖拽文件到此处，或
    <br><button class="btn" onclick="document.getElementById('file').click()">选择文件</button>
    <small>支持多选 · 单文件上限 200MB</small>
    <input type="file" id="file" multiple hidden>
  </div>

  <div class="card">
    <table style="display:none" id="tbl">
      <thead><tr><th>文件</th><th style="width:90px">大小</th><th class="time-col" style="width:150px">上传时间</th><th style="width:86px"></th></tr></thead>
      <tbody id="rows"></tbody>
    </table>
    <div id="empty">
      <div class="big">🗂️</div>
      还没有文档<br>上传的文件会出现在这里
    </div>
  </div>
</div>
<div id="toast"></div>

<script>
const TOKEN = location.pathname.match(/g\\/([A-Za-z0-9_-]{16,})/)?.[1] || localStorage.getItem("kb_token") || "";
const BASE = location.pathname.match(/^(.*g\\/[A-Za-z0-9_-]{16,})/)?.[1] || "/g/" + TOKEN;
if (TOKEN) try { localStorage.setItem("kb_token", TOKEN); } catch (e) {}
const H = { "Authorization": "Bearer " + TOKEN };

function toast(msg, ok = true) {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.style.background = ok ? "#26282f" : "#c02929";
  t.classList.add("show");
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove("show"), 2400);
}

function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

async function refresh() {
  const r = await fetch(BASE + "/api/entries", { headers: H });
  if (!r.ok) { toast("加载失败，请刷新重试", false); return; }
  const { entries } = await r.json();
  const rows = document.getElementById("rows");
  const tbl = document.getElementById("tbl");
  const empty = document.getElementById("empty");
  rows.innerHTML = "";
  tbl.style.display = entries.length ? "" : "none";
  empty.style.display = entries.length ? "none" : "";
  for (const e of entries) {
    const tr = document.createElement("tr");
    tr.className = "row";
    tr.innerHTML =
      '<td><div class="name"></div></td>' +
      '<td class="size"></td><td class="time time-col"></td>' +
      '<td class="act"><a href="#" title="下载">⬇</a><button title="删除">✕</button></td>';
    tr.querySelector(".name").textContent = e.filename;
    tr.cells[1].textContent = fmtSize(e.size);
    tr.cells[2].textContent = e.created_at;
    const a = tr.querySelector("a");
    a.href = BASE + "/files/" + e.id;
    tr.querySelector("button").onclick = () => del(e.id, e.filename);
    rows.appendChild(tr);
  }
}

async function upload(files) {
  if (!files.length) return;
  let ok = 0;
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch(BASE + "/api/entries", { method: "POST", headers: H, body: fd });
    if (r.ok) ok++;
    else {
      const err = await r.json().catch(() => ({}));
      toast("「" + f.name + "」上传失败：" + (err.error || r.status), false);
    }
  }
  if (ok) toast("已上传 " + ok + " 个文件");
  refresh();
}

async function del(id, name) {
  if (!confirm("删除「" + name + "」？此操作不可恢复。")) return;
  // 标准 DELETE 优先；网关不放行 DELETE 时回落到 POST 兼容端点（见 web.ts）
  let r = await fetch(BASE + "/api/entries/" + id, { method: "DELETE", headers: H });
  if (r.status === 404 || r.status === 405) {
    r = await fetch(BASE + "/api/entries/" + id + "/delete", { method: "POST", headers: H });
  }
  if (!r.ok) { toast("删除失败", false); return; }
  toast("已删除");
  refresh();
}

document.getElementById("file").onchange = e => { upload(e.target.files); e.target.value = ""; };
const drop = document.getElementById("drop");
drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); };
drop.ondragleave = () => drop.classList.remove("over");
drop.ondrop = e => {
  e.preventDefault();
  drop.classList.remove("over");
  upload(e.dataTransfer.files);
};

if (!TOKEN) { toast("链接无效，请重新从 QQ 获取", false); }
else refresh();
</script>
</body>
</html>`;
}
