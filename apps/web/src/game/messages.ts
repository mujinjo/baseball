import type { PitchEvent, PlateResult } from '@baseball/core';
import { ko } from '../i18n/ko';

/** 투구 결과를 화면에 띄울 한국어 문장(제목/부제)으로 바꾼다 */
export function describeOutcome(
  event: PitchEvent,
  result: PlateResult | null,
  runs: number,
  distanceM?: number,
): { title: string; sub: string } {
  switch (event.type) {
    case 'ball':
      return result === 'walk' ? { title: ko.result.walk, sub: ko.runs(runs).trim() } : { title: ko.ball, sub: '' };
    case 'strike':
      if (result === 'strikeout') {
        return { title: ko.result.strikeout, sub: event.swinging ? ko.strikeoutSwinging : ko.strikeoutLooking };
      }
      return { title: event.swinging ? ko.strikeSwinging : ko.strikeLooking, sub: '' };
    case 'foul':
      return { title: ko.foul, sub: distanceM !== undefined ? ko.distance(distanceM) : '' };
    case 'inPlay': {
      const ball = `${ko.quality[event.quality]} ${ko.kind[event.kind]}`.trim();
      const dist = distanceM !== undefined ? ` ${ko.distance(distanceM)}` : '';
      return { title: result ? ko.result[result] : '', sub: `${ball}${dist}${ko.runs(runs)}` };
    }
  }
}
