// 카카오 장소와 구글 장소가 같은 곳인지 판단한다.
// 이름 표기가 달라서("동래정 망원점" vs "동래정") 지점명·공백·기호를 떼고 비교한다.

export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, '')
    .replace(/(서울)?\s*[가-힣a-z0-9]*(본점|직영점|점)$/u, '')
    .replace(/[^가-힣a-z0-9]/gu, '');
}

function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  if (s.length === 1) out.add(s);
  return out;
}

// 구글은 "Sukiya Mangwon 스키야"처럼 영문을 섞어 쓰기도 해서 한글만 떼어 한 번 더 비교한다
export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a), nb = normalizeName(b);
  const ha = na.replace(/[^가-힣]/gu, ''), hb = nb.replace(/[^가-힣]/gu, '');
  return Math.max(rawSimilarity(na, nb), ha.length >= 2 && hb.length >= 2 ? rawSimilarity(ha, hb) : 0);
}

function rawSimilarity(na: string, nb: string): number {
  if (!na || !nb) return 0;
  if (na === nb || na.includes(nb) || nb.includes(na)) return 1;
  const A = bigrams(na), B = bigrams(nb);
  let common = 0;
  for (const x of A) if (B.has(x)) common++;
  return (2 * common) / (A.size + B.size);
}

export interface Candidate { id: string; name: string; distanceM: number }

// 이름이 꽤 닮았고 가까우면 같은 곳으로 본다. 아주 가까우면 이름이 덜 닮아도 받아 준다.
export function bestMatch(kakaoName: string, candidates: Candidate[]): string | null {
  let best: { id: string; score: number } | null = null;
  for (const c of candidates) {
    const sim = nameSimilarity(kakaoName, c.name);
    const ok = (sim >= 0.6 && c.distanceM <= 80) || (sim >= 0.34 && c.distanceM <= 25);
    if (!ok) continue;
    const score = sim - c.distanceM / 400;
    if (!best || score > best.score) best = { id: c.id, score };
  }
  return best?.id ?? null;
}
