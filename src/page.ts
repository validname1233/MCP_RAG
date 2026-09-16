// src/page.ts —— 管理页前端（一页原生 JS，无构建步骤）。
// 从 /g/<token> 路径提取 token：入页即"登录"（token 即凭据），API 调用带上它。

export function pageHtml(token: string): string {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>知识库管理</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; background: #f6f7f9; margin: 0; padding: 16px; }
  .wrap { max-width: 760px; margin: 0 auto; }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0; flex: 1; }
  .btn { border: 0; border-radius: 8px; padding: 8px 14px; font-size: 14px; cursor: pointer;
         background: #4f6ef7; color: #fff; }
  .btn.secondary { background: #e8eaf0; color: #333; }
  .btn.danger { background: #e5484d; }
  .btn:disabled { opacity: .5; cursor: default; }
  #drop { border: 2px dashed #c6cbe0; border-radius: 12px; padding: 28px; text-align: center;
          color: #7a8199; margin-bottom: 16px; background: #fff; transition: border-color .15s; }
  #drop.over { border-color: #4f6ef7; color: #4f6ef7; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 12px;
          overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,.05); }
  th, td { text-align: left; padding: 10px 12px; font-size: 14px; border-bottom: 1px solid #f0f1f5; }
  th { color: #7a8199; font-weight: 500; font-size: 12px; }
  td .name { font-weight: 600; word-break: break-all; }
  td .sub { color: #9aa1b5; font-size: 12px; margin-top: 2px; }
  .row-actions { white-space: nowrap; }
  .row-actions a, .row-actions button { margin-right: 6px; }
  #empty { text-align: center; color: #9aa1b5; padding: 40px 0; display: none; }
  #toast { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
           background: #222; color: #fff; padding: 10px 18px; border-radius: 8px;
           font-size: 14px; opacity: 0; transition: opacity .2s; pointer-events: none; }
  #toast.show { opacity: .92; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>📚 知识库</h1>
    <button class="btn secondary" onclick="location.reload()">刷新</button>
  </header>

  <div id="drop">
    拖拽文件到这里，或
    <button class="btn" onclick="document.getElementById('file').click()">选择文件</button>
    <input type="file" id="file" multiple hidden>
    <div style="font-size:12px;margin-top:8px">支持多选 · 单文件上限 200MB</div>
  </div>

  <table id="tbl" style="display:none">
    <thead><tr><th>文件名</th><th style="width:110px">大小</th><th style="width:150px">上传时间</th><th style="width:130px">操作</th></tr></thead>
    <tbody id="rows"></tbody>
  </table>
  <div id="empty">还没有文档，上传第一个吧</div>
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
  t.style.background = ok ? "#222" : "#c02929";
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2400);
}

function fmtSize(n) {
  if (n < 1024) return n + " B";
  if (n < 1048576) return (n / 1024).toFixed(1) + " KB";
  return (n / 1048576).toFixed(1) + " MB";
}

async function refresh() {
  const r = await fetch(BASE + "/api/entries", { headers: H });
  if (!r.ok) { toast("加载失败：" + r.status, false); return; }
  const { entries } = await r.json();
  const rows = document.getElementById("rows");
  const tbl = document.getElementById("tbl");
  const empty = document.getElementById("empty");
  rows.innerHTML = "";
  tbl.style.display = entries.length ? "" : "none";
  empty.style.display = entries.length ? "none" : "";
  for (const e of entries) {
    const tr = document.createElement("tr");
    const statusBadge = e.status === "ready" ? "" : ' <span style="color:#b8860b">(' + e.status + ')</span>';
    tr.innerHTML =
      '<td><div class="name"></div><div class="sub"></div></td>' +
      '<td></td><td></td>' +
      '<td class="row-actions"><a>下载</a><button class="danger" style="border:0;border-radius:6px;padding:4px 8px;cursor:pointer">删除</button></td>';
    tr.querySelector(".name").textContent = e.filename;
    tr.querySelector(".name").innerHTML += statusBadge;
    tr.querySelector(".sub").textContent = "#" + e.id;
    tr.cells[1].textContent = fmtSize(e.size);
    tr.cells[2].textContent = e.created_at;
    tr.querySelector("a").href = BASE + "/files/" + e.id;
    tr.querySelector("button").onclick = () => del(e.id, e.filename);
    rows.appendChild(tr);
  }
}

async function upload(files) {
  if (!files.length) return;
  for (const f of files) {
    const fd = new FormData();
    fd.append("file", f);
    const r = await fetch(BASE + "/api/entries", { method: "POST", headers: H, body: fd });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      toast("上传失败：" + (err.error || r.status), false);
    } else {
      toast("已上传：" + f.name);
    }
  }
  refresh();
}

async function del(id, name) {
  if (!confirm("删除「" + name + "」？不可恢复。")) return;
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
