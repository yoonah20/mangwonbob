// 리뷰 작성 Modal 제출 처리
const db = require('../db/queries');
const reviewSvc = require('../services/review');

function register(app) {
  app.view('submit_review', async ({ ack, body, view, client }) => {
    const restaurantId = parseInt(view.private_metadata, 10);
    const values = view.state.values;

    const rating = parseInt(values.rating_block?.rating?.selected_option?.value, 10);
    const comment = values.comment_block?.comment?.value || null;
    const tags = (values.tags_block?.tags?.selected_options || []).map(o => o.value);

    if (!rating) {
      return ack({
        response_action: 'errors',
        errors: { rating_block: '별점을 선택해주세요' },
      });
    }
    await ack();

    const restaurant = await db.getRestaurantById(restaurantId);
    if (!restaurant) return;

    await reviewSvc.recordReview({
      restaurantId,
      userId: body.user.id,
      userName: body.user.username || body.user.name,
      rating,
      comment,
      tags,
    });

    // 본인에게만 DM으로 확인
    try {
      await client.chat.postMessage({
        channel: body.user.id,
        text: `✍️ *${restaurant.name}* 리뷰가 등록됐어요. ⭐ ${rating}점${comment ? `\n💬 "${comment}"` : ''}${tags.length ? `\n🏷️ ${tags.join(' ')}` : ''}`,
      });
    } catch (e) {
      console.error('리뷰 확인 DM 실패:', e.message);
    }
  });
}

module.exports = { register };
