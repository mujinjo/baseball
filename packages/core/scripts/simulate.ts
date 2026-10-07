import { createRng, simulate, type SimOptions, type SimStats } from '../src';

const N = Number(process.argv[2] ?? 50000);
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const f3 = (v: number) => v.toFixed(3).replace(/^0/, '');

function row(label: string, s: SimStats) {
  console.log(
    [
      label.padEnd(24),
      `AVG ${f3(s.avg)}`,
      `OBP ${f3(s.obp)}`,
      `SLG ${f3(s.slg)}`,
      `K ${pct(s.kRate).padStart(5)}`,
      `BB ${pct(s.bbRate).padStart(5)}`,
      `HR ${pct(s.hrRate).padStart(5)}`,
      `스윙 ${pct(s.swingRate)}`,
      `컨택 ${pct(s.contactRate)}`,
      `존 ${pct(s.zoneRate)}`,
      `투구/타석 ${s.pitchesPerPA.toFixed(2)}`,
    ].join(' | '),
  );
}

function section(title: string, cases: [string, Partial<SimOptions>][]) {
  console.log(`\n## ${title}`);
  cases.forEach(([label, o], i) => row(label, simulate({ plateAppearances: N, ...o }, createRng(1000 + i))));
}

console.log(`타석 수: ${N} (주자 없음 기준, 타자 숙련도·투수 제구 변화에 따른 결과)`);
section('기본 (보통 타자 vs 보통 투수)', [['기본', {}]]);
section('타자 타이밍 숙련도(오차 σ)', [
  ['σ=25ms (고수)', { timingSigmaMs: 25 }],
  ['σ=40ms (보통)', { timingSigmaMs: 40 }],
  ['σ=60ms (초보)', { timingSigmaMs: 60 }],
  ['σ=90ms (미숙)', { timingSigmaMs: 90 }],
]);
section('투수 제구 게이지', [
  ['게이지 0.4', { gaugeMean: 0.4 }],
  ['게이지 0.7', { gaugeMean: 0.7 }],
  ['게이지 0.95', { gaugeMean: 0.95 }],
]);
section('타자 구종 예측 적중률 (심리전 가치)', [
  ['예측 안 함', {}],
  ['적중 25% (무작위)', { guessAccuracy: 0.25 }],
  ['적중 50%', { guessAccuracy: 0.5 }],
  ['적중 75%', { guessAccuracy: 0.75 }],
]);
