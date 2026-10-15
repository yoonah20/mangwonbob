// 카카오 카테고리 경로("음식점 > 한식 > 국밥")를 우리가 쓰는 종류(kind)로 묶는다.
// 위에서부터 먼저 맞는 규칙이 이긴다. 순서를 바꾸면 분류 결과가 달라진다.

export const KINDS = [
  '고기', '한식', '일식', '중식', '양식', '아시아', '해산물',
  '술집', '분식', '치킨', '카페', '빵·간식', '기타',
] as const;
export type Kind = (typeof KINDS)[number];

const RULES: Array<[Kind, RegExp]> = [
  ['카페', /카페|커피|디저트|생과일|찻집/],
  ['빵·간식', /간식|베이커리|제과|떡,한과|아이스크림|도넛/],
  ['치킨', /치킨|닭강정/],
  ['고기', /육류,고기|삼겹|갈비|곱창|막창|족발|보쌈|양꼬치|불고기/],
  ['해산물', /해물,생선|회$|> 회|장어|추어|조개|수산/],
  ['술집', /술집|호프|요리주점|일본식주점|이자카야|포장마차|와인바|칵테일바|오뎅바/],
  ['일식', /일식|초밥|라면|돈까스|우동|철판/],
  ['중식', /중식|중국요리/],
  ['아시아', /아시아|베트남|태국|인도/],
  ['양식', /양식|이탈리안|피자|햄버거|패스트푸드|프랑스|스페인|멕시칸/],
  ['분식', /분식|떡볶이|김밥|도시락/],
  ['한식', /한식/],
];

export function kindOf(categoryPath: string | null | undefined, override?: string | null): Kind {
  if (override && (KINDS as readonly string[]).includes(override)) return override as Kind;
  const path = categoryPath ?? '';
  for (const [kind, re] of RULES) if (re.test(path)) return kind;
  return '기타';
}

// 저녁 추천에서 아예 빼는 종류
export const NOT_DINNER: ReadonlySet<Kind> = new Set<Kind>(['카페', '빵·간식']);

// 결과를 본 뒤 좁힐 때 쓰는 기분 칩
export const MOODS = ['고기', '국물', '가볍게', '한잔'] as const;
export type Mood = (typeof MOODS)[number];

const SOUP = /국밥|국수|칼국수|찌개|전골|감자탕|해장|탕|우동|라면|쌀국수|샤브|냉면/;
const LIGHT = /돈까스|우동|국수|덮밥|라면|김밥|샌드위치|햄버거|쌀국수|분식/;
const DRINK = /술집|호프|요리주점|주점|포장마차|와인|이자카야|> 회/;

export function matchesMood(mood: Mood, kind: Kind, categoryPath: string | null | undefined): boolean {
  const path = categoryPath ?? '';
  switch (mood) {
    case '고기': return kind === '고기' || kind === '치킨';
    case '국물': return SOUP.test(path);
    case '가볍게': return kind === '분식' || kind === '아시아' || LIGHT.test(path);
    case '한잔': return kind === '술집' || DRINK.test(path);
  }
}

// 이름이나 경로로 알아보는 체인점. 빼지는 않고 점수만 깎는다.
const CHAINS = /롯데리아|맥도날드|버거킹|맘스터치|KFC|서브웨이|타코벨|이삭토스트|김밥천국|본죽|BHC|BBQ|교촌|페리카나|굽네|네네|처갓집|또래오래|호식이|60계|자담|푸라닭|노랑통닭|계림원|누구나홀딱반한닭|멕시카나|지코바|행복한찜닭|구구족|족발천하|명랑핫도그|홍콩반점|역전우동|하남돼지|새마을식당|한신포차|투다리|도미노|피자헛|파파존스|피자스쿨|스타벅스|메가MGC|컴포즈|이디야|빽다방|파리바게뜨|뚜레쥬르/i;

export function isChain(name: string, categoryPath: string | null | undefined): boolean {
  return CHAINS.test(name) || CHAINS.test(categoryPath ?? '');
}

// 앉아서 먹을 수 없는 곳 (포장·배달 전문). 추천에서 아예 뺀다.
const TAKEOUT_ONLY = /포장전문|배달전문|포장 전문|배달 전문|테이크아웃|밀키트/;

export function isTakeoutOnly(name: string, categoryPath: string | null | undefined): boolean {
  return TAKEOUT_ONLY.test(name) || /도시락|밀키트/.test(categoryPath ?? '');
}

// 카드에 보여 줄 세부 종류: 경로의 마지막 칸 ("음식점 > 술집 > 일본식주점" → "일본식주점")
export function detailOf(categoryPath: string | null | undefined, kind: Kind): string {
  const last = (categoryPath ?? '').split('>').map(x => x.trim()).filter(Boolean).pop();
  if (!last || last === '음식점' || CHAINS.test(last)) return kind;
  return last.replace(/,/g, '·');
}
