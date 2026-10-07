import Phaser from 'phaser';
import {
  applyPitch,
  battingTeam,
  createRng,
  newGame,
  type BattedBallKind,
  type BattedBallQuality,
  type GameState,
  type PitchEvent,
} from '@baseball/core';
import { ko } from '../i18n/ko';

const KINDS: BattedBallKind[] = ['ground', 'line', 'fly', 'popup'];
const QUALITIES: BattedBallQuality[] = ['weak', 'normal', 'hard'];

/** M0/M1 확인용 임시 화면: core 상태머신을 스코어보드로 보여준다. 실제 UI는 M3에서 교체 */
export class MainScene extends Phaser.Scene {
  private state: GameState = newGame({ innings: 3 });
  private rng = createRng(Date.now());
  private board!: Phaser.GameObjects.Text;
  private logText!: Phaser.GameObjects.Text;
  private bases: Phaser.GameObjects.Rectangle[] = [];
  private lines: string[] = [];

  constructor() {
    super('MainScene');
  }

  create() {
    const { width, height } = this.scale;
    this.add.text(width / 2, 40, ko.title, { fontSize: '36px', color: '#ffffff' }).setOrigin(0.5);
    this.board = this.add
      .text(width / 2, 110, '', { fontSize: '26px', color: '#ffe066', align: 'center' })
      .setOrigin(0.5, 0);

    // 다이아몬드: 1루(우), 2루(상), 3루(좌)
    const cx = width / 2;
    const cy = 300;
    const d = 70;
    for (const [x, y] of [[cx + d, cy], [cx, cy - d], [cx - d, cy]] as const) {
      this.bases.push(this.add.rectangle(x, y, 32, 32, 0x444444).setAngle(45));
    }
    this.add.rectangle(cx, cy + d, 32, 32, 0xffffff).setAngle(45);

    this.logText = this.add.text(width / 2, cy + d + 50, '', {
      fontSize: '20px',
      color: '#cfe8cf',
      align: 'center',
    }).setOrigin(0.5, 0);
    this.add
      .text(width / 2, height - 30, ko.hint, { fontSize: '18px', color: '#88aa88' })
      .setOrigin(0.5);

    this.input.on('pointerdown', () => this.step());
    this.refresh();
  }

  private step() {
    if (this.state.status === 'finished') {
      this.state = newGame({ innings: 3 });
      this.lines = [];
      this.refresh();
      return;
    }
    const outcome = applyPitch(this.state, this.randomEvent(), this.rng);
    this.state = outcome.state;
    if (outcome.result) {
      this.lines.push(`${ko.result[outcome.result]}${ko.runs(outcome.runs)}`);
      this.lines = this.lines.slice(-5);
    }
    this.refresh();
  }

  private randomEvent(): PitchEvent {
    const r = this.rng();
    if (r < 0.3) return { type: 'ball' };
    if (r < 0.55) return { type: 'strike', swinging: this.rng() < 0.5 };
    if (r < 0.7) return { type: 'foul' };
    return {
      type: 'inPlay',
      kind: KINDS[Math.floor(this.rng() * KINDS.length)]!,
      quality: QUALITIES[Math.floor(this.rng() * QUALITIES.length)]!,
    };
  }

  private refresh() {
    const s = this.state;
    const head =
      s.status === 'finished'
        ? `${ko.gameOver} - ${ko.winner(s.winner!)}`
        : `${ko.inning(s.inning)} ${ko.half[s.half]} (${ko.team[battingTeam(s)]} 공격)`;
    this.board.setText(
      [
        head,
        `${ko.team.away} ${s.score.away} : ${s.score.home} ${ko.team.home}`,
        ko.count(s.balls, s.strikes, s.outs),
      ].join('\n'),
    );
    this.bases.forEach((b, i) => b.setFillStyle(s.bases[i] ? 0xffcc00 : 0x444444));
    this.logText.setText(this.lines.join('\n'));
  }
}
