// 슬랙 Block Kit 화면. 데이터를 받아 블록만 만든다.
import type { KnownBlock, Button, SectionBlock } from '@slack/types';
import type { Pick } from '../domain/recommend.js';
import { MOODS, type Mood } from '../domain/kinds.js';
import { config } from '../config.js';
import { kindTileUrl } from './tiles.js';

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

function seoulDateLabel(d = new Date()): string {
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'long', day: 'numeric', weekday: 'long' }).format(d);
}

function googleLabel(p: Pick): string | null {
  if (p.googleRating == null || !p.googleRatingCount) return null;
  return `구글 ★${p.googleRating.toFixed(1)} (${p.googleRatingCount})`;
}

function placeSection(p: Pick): SectionBlock {
  const meta = [p.detail ?? p.kind, p.distanceM != null ? `${p.distanceM}m` : null, googleLabel(p)].filter(Boolean).join(' · ');
  const section: SectionBlock = {
    type: 'section',
    text: { type: 'mrkdwn', text: `*${p.name}*\n${meta}\n${p.reason}` },
  };
  const tile = kindTileUrl(p.kind);
  if (tile) section.accessory = { type: 'image', image_url: tile, alt_text: p.kind };
  return section;
}

function placeActions(p: Pick): KnownBlock {
  const elements: any[] = [];
  if (p.kakaoUrl) {
    elements.push({ type: 'button', action_id: `kakao:${p.placeId}`, url: p.kakaoUrl,
      text: { type: 'plain_text', text: '카카오맵에서 보기' } });
  }
  elements.push({
    type: 'overflow',
    action_id: 'pick_menu',
    options: [
      { text: { type: 'plain_text', text: '가 봤어요 · 또 갈래' }, value: `visit:1:${p.placeId}` },
      { text: { type: 'plain_text', text: '가 봤어요 · 무난' }, value: `visit:0:${p.placeId}` },
      { text: { type: 'plain_text', text: '가 봤어요 · 별로' }, value: `visit:-1:${p.placeId}` },
      { text: { type: 'plain_text', text: '찜하기' }, value: `wish:${p.placeId}` },
      { text: { type: 'plain_text', text: '추천에서 빼기' }, value: `hide:${p.placeId}` },
    ],
  });
  return { type: 'actions', elements };
}

export function picksView(picks: Pick[], opts: { state: PickState }): KnownBlock[] {
  const { state } = opts;
  const subtitle = state.mood ? `${state.mood} 쪽으로 다시 골랐어요` : `${seoulDateLabel()} · 우리 중 아무도 안 가 본 곳`;
  const blocks: KnownBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: '오늘 가 볼 만한 새 밥집' } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: subtitle }] },
  ];

  if (!picks.length) {
    blocks.push({ type: 'section', text: { type: 'mrkdwn',
      text: '조건에 맞는 곳을 다 보여 드렸어요. 처음부터 다시 볼까요?' } });
  }

  for (const p of picks) {
    blocks.push({ type: 'divider' }, placeSection(p), placeActions(p));
  }
  blocks.push({ type: 'divider' });

  const shown = picks.map(p => p.placeId);
  const actions: Button[] = [
    picks.length
      ? { type: 'button', action_id: 'reroll', style: 'primary', text: { type: 'plain_text', text: '다른 세 곳' },
          value: encodeState({ round: state.round + 1, exclude: [...state.exclude, ...shown], mood: state.mood }) }
      : { type: 'button', action_id: 'reroll', style: 'primary', text: { type: 'plain_text', text: '처음부터' },
          value: encodeState({ round: state.round + 1, exclude: [], mood: null }) },
  ];
  if (picks.length) {
    actions.push({ type: 'button', action_id: 'share', text: { type: 'plain_text', text: '채널에 보여 주기' },
      value: JSON.stringify(picks.map(p => ({ ...p, reason: p.reason.slice(0, 100) }))) });
  }
  blocks.push({ type: 'actions', elements: actions });

  blocks.push({
    type: 'actions',
    elements: MOODS.map((m): Button => ({
      type: 'button',
      action_id: `mood:${m}`,
      text: { type: 'plain_text', text: state.mood === m ? `✓ ${m}` : m },
      value: encodeState({ round: state.round + 1, exclude: [], mood: state.mood === m ? null : m }),
    })),
  });
  blocks.push({ type: 'context', elements: [{ type: 'mrkdwn',
    text: '기분 버튼으로 다시 고를 수 있어요 · 다녀왔으면 ⋯ 메뉴에서 알려 주세요' }] });
  return blocks;
}

export function sharedView(userId: string, picks: Pick[]): KnownBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `<@${userId}> 님이 가 볼 만한 새 밥집을 가져왔어요` } },
    ...picks.flatMap((p): KnownBlock[] => [placeSection(p), placeActions(p)]),
  ];
}

export function weeklyView(picks: Pick[]): KnownBlock[] {
  return [
    { type: 'header', text: { type: 'plain_text', text: '이번 주 가 볼 만한 새 밥집' } },
    { type: 'context', elements: [{ type: 'mrkdwn',
      text: `우리 중 아무도 안 가 본 곳 ${picks.length}곳 · 더 보려면 \`${config.slashCommand}\`` }] },
    ...picks.flatMap((p): KnownBlock[] => [{ type: 'divider' }, placeSection(p), placeActions(p)]),
  ];
}

const VERDICT_LABEL: Record<string, string> = { '1': '또 갈래', '0': '무난', '-1': '별로' };

export function visitedNotice(name: string, verdict: string): string {
  return `${name} 다녀온 걸로 남겼어요 (${VERDICT_LABEL[verdict]}). 이제 추천에는 안 나와요.`;
}

export function hiddenNotice(name: string, placeId: number): KnownBlock[] {
  return [
    { type: 'section', text: { type: 'mrkdwn', text: `*${name}* 은(는) 이제 추천하지 않아요.` },
      accessory: { type: 'button', action_id: 'unhide', text: { type: 'plain_text', text: '되돌리기' },
        value: String(placeId) } },
  ];
}
