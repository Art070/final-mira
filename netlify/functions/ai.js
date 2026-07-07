exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { error: 'Bad JSON' });
  }

  const action = body.action || 'chat';
  const context = body.context || {};
  const history = Array.isArray(body.history) ? body.history.slice(-20) : [];
  const by = body.by === 'him' ? 'Ева' : 'Валли';

  const system = [
    'Ты Юи, приватная ИИ-помощница пары Валли и Евы в приложении "Наш мир".',
    'Твоя роль: помогать с бытом, планами, недопониманием и сложными разговорами.',
    'Ты не судья, не выбираешь виноватого, не ставишь диагнозы и не используешь терапевтический тон свысока.',
    'Ты говоришь коротко, тепло, конкретно, по-русски.',
    'Ты постепенно формируешь мягкий профиль партнёров: что человеку важно, на что он быстрее соглашается, что его успокаивает, какие формулировки лучше работают.',
    'Если видишь ссору, сначала отражай позиции обоих, потом задавай 1-2 аккуратных вопроса, потом предлагай маленький следующий шаг.',
    'Не раскрывай одному партнёру скрытые личные задания другого.',
    'Отвечай строго JSON без markdown: {"reply":"...","summary":"...","next":"...","profile":{...}}.',
    'Для обычного чата используй поле reply. Для weekly используй summary и next, а также можешь дать reply для истории.'
  ].join('\n');

  const userPayload = JSON.stringify({
    action,
    currentSpeaker: by,
    message: body.message || '',
    history,
    context
  });

  try {
    if (process.env.OPENAI_COMPAT_BASE_URL && process.env.ANTHROPIC_API_KEY) {
      return await callOpenAICompat(system, userPayload, action);
    }
    if (process.env.ANTHROPIC_API_KEY) {
      return await callClaude(system, userPayload, action);
    }
    if (process.env.OPENAI_API_KEY) {
      return await callOpenAI(system, userPayload, action);
    }
    return json(500, { error: 'Set ANTHROPIC_API_KEY or OPENAI_API_KEY' });
  } catch (e) {
    return json(500, { error: e.message || 'AI request failed' });
  }
};

async function callClaude(system, userPayload, action) {
  const base = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com').replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/messages` : `${base}/v1/messages`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      max_tokens: action === 'weekly' ? 900 : 650,
      system,
      messages: [{ role: 'user', content: userPayload }]
    })
  });

  const data = await r.json();
  if (!r.ok) return json(r.status, { error: data.error?.message || 'Claude error' });

  const text = (data.content || [])
    .filter(x => x.type === 'text')
    .map(x => x.text)
    .join('\n')
    .trim();

  return json(200, parseAI(text));
}

async function callOpenAICompat(system, userPayload, action) {
  const base = process.env.OPENAI_COMPAT_BASE_URL.replace(/\/+$/, '');
  const url = base.endsWith('/v1') ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.ANTHROPIC_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL || 'claude-opus-4-8',
      temperature: action === 'weekly' ? 0.4 : 0.6,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPayload }
      ]
    })
  });

  const data = await r.json();
  if (!r.ok) return json(r.status, { error: data.error?.message || data.message || 'OpenAI-compatible Claude error' });

  return json(200, parseAI(data.choices?.[0]?.message?.content || '{}'));
}

async function callOpenAI(system, userPayload, action) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: action === 'weekly' ? 0.4 : 0.6,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: userPayload }
      ]
    })
  });

  const data = await r.json();
  if (!r.ok) return json(r.status, { error: data.error?.message || 'OpenAI error' });

  return json(200, parseAI(data.choices?.[0]?.message?.content || '{}'));
}

function parseAI(text) {
  let parsed;
  try {
    parsed = JSON.parse(text || '{}');
  } catch (e) {
    parsed = { reply: text || '' };
  }
  return {
    reply: parsed.reply || '',
    summary: parsed.summary || '',
    next: parsed.next || '',
    profile: parsed.profile || null
  };
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify(body)
  };
}
