// 슬랙 Block Kit 화면. 데이터를 받아 블록만 만든다.
import type { KnownBlock, Button } from '@slack/types';
import type { Pick } from '../domain/recommend.js';
import { MOODS, type Mood } from '../domain/kinds.js';

// 버튼에 싣는 다시 뽑기 상태. value 최대 2,000자라 제외 목록은 최근 60곳만 들고 다닌다.
export interface PickState { round: number; exclude: number[]; mood: Mood | null }

export function encodeState(s: PickState): string {
  return JSON.stringify({ r: s.round, x: s.exclude.slice(-60), m: s.mood });
}

export function decodeState(v: string | undefined): PickState {
  try {
    const o = JSON.parse(v ?? '{}');
    return {
      round: Number(o.r) || 0,
      exclude: Array.isArray(o.x) ? o.x.map(Number).filter(Number.isFinite) : [],
      mood: (MOODS as readonly string[]).includes(o.m) ? o.m : null,
    };
  } catch {
    return { round: 0, exclude: [], mood: null };
  }
}

function placeLine(p: Pick): string {
  const badge = p.verified ? '👍 우리가 가 본 곳' : '🌫️ 아직 안 가 봄';
  const meta = [p.kind, p.distanceM != null ? `${p.distanceM}m` : null,
    p.kakaoUrl ? `<${p.kakaoUrl}|카카오맵>` : null].filter(Boolean).join(' · ');
  return `*${p.name}*   ${badge}\n${meta}\n_${p.reason}_`;
}

function seoulDateLabel(d = new Date()): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'short' }).format(d);
}

export function picksView(picks: Pick[], opts: { state: PickState; title?: string }): KnownBlock[] {
  const { state } = opts;
  const title = opts.title
    ?? (state.mood ? `${state.mood} 쪽으로 골라 봤어요` : `오늘의 추천 · ${seoulDateLabel()}`);
  const blocks: KnownBlock[] = [
    { type: 'section', text: { type: 'mrkdwn', text: `*🍚 오늘 뭐 먹지?*   ${title}` } },
  ];

  if (!picks.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: '조건에 맞는 곳을 다 보여 드렸어요. 기분을 풀고 처음부터 다시 볼까요?' } });
  }

  for (const p of picks) {
    blocks.push({
      type: 'section',
      text: { type: 'mrkdwn', text: placeLine(p) },
      accessory: {
        type: 'overflow',
        action_id: 'pick_menu',
        options: [
          { text: { type: 'plain_text', text: '🤍 가고 싶어요 (찜)' }, value: `wish:${p.placeId}` },
          { text: { type: 'plain_text', text: '🚫 추천에서 빼기' }, value: `hide:${p.placeId}` },
        ],
      },
    });
  }

  const shown = picks.map(p => p.placeId);
  const next = encodeState({ round: state.round + 1, exclude: [...state.exclude, ...shown], mood: state.mood });
  const actions: Button[] = [
    picks.length
      ? { type: 'button', action_id: 'reroll', text: { type: 'plain_text', text: '🔄 다른 세 곳' }, value: next }
      : { type: 'button', action_id: 'reroll', text: { type: 'plain_text', text: '🔄 처음부터' },
          value: encodeState({ round: state.round + 1, exclude: [], mood: null }) },
  ];
  if (picks.length) {
    actions.push({ type: 'button', action_id: 'share', text: { type: 'plain_text', text: '📣 채널에 보여 주기' },
      value: JSON.stringify(picks.map(p => ({ ...p, reason: p.reason.slice(0, 120) }))) });
  }
  blocks.push({ type: 'actions', elements: actions });

  blocks.push({
    type: 'actions',
    elements: MOODS.map((m): Button => ({
      type: 'button',
      action_id: `mood:${m}`,
      text: { type: 'plain_text', text: m },
      value: encodeState({ round: state.round + 1, exclude: [], mood: state.mood === m ? null : m }),
      ...(state.mood === m ? { style: 'primary' as const } : {}),
    })),
  });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn',
    text: '기분 버튼을 누르면 그쪽으로 다시 골라요 · ⋯ 메뉴로 찜하거나 추천에서 뺄 수 있어요' }] });
  return blocks;
}

export function sharedView(userId: string, picks: Pick[]): KnownBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `<@${userId}> 님이 오늘 저녁 후보를 가져왔어요 🍚` } },
    ...picks.map((p): KnownBlock => ({ type: 'section', text: { type: 'mrkdwn', text: placeLine(p) } })),
  ];
}

export function hiddenNotice(name: string, placeId: number): KnownBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `🚫 *${name}* 은(는) 이제 추천하지 않아요.` },
      accessory: { type: 'button', action_id: 'unhide', text: { type: 'plain_text', text: '되돌리기' },
        value: String(placeId) } },
  ];
}
