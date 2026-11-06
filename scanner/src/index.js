// UpgraDex scanner: a Cloudflare Worker that reads Pokémon cards in a photo.
//
// POST /identify  { mode: "quick" | "catalog", image: "<base64 JPEG>" }
//   header  X-App-Passcode: <APP_PASSCODE>
// -> { cards: [...], model, usage }
//
// "quick"   = one card, Claude Haiku 5.5 (cheap, fast price checks in a shop)
// "catalog" = a binder page of up to 9 cards, Claude Sonnet 5.5 (more accurate)
//
// The Anthropic API key never leaves this worker.

import Anthropic from '@anthropic-ai/sdk';

export const MODES = {
  quick: {
    model: 'claude-haiku-5-5',
    effort: 'low',
    maxTokens: 4000,
    fallback: false, // Haiku has no server-side refusal fallback
    prompt: `This photo shows one Pokémon trading card (it may be in a sleeve, at an angle, or partly glary).
Identify it and return exactly one entry in "cards".`,
  },
  catalog: {
    model: 'claude-sonnet-5-5',
    effort: 'medium',
    maxTokens: 16000,
    fallback: true,
    prompt: `This photo shows a binder page of Pokémon trading cards, usually a 3×3 grid of up to 9 cards
(some pockets may be empty). Return one entry per card you can see, numbered 1–9 in reading order
(left to right, top row first). Skip empty pockets.`,
  },
};

const FIELD_HELP = `For each card fill in:
- pokemon: the Pokémon's English species name with no suffixes (e.g. "Umbreon" for "Umbreon ex" or "Umbreon VMAX",
  "Mewtwo" for "Team Rocket's Mewtwo ex"). Empty string if it's a Trainer or Energy card.
- dex_number: that Pokémon's National Pokédex number (0 if not a Pokémon card).
- card_name: the card's name translated to English as printed on English cards (e.g. "Umbreon ex").
- set_code: the small set code printed bottom-left (e.g. "PRE", "SVI", "MEW", "sv8a"). Empty if none is printed.
- number: the card number before the slash, exactly as printed (e.g. "161", "TG12", "SWSH203", "GG44").
- set_total: the number after the slash (e.g. "131"), or empty.
- language: EN, JP, KR or OTHER, from the text on the card.
- confidence: high if you could read the name and number clearly, otherwise medium or low.
Only report what is visible; use empty strings rather than guessing set codes or numbers.`;

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['cards'],
  properties: {
    cards: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['position', 'pokemon', 'dex_number', 'card_name', 'set_code', 'number', 'set_total', 'language', 'confidence'],
        properties: {
          position: { type: 'integer' },
          pokemon: { type: 'string' },
          dex_number: { type: 'integer' },
          card_name: { type: 'string' },
          set_code: { type: 'string' },
          number: { type: 'string' },
          set_total: { type: 'string' },
          language: { type: 'string', enum: ['EN', 'JP', 'KR', 'OTHER'] },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
      },
    },
  },
};

const MAX_IMAGE_BASE64 = 7_000_000; // ~5 MB JPEG; the app sends far less

function corsHeaders(origin, env) {
  const allowed = String(env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = origin && allowed.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : allowed[0] || 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-App-Passcode',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });
}

function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !b) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] || 0) ^ (y[i] || 0);
  return diff === 0;
}

export async function identify(client, mode, imageBase64) {
  const m = MODES[mode];
  const params = {
    model: m.model,
    max_tokens: m.maxTokens,
    output_config: { effort: m.effort, format: { type: 'json_schema', schema: SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: imageBase64 } },
        { type: 'text', text: `${m.prompt}\n\n${FIELD_HELP}` },
      ],
    }],
  };
  const response = m.fallback
    // If Sonnet's safety filter wrongly declines, the API retries on Anthropic's recommended fallback model.
    ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
    : await client.messages.create(params);

  if (response.stop_reason === 'refusal') {
    return { error: "The scanner couldn't read that photo. Try another one.", status: 422 };
  }
  if (response.stop_reason === 'max_tokens') {
    return { error: 'The answer was cut short. Try a photo with fewer cards.', status: 422 };
  }
  const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { error: 'The scanner gave an unreadable answer. Please try again.', status: 502 };
  }
  const cards = Array.isArray(parsed.cards) ? parsed.cards.slice(0, mode === 'quick' ? 1 : 9) : [];
  return {
    cards,
    model: response.model,
    usage: { input_tokens: response.usage?.input_tokens ?? 0, output_tokens: response.usage?.output_tokens ?? 0 },
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const cors = corsHeaders(origin, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const url = new URL(request.url);
    if (url.pathname === '/' && request.method === 'GET') {
      return json({ ok: true, service: 'upgradex-scanner' }, 200, cors);
    }
    if (url.pathname !== '/identify' || request.method !== 'POST') {
      return json({ error: 'Not found' }, 404, cors);
    }
    if (!sameSecret(request.headers.get('X-App-Passcode') || '', env.APP_PASSCODE)) {
      return json({ error: 'Wrong scanner passcode – check Settings in UpgraDex.' }, 401, cors);
    }
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'The scanner has no Anthropic API key set up yet.' }, 500, cors);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Bad request' }, 400, cors);
    }
    const mode = body?.mode;
    const image = typeof body?.image === 'string' ? body.image.replace(/^data:image\/\w+;base64,/, '') : '';
    if (!MODES[mode]) return json({ error: 'Unknown scan mode' }, 400, cors);
    if (!image || image.length > MAX_IMAGE_BASE64 || !/^[A-Za-z0-9+/=]+$/.test(image.slice(0, 200))) {
      return json({ error: 'Missing or oversized photo' }, 400, cors);
    }

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, baseURL: env.ANTHROPIC_BASE_URL || undefined });
    try {
      const result = await identify(client, mode, image);
      if (result.error) return json({ error: result.error }, result.status, cors);
      return json(result, 200, cors);
    } catch (e) {
      if (e instanceof Anthropic.AuthenticationError) {
        return json({ error: "The scanner's Anthropic API key isn't valid." }, 502, cors);
      }
      if (e instanceof Anthropic.RateLimitError) {
        return json({ error: 'The scanner is busy – try again in a minute.' }, 503, cors);
      }
      if (e instanceof Anthropic.BadRequestError) {
        // Most often: no credit left on the Anthropic account.
        return json({ error: `The card reader rejected the request: ${e.message}` }, 502, cors);
      }
      if (e instanceof Anthropic.APIError) {
        return json({ error: `The card reader had a problem (${e.status ?? 'network'}). Try again.` }, 502, cors);
      }
      return json({ error: 'Something went wrong in the scanner.' }, 500, cors);
    }
  },
};
