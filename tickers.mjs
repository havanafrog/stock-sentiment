// 볼 종목과 짝. 여기만 고치면 수집·빌드·대시보드가 다 따라온다.
//
// 짝은 [본주, 레버리지] 순서다. 레버리지가 없으면 null.
// 레버리지 ETF 는 본주를 배로 따라가므로 주가끼리 상관은 거의 1 로 자명하다.
// 볼 만한 건 감정 쪽 차이 — 어느 커뮤니티가 먼저·세게 반응하는가.
export const PAIRS = [
  ['SNDK', 'SNXX'],
  ['MU', 'MUU'],
  ['KORU', null],
];

export const TICKERS = PAIRS.flat().filter(Boolean);

export const LEVERAGED = new Set(PAIRS.map(([, lev]) => lev).filter(Boolean));
