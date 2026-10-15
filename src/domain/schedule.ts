// 주간 소식을 보낼 때가 됐는지 판단한다. 금요일 16:30(서울)부터 일요일 밤까지가 그 주의 발송 구간이다.

const SEND_WEEKDAY = 5; // 금요일
const SEND_MINUTES = 16 * 60 + 30;

function seoulParts(d: Date) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Seoul', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => f.find(p => p.type === t)!.value;
  // 월=1 … 일=7
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(get('weekday')) + 1;
  return { weekday, minutes: Number(get('hour')) * 60 + Number(get('minute')), date: `${get('year')}-${get('month')}-${get('day')}` };
}

// 그 주의 금요일 날짜를 주 이름으로 쓴다
export function dueWeekKey(now: Date): string | null {
  const p = seoulParts(now);
  if (p.weekday < SEND_WEEKDAY) return null;
  if (p.weekday === SEND_WEEKDAY && p.minutes < SEND_MINUTES) return null;
  const d = new Date(`${p.date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - (p.weekday - SEND_WEEKDAY));
  return d.toISOString().slice(0, 10);
}
