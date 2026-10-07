import Phaser from 'phaser';
import {
  AVERAGE_BATTER,
  AVERAGE_PITCHER,
  DEFAULT_PITCH_PARAMS,
  PITCH_TYPES,
  applyPitch,
  createRng,
  fieldingTeam,
  newGame,
  resolvePitch,
  throwLocation,
  type BatterAction,
  type GameState,
  type Location,
  type PitchThrow,
  type PitchType,
  type Rng,
} from '@baseball/core';
import { ko } from '../i18n/ko';
import { Button } from '../ui/Button';
import { Scoreboard } from '../ui/Scoreboard';
import { ZoneGrid } from '../ui/ZoneGrid';
import {
  ZONE_CENTER,
  ZONE_SCALE,
  RELEASE_POINT,
  ballAt,
  flightMs,
  gaugeAccuracy,
  gaugePosition,
  toScreen,
} from '../game/geometry';
import { describeOutcome } from '../game/messages';

type Phase = 'pitcherPick' | 'handoff' | 'batterPick' | 'ready' | 'flight' | 'result' | 'over';

const GAUGE = { x: 60, y: 845, w: 420, h: 26 };
const READY_DELAY_MS = 800;
/** 공 도착 후에도 이 시간 안에 누르면 스윙으로 인정 */
const LATE_GRACE_MS = 250;
const RESULT_HOLD_MS = 2000;
const BAT_REST = -25;
const PITCHER_COLOR = 0xff9933;
const BATTER_COLOR = 0x44aaff;

const now = () => performance.now();

export class GameScene extends Phaser.Scene {
  private gs: GameState = newGame();
  private rng: Rng = createRng(Date.now());
  private innings = 3;
  private phase: Phase = 'pitcherPick';

  private scoreboard!: Scoreboard;
  private grid!: ZoneGrid;
  private roleText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private ball!: Phaser.GameObjects.Arc;
  private bat!: Phaser.GameObjects.Rectangle;

  // 투수 UI
  private pitcherObjs: Phaser.GameObjects.GameObject[] = [];
  private typeButtons: Button[] = [];
  private throwBtn!: Button;
  private gaugeMarker!: Phaser.GameObjects.Rectangle;
  private pitchType: PitchType | null = null;
  private gaugeStart: number | null = null;

  // 타자 UI
  private batterObjs: Phaser.GameObjects.GameObject[] = [];
  private guessButtons: Button[] = [];
  private guessType: PitchType | null = null;

  private launchAt = 0;
  private pendingThrow: PitchThrow | null = null;
  private flight: { start: number; dur: number; swingAt: number | null } | null = null;

  constructor() {
    super('GameScene');
  }

  init(data: { innings?: number }) {
    this.innings = data.innings ?? 3;
  }

