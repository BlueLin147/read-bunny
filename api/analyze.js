export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录，请先登录' });
  }

  const token = authHeader.split(' ')[1];
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { 'Authorization': `Bearer ${token}`, 'apikey': supabaseKey }
  });
  if (!userRes.ok) return res.status(401).json({ error: '登录已过期，请重新登录' });

  const { content, mode } = req.body;
  if (!content) return res.status(400).json({ error: '缺少文章内容' });

  const modeHints = {
    overview: '只填写 overview 字段，其余为空。',
    full: '完整填写所有字段。',
    grammar: '重点填写 grammar（至少5条），sentences 可简化。',
    vocab: '重点填写词汇相关字段。'
  };

  const systemPrompt = `你是资深英文语言学专家，专门帮助中文学习者精读英文文章。所有分析、翻译、释义必须用中文。literal字段是逐字直译（中文），natural字段是地道中文意译，meaning字段是中文词义，structures字段是中文句意结构。请只输出如下格式的JSON，不要输出任何其他内容：
{"overview":{"topic":"","core":"","level":"","time":"","audience":""},"original":"","sentences":[{"para":1,"index":1,"en":"","subject":"","predicate":"","object":"","structures":[],"vocab":[{"word":"","pos":"","meaning":""}],"literal":"","natural":""}],"grammar":[{"name":"","frequency":"","example":"","explain":""}],"learning":{"vocab":[],"synonyms":[],"collocations":[],"patterns":[],"tips":[],"background":[]}}`;

  const fullPrompt = `${systemPrompt}\n\n${modeHints[mode] || modeHints.full}\n\n文章：\n${content}`;

  try {
    const ollamaRes = await fetch('https://ollama.com/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OLLAMA_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'minimax-m2.5:cloud',
        prompt: fullPrompt,
        stream: false,
        num_predict: 8000,
      })
    });

    // Get raw text first
    const rawText = await ollamaRes.text();

    if (!ollamaRes.ok) {
      return res.status(500).json({ error: `Ollama错误 (${ollamaRes.status}): ${rawText}` });
    }

    // Parse the outer Ollama response
    let ollamaData;
    try {
      ollamaData = JSON.parse(rawText);
    } catch(e) {
      return res.status(500).json({ error: `Ollama返回格式异常: ${rawText.slice(0, 200)}` });
    }

    let raw = ollamaData.response || '';
    raw = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s > -1) raw = raw.slice(s, e + 1);

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch(e) {
      return res.status(500).json({ error: `模型输出解析失败: ${raw.slice(0, 300)}` });
    }

    return res.status(200).json(parsed);

  } catch (err) {
    return res.status(500).json({ error: `请求失败: ${err.message}` });
  }
}
