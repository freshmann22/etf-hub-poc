// 역검색 규칙 사전 — PoC 단계 하드코딩(라이브 NLU/LLM API 붙이기 전 단계).
// 이 파일은 순수 데이터만 담는다(fetch/DOM 없음). taxonomy 56개 태그 라벨 기준 동의어 확장.
// 종목명 사전은 여기 두지 않는다 — public/data/etf-holdings.json 이 정본이라 adapters.js 가 런타임에 추출한다.
// 콜로퀴얼 별칭만 최소한으로 보강(정본 데이터에 실제로 존재하는 정식명으로만 매핑, 존재 확인은 스크립트로 검증했음).
export const STOCK_ALIASES = {
  '삼전': '삼성전자',
  '하이닉스': 'SK하이닉스',
  'sk하이닉스': 'SK하이닉스',
  '두산에너빌': '두산에너빌리티',
  '한화에어로': '한화에어로스페이스',
  '삼바': '삼성바이오로직스',
  '엘지화학': 'LG화학',
  '엘지에너지솔루션': 'LG에너지솔루션',
  '포스코': 'POSCO홀딩스',
  '기아차': '기아',
};

// keywords: 질의에 이 부분문자열이 있으면 매칭(긴 키워드 우선 소비 — nlu.js 에서 처리).
// tagIds: 매칭 시 부여할 태그(여러 개면 OR — "이 중 하나라도 있으면").
export const TAG_KEYWORD_GROUPS = [
  // dividend — 구체적인 것부터
  { keywords: ['월배당'], tagIds: ['dividend.monthly'] },
  { keywords: ['배당성장'], tagIds: ['dividend.dividend_growth'] },
  { keywords: ['커버드콜'], tagIds: ['dividend.covered_call'] },
  { keywords: ['고배당'], tagIds: ['dividend.korea_high_dividend'] },
  { keywords: ['배당'], tagIds: ['dividend.korea_high_dividend', 'dividend.dividend_growth', 'dividend.covered_call', 'dividend.monthly'] },

  // strategy — 지수 벤치마크
  { keywords: ['s&p500', 'sp500', 's&p 500', '미국대표지수'], tagIds: ['strategy.benchmark.sp500'] },
  { keywords: ['나스닥100', '나스닥 100', '나스닥'], tagIds: ['strategy.benchmark.nasdaq100'] },
  { keywords: ['코스피200', '코스피 200'], tagIds: ['strategy.benchmark.kospi200'] },
  { keywords: ['레버리지'], tagIds: ['strategy.leverage'] },
  { keywords: ['인버스'], tagIds: ['strategy.inverse'] },
  { keywords: ['액티브'], tagIds: ['strategy.active'] },
  { keywords: ['패시브', '지수추종'], tagIds: ['strategy.passive_index'] },
  { keywords: ['성장주'], tagIds: ['strategy.growth'] },
  { keywords: ['가치주'], tagIds: ['strategy.value'] },
  { keywords: ['저변동성', '로우볼'], tagIds: ['strategy.low_volatility'] },
  { keywords: ['밸류업'], tagIds: ['strategy.value_up'] },
  { keywords: ['esg', '탄소효율'], tagIds: ['strategy.esg_screening'] },
  { keywords: ['그룹주', '계열사'], tagIds: ['strategy.large_conglomerate_group'] },

  // sector
  { keywords: ['반도체'], tagIds: ['sector.semiconductor'] },
  { keywords: ['전기차', '2차전지', '이차전지'], tagIds: ['sector.ev_battery'] },
  { keywords: ['클린에너지', '신재생'], tagIds: ['sector.clean_energy'] },
  { keywords: ['자율주행', '모빌리티'], tagIds: ['sector.autonomous_mobility'] },
  { keywords: ['방산', '우주항공'], tagIds: ['sector.aerospace_defense'] },
  { keywords: ['조선'], tagIds: ['sector.shipbuilding'] },
  { keywords: ['원전', '원자력'], tagIds: ['sector.nuclear_power'] },
  { keywords: ['화장품', '뷰티'], tagIds: ['sector.beauty_cosmetics'] },
  { keywords: ['필수소비재'], tagIds: ['sector.consumer_staples_food'] },
  { keywords: ['경기소비재'], tagIds: ['sector.consumer_discretionary'] },
  { keywords: ['에너지', '화학'], tagIds: ['sector.energy_chemicals'] },
  { keywords: ['철강', '금속'], tagIds: ['sector.steel_metals'] },
  { keywords: ['건설'], tagIds: ['sector.construction'] },
  { keywords: ['로봇', '휴머노이드', '로보틱스'], tagIds: ['sector.robotics'] },
  { keywords: ['운송', '물류'], tagIds: ['sector.transportation_logistics'] },
  { keywords: ['게임', '엔터', '미디어'], tagIds: ['sector.game_entertainment_media'] },
  { keywords: ['바이오', '제약', '헬스케어', '의료'], tagIds: ['sector.healthcare_bio_pharma'] },
  { keywords: ['ai전력', 'ai 전력', 'ai인프라'], tagIds: ['sector.ai_power_infrastructure'] },
  { keywords: ['금융'], tagIds: ['sector.financials'] },
  { keywords: ['it서비스', 'it '], tagIds: ['sector.it'] },
  { keywords: ['테크', '기술주'], tagIds: ['sector.tech_general'] },

  // region
  { keywords: ['국내', '한국'], tagIds: ['region.domestic_kr'] },
  { keywords: ['미국'], tagIds: ['region.us'] },
  { keywords: ['중국'], tagIds: ['region.china'] },
  { keywords: ['일본'], tagIds: ['region.japan'] },
  { keywords: ['인도'], tagIds: ['region.india'] },
  { keywords: ['베트남'], tagIds: ['region.vietnam'] },
  { keywords: ['신흥국'], tagIds: ['region.emerging'] },
  { keywords: ['선진국', '글로벌'], tagIds: ['region.developed'] },

  // assetClass
  { keywords: ['국채'], tagIds: ['asset.bond.government'] },
  { keywords: ['회사채', '크레딧'], tagIds: ['asset.bond.corporate'] },
  { keywords: ['만기매칭'], tagIds: ['asset.bond.target_maturity'] },
  { keywords: ['초단기', '머니마켓'], tagIds: ['asset.bond.money_market'] },
  { keywords: ['채권'], tagIds: ['asset.bond'] },
  { keywords: ['원자재'], tagIds: ['asset.commodity'] },
  { keywords: ['리츠', '부동산'], tagIds: ['asset.reit'] },
  { keywords: ['혼합형', '멀티에셋'], tagIds: ['asset.mixed'] },
  { keywords: ['통화', '환율형'], tagIds: ['asset.currency'] },
];

// 시황 정렬 지표 — /api/bundle 커버리지가 큐레이션 종목·실시간 연동 종목 위주라 전체 유니버스 기준은 아님.
export const SORT_KEYWORD_GROUPS = [
  { keywords: ['거래량', '거래대금', '거래'], field: 'tradingValue', label: '거래대금' },
  { keywords: ['수익률', '성과'], field: 'return1m', label: '1개월 수익률' },
  { keywords: ['변동성'], field: 'volatilityScore', label: '변동성' },
  { keywords: ['보수', '수수료'], field: 'totalFee', label: '총보수' },
];

export const DIR_DESC_HINTS = ['많은', '높은', '큰', '상위'];
export const DIR_ASC_HINTS = ['적은', '낮은', '작은', '하위'];

export const WEIGHT_INTENT_HINTS = ['비중', '많이 들어간', '많이 담은', '편입비중', '가장 많이'];