  create() {
    this.gs = newGame({ innings: this.innings, maxExtraInnings: this.innings >= 9 ? 3 : 1 });
    this.rng = createRng(Date.now());
    this.pitchType = null;
    this.guessType = null;
    this.gaugeStart = null;
    this.pendingThrow = null;
    this.flight = null;
    this.typeButtons = [];
    this.guessButtons = [];

    this.drawField();
    this.scoreboard = new Scoreboard(this);
    this.roleText = this.add.text(270, 172, '', { fontSize: '22px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.titleText = this.add.text(270, 215, '', { fontSize: '44px', color: '#ffe066', fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 }).setOrigin(0.5).setDepth(10);
    this.subText = this.add.text(270, 244, '', { fontSize: '22px', color: '#ffffff', align: 'center', stroke: '#000000', strokeThickness: 4 }).setOrigin(0.5, 0).setDepth(10);
    this.hintText = this.add.text(270, 682, '', { fontSize: '17px', color: '#cfe8cf', align: 'center', wordWrap: { width: 500 } }).setOrigin(0.5, 0);

    this.grid = new ZoneGrid(this, () => this.refreshButtons());
    this.ball = this.add.circle(0, 0, 5, 0xffffff).setStrokeStyle(2, 0xcc3333).setVisible(false).setDepth(5);
    this.bat = this.add.rectangle(105, 610, 10, 150, 0xc8a165).setOrigin(0.5, 1).setAngle(BAT_REST).setDepth(6);

    this.buildPitcherPanel();
    this.buildBatterPanel();
    this.input.on('pointerdown', () => this.onSwingTap());

    this.scoreboard.update(this.gs);
    this.startPitcherPhase();
  }

  // ───────── 배경 ─────────
  private drawField() {
    const g = this.add.graphics();
    g.fillStyle(0x16331f, 1).fillRect(0, 0, 540, 960);
    g.fillStyle(0x1f4a2b, 1).fillRect(0, 200, 540, 520);
    // 마운드와 투수
    g.fillStyle(0x8a6a3a, 1).fillEllipse(RELEASE_POINT.x, RELEASE_POINT.y + 12, 70, 22);
    g.fillStyle(0xdddddd, 1).fillCircle(RELEASE_POINT.x, RELEASE_POINT.y - 22, 8);
    g.fillStyle(0x3366aa, 1).fillRect(RELEASE_POINT.x - 7, RELEASE_POINT.y - 14, 14, 24);
    // 타석 흙
    g.fillStyle(0x6b5230, 0.55).fillEllipse(ZONE_CENTER.x, ZONE_CENTER.y + 140, 460, 170);
    // 스트라이크존 테두리
    g.lineStyle(3, 0xffffff, 0.9).strokeRect(
      ZONE_CENTER.x - ZONE_SCALE,
      ZONE_CENTER.y - ZONE_SCALE,
      ZONE_SCALE * 2,
      ZONE_SCALE * 2,
    );
  }

  // ───────── 패널 생성 ─────────
  private buildPitcherPanel() {
    PITCH_TYPES.forEach((t, i) => {
      const spec = DEFAULT_PITCH_PARAMS.types[t];
      const b = new Button(this, 75 + i * 130, 775, 122, 62, `${ko.pitchType[t]}\n${spec.speed}km/h`, () => {
        if (this.phase !== 'pitcherPick' || this.gaugeStart !== null) return;
        this.pitchType = t;
        this.refreshButtons();
      }, { fontSize: '18px' });
      this.typeButtons.push(b);
      this.pitcherObjs.push(b);
    });
    this.pitcherObjs.push(this.add.text(270, 822, ko.gaugeLabel, { fontSize: '16px', color: '#cfe8cf' }).setOrigin(0.5));
    const bar = this.add.rectangle(GAUGE.x + GAUGE.w / 2, GAUGE.y, GAUGE.w, GAUGE.h, 0x333333).setStrokeStyle(2, 0x88aa88);
    const good = this.add.rectangle(GAUGE.x + GAUGE.w / 2, GAUGE.y, GAUGE.w * 0.2, GAUGE.h, 0x3fae4f);
    this.gaugeMarker = this.add.rectangle(GAUGE.x, GAUGE.y, 6, GAUGE.h + 12, 0xffffff).setVisible(false);
    this.pitcherObjs.push(bar, good, this.gaugeMarker);
    this.throwBtn = new Button(this, 270, 905, 440, 60, ko.throwBtn, () => this.onThrowButton(), {
      fontSize: '22px',
      fill: 0x8a4b12,
    });
    this.pitcherObjs.push(this.throwBtn);
  }

  private buildBatterPanel() {
    this.batterObjs.push(this.add.text(270, 750, ko.guessType, { fontSize: '16px', color: '#cfe8cf' }).setOrigin(0.5));
    PITCH_TYPES.forEach((t, i) => {
      const b = new Button(this, 75 + i * 130, 795, 122, 54, ko.pitchType[t], () => {
        if (this.phase !== 'batterPick') return;
        this.guessType = this.guessType === t ? null : t;
        this.refreshButtons();
      }, { fontSize: '20px', selectedFill: BATTER_COLOR });
      this.guessButtons.push(b);
      this.batterObjs.push(b);
    });
    this.batterObjs.push(
      new Button(this, 270, 880, 440, 64, ko.readyBtn, () => this.onReady(), { fontSize: '26px', fill: 0x1f5f8f }),
    );
  }

  private showPanel(which: 'pitcher' | 'batter' | 'none') {
    for (const o of this.pitcherObjs) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(which === 'pitcher');
    for (const o of this.batterObjs) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(which === 'batter');
    this.gaugeMarker.setVisible(false);
  }

  private refreshButtons() {
    this.typeButtons.forEach((b, i) => b.setSelected(PITCH_TYPES[i] === this.pitchType));
    this.guessButtons.forEach((b, i) => b.setSelected(PITCH_TYPES[i] === this.guessType));
    const ready = this.pitchType !== null && this.grid.getSelected() !== null;
    this.throwBtn.setEnabled(ready || this.gaugeStart !== null);
  }

  // ───────── 투수 단계 ─────────
  private startPitcherPhase() {
    this.phase = 'pitcherPick';
    this.pitchType = null;
    this.gaugeStart = null;
    this.pendingThrow = null;
    this.ball.setVisible(false);
    this.titleText.setText('');
    this.subText.setText('');
    this.bat.setAngle(BAT_REST);
    this.grid.clear();
    this.grid.setEnabled(true, PITCHER_COLOR);
    this.showPanel('pitcher');
    this.throwBtn.setText(ko.throwBtn);
    this.roleText.setText(ko.role.pitcher(fieldingTeam(this.gs))).setColor('#ffb066');
    this.hintText.setText(`${ko.pitcherHint}\n${ko.pitcherTarget}`);
    this.refreshButtons();
  }

  private onThrowButton() {
    if (this.phase !== 'pitcherPick') return;
    const target = this.grid.getSelected();
    if (this.gaugeStart === null) {
      if (!this.pitchType || !target) return;
      this.gaugeStart = now();
      this.gaugeMarker.setVisible(true);
      this.throwBtn.setText(ko.stopBtn);
      this.grid.setEnabled(false, PITCHER_COLOR);
      return;
    }
    const accuracy = gaugeAccuracy(gaugePosition(now() - this.gaugeStart));
    this.gaugeStart = null;
    if (!this.pitchType || !target) return;
    this.pendingThrow = { pitchType: this.pitchType, target, gauge: accuracy };
    this.showHandoff(ko.handoffToBatter(this.gs.half === 'top' ? 'away' : 'home'), () => this.startBatterPhase());
  }

  // ───────── 타자 단계 ─────────
  private startBatterPhase() {
    this.phase = 'batterPick';
    this.guessType = null;
    this.grid.clear();
    this.grid.setEnabled(true, BATTER_COLOR);
    this.showPanel('batter');
    this.roleText.setText(ko.role.batter(this.gs.half === 'top' ? 'away' : 'home')).setColor('#66bbff');
    this.hintText.setText(`${ko.batterHint}\n${ko.guessCell}`);
    this.refreshButtons();
  }

  private onReady() {
    if (this.phase !== 'batterPick' || !this.pendingThrow) return;
    this.phase = 'ready';
    this.grid.setEnabled(false);
    this.showPanel('none');
    this.hintText.setText('');
    this.titleText.setText(ko.getReady).setColor('#ffffff');
    // 비행 타이밍과 같은 시계(performance.now)를 쓰기 위해 update()에서 발사한다
    this.launchAt = now() + READY_DELAY_MS;
  }

  private launchPitch() {
    if (this.phase !== 'ready' || !this.pendingThrow) return;
    const speed = DEFAULT_PITCH_PARAMS.types[this.pendingThrow.pitchType].speed;
    this.phase = 'flight';
    this.flight = { start: now(), dur: flightMs(speed), swingAt: null };
    this.titleText.setText('');
    this.hintText.setText(ko.swingHint).setColor('#ffffff');
    this.ball.setVisible(true);
  }

  private onSwingTap() {
    if (this.phase !== 'flight' || !this.flight || this.flight.swingAt !== null) return;
    this.flight.swingAt = now();
    this.tweens.add({ targets: this.bat, angle: { from: BAT_REST, to: 100 }, duration: 140 });
  }

  update() {
    if (this.phase === 'ready' && now() >= this.launchAt) this.launchPitch();
    if (this.gaugeStart !== null) {
      const pos = gaugePosition(now() - this.gaugeStart);
      this.gaugeMarker.setPosition(GAUGE.x + GAUGE.w * pos, GAUGE.y);
    }
    if (this.phase !== 'flight' || !this.flight || !this.pendingThrow) return;

    const f = this.flight;
    const t = (now() - f.start) / f.dur;
    // 화면에 보이는 공은 "실제 위치"로 날아간다 (투수 시점에서 코스를 숨기려면 변화구 오프셋이 눈속임이 됨)
    const preview = this.previewLocation();
    const p = ballAt(t, preview, this.pendingThrow.pitchType);
    this.ball.setPosition(p.x, p.y).setRadius(p.r);

    const arrival = f.start + f.dur;
    const tapped = f.swingAt !== null && now() >= arrival;
    if (tapped || now() >= arrival + LATE_GRACE_MS) this.resolve();
  }

  /** 비행 중 공이 향하는 실제 위치. 투구 순간에 한 번 정해 판정까지 그대로 쓴다 */
  private previewLoc: Location | null = null;

  private previewLocation(): Location {
    if (!this.previewLoc) {
      this.previewLoc = throwLocation(this.pendingThrow!, AVERAGE_PITCHER, this.rng);
    }
    return this.previewLoc;
  }

  private resolve() {
    const f = this.flight;
    const pitch = this.pendingThrow;
    const actual = this.previewLoc;
    if (!f || !pitch || !actual) return;
    this.phase = 'result';
    this.flight = null;
    this.roleText.setText('');

    const swing = f.swingAt !== null;
    const timingMs = swing ? f.swingAt! - (f.start + f.dur) : 0;
    const guessCell = this.grid.getSelected();
    const action: BatterAction = { swing, timingMs };
    if (this.guessType || guessCell) {
      action.guess = {};
      if (this.guessType) action.guess.pitchType = this.guessType;
      if (guessCell) action.guess.cell = guessCell;
    }

    const detail = resolvePitch(pitch, action, AVERAGE_PITCHER, AVERAGE_BATTER, this.rng, DEFAULT_PITCH_PARAMS, actual);
    const out = applyPitch(this.gs, detail.event, this.rng);
    this.gs = out.state;

    const msg = describeOutcome(detail.event, out.result, out.runs);
    const spec = DEFAULT_PITCH_PARAMS.types[pitch.pitchType];
    this.titleText.setText(msg.title).setColor(out.runs > 0 || out.result === 'homeRun' ? '#ffcc33' : '#ffffff');
    this.subText.setText(
      [msg.sub, swing ? ko.timing(timingMs) : ko.noSwing, ko.pitchInfo(pitch.pitchType, spec.speed)]
        .filter(Boolean)
        .join('\n'),
    );
    this.hintText.setText('');
    this.scoreboard.update(this.gs);
    this.previewLoc = null;

    this.time.delayedCall(RESULT_HOLD_MS, () => {
      if (this.gs.status === 'finished') this.showGameOver();
      else this.showHandoff(ko.handoffToPitcher(fieldingTeam(this.gs)), () => this.startPitcherPhase());
    });
  }

  // ───────── 오버레이 ─────────
  private showHandoff(text: string, onTap: () => void) {
    this.phase = 'handoff';
    this.showPanel('none');
    this.grid.setEnabled(false);
    this.ball.setVisible(false);
    const c = this.add.container(0, 0).setDepth(100);
    const bg = this.add.rectangle(270, 480, 540, 960, 0x0b1d12, 1).setInteractive();
    const t1 = this.add.text(270, 440, text, { fontSize: '28px', color: '#ffffff', align: 'center', wordWrap: { width: 440 } }).setOrigin(0.5);
    const t2 = this.add.text(270, 540, ko.tapWhenReady, { fontSize: '20px', color: '#88aa88' }).setOrigin(0.5);
    c.add([bg, t1, t2]);
    this.time.delayedCall(350, () =>
      bg.once('pointerdown', () => {
        c.destroy();
        onTap();
      }),
    );
  }

  private showGameOver() {
    this.phase = 'over';
    const c = this.add.container(0, 0).setDepth(100);
    c.add(this.add.rectangle(270, 480, 540, 960, 0x0b1d12, 0.94).setInteractive());
    c.add(this.add.text(270, 330, ko.gameOver, { fontSize: '40px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5));
    c.add(this.add.text(270, 400, ko.winner(this.gs.winner!), { fontSize: '34px', color: '#ffe066' }).setOrigin(0.5));
    c.add(
      this.add
        .text(270, 460, `${ko.team.away} ${this.gs.score.away} : ${this.gs.score.home} ${ko.team.home}`, { fontSize: '30px', color: '#ffffff' })
        .setOrigin(0.5),
    );
    c.add(new Button(this, 270, 580, 300, 64, ko.again, () => this.scene.restart({ innings: this.innings }), { fontSize: '26px' }));
    c.add(new Button(this, 270, 660, 300, 64, ko.toTitle, () => this.scene.start('TitleScene'), { fontSize: '26px' }));
  }
}
