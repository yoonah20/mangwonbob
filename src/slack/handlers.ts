// 슬랙 명령어와 버튼 처리
import type { App, BlockAction, ButtonAction, OverflowAction } from '@slack/bolt';
import { config } from '../config.js';
import { todayPicks, rerollPicks } from '../picks.js';
import * as places from '../db/places.js';
import type { Pick } from '../domain/recommend.js';
import { picksView, sharedView, hiddenNotice, visitedNotice, decodeState } from './blocks.js';

const FALLBACK_TEXT = '오늘 가 볼 만한 새 밥집';
const ERROR_TEXT = '추천을 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요.';

export function registerHandlers(app: App): void {
  app.command(config.slashCommand, async ({ ack, respond }) => {
    await ack();
    try {
      const picks = await todayPicks();
      await respond({ response_type: 'ephemeral', text: FALLBACK_TEXT,
        blocks: picksView(picks, { state: { round: 0, exclude: [], mood: null } }) });
    } catch (e) {
      console.error('command failed', e);
      await respond({ response_type: 'ephemeral', text: ERROR_TEXT });
    }
  });

  // 다시 뽑기와 기분 버튼은 같은 방식으로 처리한다 (상태는 버튼 value에 실려 온다)
  app.action<BlockAction<ButtonAction>>(/^(reroll|mood:.+)$/, async ({ ack, action, body, respond }) => {
    await ack();
    try {
      const state = decodeState(action.value);
      const picks = await rerollPicks({ userId: body.user.id, ...state });
      await respond({ replace_original: true, text: FALLBACK_TEXT, blocks: picksView(picks, { state }) });
    } catch (e) {
      console.error('reroll failed', e);
      await respond({ replace_original: false, response_type: 'ephemeral', text: ERROR_TEXT });
    }
  });

  app.action<BlockAction<ButtonAction>>('share', async ({ ack, action, body, respond }) => {
    await ack();
    const picks = JSON.parse(action.value ?? '[]') as Pick[];
    await respond({ response_type: 'in_channel', replace_original: false,
      text: FALLBACK_TEXT, blocks: sharedView(body.user.id, picks) });
  });

  // 카카오맵 버튼은 링크라서 슬랙이 열어 준다. 응답(ack)만 하면 된다.
  app.action(/^kakao:\d+$/, async ({ ack }) => { await ack(); });

  app.action<BlockAction<OverflowAction>>('pick_menu', async ({ ack, action, body, respond }) => {
    await ack();
    const parts = action.selected_option.value.split(':');
    const verb = parts[0];
    const placeId = Number(parts[parts.length - 1]);
    const ephemeral = (text: string) =>
      respond({ replace_original: false, response_type: 'ephemeral', text });
    try {
      if (verb === 'visit') {
        const verdict = parts[1];
        await places.recordVisit(placeId, body.user.id, Number(verdict) as -1 | 0 | 1);
        const name = await places.getPlaceName(placeId);
        await ephemeral(visitedNotice(name ?? '그곳', verdict));
      } else if (verb === 'wish') {
        const on = await places.toggleWish(body.user.id, placeId);
        await ephemeral(on ? '찜했어요. 앞으로 추천에 더 자주 나와요.' : '찜을 풀었어요.');
      } else if (verb === 'hide') {
        const name = await places.hidePlace(placeId);
        if (name) {
          console.log(`hide place=${placeId} by=${body.user.id}`);
          await respond({ replace_original: false, response_type: 'ephemeral', text: `${name} 추천에서 뺌`,
            blocks: hiddenNotice(name, placeId) });
        }
      }
    } catch (e) {
      console.error('pick_menu failed', e);
      await ephemeral('저장하지 못했어요. 잠시 뒤 다시 시도해 주세요.');
    }
  });

  app.action<BlockAction<ButtonAction>>('unhide', async ({ ack, action, respond }) => {
    await ack();
    const name = await places.unhidePlace(Number(action.value));
    if (name) await respond({ replace_original: true, text: `${name} 을(를) 다시 추천 후보에 넣었어요.` });
  });
}
