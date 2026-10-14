// 工地貓 AI 每日統整（Supabase Edge Function）
// 每天第一位打開工地貓的成員會觸發一次；同一天只產生一份（總監可重新產生）。
// 需要的 Secret：ANTHROPIC_API_KEY（在 Supabase → Edge Functions → Secrets 設定，不要寫進程式）
// 讀寫資料都使用呼叫者本人的登入身分，受 RLS 保護，不使用 service role key。

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MODEL = 'claude-sonnet-5-5';
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  const URL_ = Deno.env.get('SUPABASE_URL')!;
  const auth = req.headers.get('Authorization') || '';
  const apikey = req.headers.get('apikey') || '';
  const KEY = Deno.env.get('ANTHROPIC_API_KEY') || Deno.env.get('ANTHROPIC_API_KE');
  if (!KEY) return json({ error: 'missing_key' }, 500);

  const rest = (path: string, init: RequestInit = {}) =>
    fetch(URL_ + '/rest/v1/' + path, {
      ...init,
      headers: { apikey, Authorization: auth, 'Content-Type': 'application/json', ...(init.headers || {}) },
    });

  // 確認是登入成員
  const me = await fetch(URL_ + '/auth/v1/user', { headers: { apikey, Authorization: auth } });
  if (!me.ok) return json({ error: 'unauthorized' }, 401);
  const user = await me.json();
  const prof = (await (await rest('profiles?select=name,is_admin&id=eq.' + user.id)).json())[0];
  if (!prof) return json({ error: 'not_member' }, 403);

  const body = await req.json().catch(() => ({}));
  const tw = new Date(Date.now() + 8 * 3600e3);
  const day = tw.toISOString().slice(0, 10);

  // 同一天只產生一次：先佔位
  const existing = (await (await rest('daily_digest?select=*&day=eq.' + day)).json())[0];
  if (existing) {
    const stale = existing.status === 'pending' && Date.now() - Date.parse(existing.updated_at) > 3 * 60e3;
    const canRedo = existing.status === 'error' || stale || (body.force && prof.is_admin);
    if (!canRedo) return json(existing);
    await rest('daily_digest?day=eq.' + day, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending', error: null, by_name: prof.name, updated_at: new Date().toISOString() }),
    });
  } else {
    const ins = await rest('daily_digest', {
      method: 'POST',
      headers: { Prefer: 'resolution=ignore-duplicates,return=representation' },
      body: JSON.stringify({ day, status: 'pending', by_name: prof.name }),
    });
    const got = await ins.json().catch(() => []);
    if (!Array.isArray(got) || !got.length) {
      const row = (await (await rest('daily_digest?select=*&day=eq.' + day)).json())[0];
      return json(row || { day, status: 'pending' });
    }
  }

  try {
    const since = new Date(Date.now() - 36 * 3600e3).toISOString();
    const [projects, open, recent, comments] = await Promise.all([
      rest('projects?select=id,name,phase,progress,end_date,today&phase=neq.完工').then((r) => r.json()),
      rest('records?select=id,project_id,category,text,assignee,due,urgent,items&status=eq.open&assignee=neq.&limit=300').then((r) => r.json()),
      rest('records?select=id,project_id,category,text,by_name,assignee,status,done_by&ts=gte.' + since + '&order=ts.desc&limit=150').then((r) => r.json()),
      rest('comments?select=record_id,text,by_name,created_at&created_at=gte.' + since + '&order=created_at&limit=150').then((r) => r.ok ? r.json() : []),
    ]);
    const pn = Object.fromEntries(projects.map((p: any) => [p.id, p.name]));
    const days = (d: string) => Math.round((Date.parse(d) - Date.parse(day)) / 864e5);
    const clip = (s: string, n = 120) => (s || '').replace(/\s+/g, ' ').slice(0, n);
    const lines: string[] = [];
    lines.push('【進行中工地】');
    projects.forEach((p: any) =>
      lines.push(`- ${p.name}｜階段:${p.phase}｜進度:${p.progress}%${p.end_date ? `｜距完工${days(p.end_date)}天` : ''}${p.today ? `｜今日施工:${clip(p.today, 60)}` : ''}`));
    lines.push('\n【未完成待辦】');
    open.forEach((r: any) => {
      const buy = Array.isArray(r.items) && r.items.length
        ? `｜採購未下訂:${r.items.filter((i: any) => i.status === 'todo').length}項` : '';
      lines.push(`- [${pn[r.project_id] || '其他'}] ${r.category}：${clip(r.text) || '（只有照片）'}｜負責:${r.assignee}${r.due ? `｜期限:${days(r.due) < 0 ? `逾期${-days(r.due)}天` : days(r.due) === 0 ? '今天' : `${days(r.due)}天後`}` : ''}${r.urgent ? '｜緊急' : ''}${buy}`);
    });
    lines.push('\n【最近 36 小時新增的紀錄】');
    recent.forEach((r: any) =>
      lines.push(`- [${pn[r.project_id] || '其他'}] ${r.category}：${clip(r.text) || '（只有照片）'}｜記錄:${r.by_name}${r.status === 'done' ? `｜已完成(${r.done_by || ''})` : ''}`));
    if (comments.length) {
      const rt = Object.fromEntries([...open, ...recent].map((r: any) => [r.id, `[${pn[r.project_id] || '其他'}] ${clip(r.text, 30)}`]));
      lines.push('\n【最近 36 小時的留言】');
      comments.forEach((c: any) => lines.push(`- ${c.by_name} 在「${rt[c.record_id] || '某筆紀錄'}」留言：${clip(c.text, 100)}`));
    }

    const WD = '日一二三四五六';
    const prompt = `你是室內設計公司「采旎空間設計」的資深工務經理，幫團隊（總監、設計師、財務）寫今天早上的工地統整。今天是 ${day}（星期${WD[tw.getUTCDay()]}）。
以下是工地管理系統的資料：

${lines.join('\n')}

請用繁體中文（台灣用語）寫一份精簡統整，只回覆一個 JSON 物件：
{"headline":"一句話總結今天的狀況，30 字內","points":[{"level":"hot|warn|info","text":"一個重點，40 字內，提到工地名稱與負責人","project":"工地名稱或空字串"}]}
規則：points 3–6 點，依重要性排序；hot＝工安、逾期、今天到期、擋住後續工序；warn＝快到期、未下訂的採購、需要回覆業主的事、留言中提到的問題；info＝進度與好消息。只根據資料，不要編造。沒有資料時就說今天沒有需要特別注意的事。`;

    const ai = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1200, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!ai.ok) throw new Error('AI ' + ai.status + ' ' + (await ai.text()).slice(0, 200));
    const out = await ai.json();
    const txt = (out.content || []).map((c: any) => c.text || '').join('');
    const m = txt.match(/\{[\s\S]*\}/);
    const data = JSON.parse(m ? m[0] : txt);
    const summary = {
      headline: String(data.headline || ''),
      points: (Array.isArray(data.points) ? data.points : []).slice(0, 8).map((p: any) => ({
        level: ['hot', 'warn', 'info'].includes(p.level) ? p.level : 'info',
        text: String(p.text || ''),
        project: String(p.project || ''),
      })),
    };
    const done = await rest('daily_digest?day=eq.' + day, {
      method: 'PATCH',
      headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'done', summary, error: null, updated_at: new Date().toISOString() }),
    });
    return json((await done.json())[0]);
  } catch (e) {
    const msg = String((e as Error).message || e).slice(0, 300);
    await rest('daily_digest?day=eq.' + day, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'error', error: msg, updated_at: new Date().toISOString() }),
    });
    return json({ day, status: 'error', error: msg }, 500);
  }
});
