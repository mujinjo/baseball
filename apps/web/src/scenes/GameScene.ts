import Phaser from 'phaser';
import {
  AVERAGE_BATTER,
  AVERAGE_PITCHER,
  DEFAULT_PITCH_PARAMS,
  PITCH_TYPES,
  aiBatterAction,
  aiChoosePitch,
  aiGauge,
  applyPitch,
  createRng,
  fieldingTeam,
  newGame,
  resolvePitch,
  throwLocation,
  type AiLevel,
  type BatterAction,
  type GameState,
  type Location,
  type PastPitch,
  type PitchThrow,
  type PitchType,
  type Rng,
  type Team,
} from '@baseball/core';
import { ko } from '../i18n/ko';
import { Button } from '../ui/Button';
import { Scoreboard } from '../ui/Scoreboard';
import { FieldView } from '../ui/FieldView';
import { ZoneGrid } from '../ui/ZoneGrid';
import {
  RELEASE_POINT,
  ZONE_CENTER,
  ZONE_SCALE,
  ballAt,
  flightMs,
  gaugeAccuracy,
  gaugePosition,
} from '../game/geometry';
import { describeOutcome } from '../game/messages';
import type { GameOptions } from './TitleScene';

/**
 * pitcherPick: 사람이 구종/코스를 고르는 중
 * gauge:       코스를 고르자마자 시작된 제구 게이지가 움직이는 중
 * ready:       투구 직전 짧은 대기
 * flight:      공이 날아오는 중 (사람 타자는 이때 터치해 스윙)
 * result:      결과 표시
 */
type Phase = 'pitcherPick' | 'gauge' | 'ready' | 'flight' | 'result' | 'over';

const GAUGE = { x: 60, y: 845, w: 420, h: 26 };
const AI_PITCH_DELAY_MS = 1000;
const THROW_DELAY_MS = 250;
/** 사람 타자는 공 도착 후에도 이 시간 안에 누르면 스윙으로 인정 */
const LATE_GRACE_MS = 150;
const RESULT_HOLD_MS = 2000;
const BAT_REST = -15;
/** 타자(우타자, 포수 시점에서 왼쪽에 선다)의 위치. 손 위치가 배트 축 */
const BATTER = { x: 95, hands: { x: 150, y: 440 } };
const PITCHER_COLOR = 0xff9933;

const now = () => performance.now();

export class GameScene extends Phaser.Scene {
  private gs: GameState = newGame();
  private rng: Rng = createRng(Date.now());
  private innings = 3;
  private level: AiLevel = 'normal';
  private humanTeam: Team = 'away';
  private phase: Phase = 'pitcherPick';

  private scoreboard!: Scoreboard;
  private grid!: ZoneGrid;
  private roleText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private subText!: Phaser.GameObjects.Text;
  private ball!: Phaser.GameObjects.Arc;
  private bat!: Phaser.GameObjects.Rectangle;
  private fieldView!: FieldView;

  // 투수 패널
  private pitcherObjs: Phaser.GameObjects.GameObject[] = [];
  private typeButtons: Button[] = [];
  private stopBtn!: Button;
  private gaugeMarker!: Phaser.GameObjects.Rectangle;
  private pitchType: PitchType = 'fastball';
  private gaugeStart = 0;
  private pendingTarget: Location | null = null;

  // 투구 진행
  private pendingThrow: PitchThrow | null = null;
  private previewLoc: Location | null = null;
  private launchAt = 0;
  private flight: { start: number; dur: number; swingAt: number | null; aiDecided: boolean; batSwung: boolean } | null = null;
  private history: PastPitch[] = [];

  constructor() {
    super('GameScene');
  }

  init(data: Partial<GameOptions>) {
    this.innings = data.innings ?? 3;
    this.level = data.level ?? 'normal';
    this.humanTeam = data.humanTeam ?? 'away';
  }

  private get humanPitching() {
    return fieldingTeam(this.gs) === this.humanTeam;
  }

  create() {
    this.gs = newGame({ innings: this.innings, maxExtraInnings: this.innings >= 9 ? 3 : 1 });
    this.rng = createRng(Date.now());
    this.phase = 'pitcherPick';
    this.pendingThrow = null;
    this.previewLoc = null;
    this.flight = null;
    this.history = [];
    this.typeButtons = [];
    this.pitcherObjs = [];

    this.drawField();
    this.scoreboard = new Scoreboard(this);
    this.roleText = this.add.text(270, 172, '', { fontSize: '20px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5, 0);
    this.titleText = this.add
      .text(270, 215, '', { fontSize: '44px', color: '#ffe066', fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(60);
    this.subText = this.add
      .text(270, 244, '', { fontSize: '22px', color: '#ffffff', align: 'center', stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5, 0)
      .setDepth(60);
    this.hintText = this.add
      .text(270, 682, '', { fontSize: '17px', color: '#cfe8cf', align: 'center', wordWrap: { width: 500 } })
      .setOrigin(0.5, 0);

    this.grid = new ZoneGrid(this, (cell) => this.onCourseSelected(cell.center));
    this.ball = this.add.circle(0, 0, 5, 0xffffff).setStrokeStyle(2, 0xcc3333).setVisible(false).setDepth(5);
    this.bat = this.add.rectangle(BATTER.hands.x, BATTER.hands.y, 9, 130, 0xc8a165).setOrigin(0.5, 1).setAngle(BAT_REST).setDepth(6);
    this.fieldView = new FieldView(this);

    this.buildPitcherPanel();
    this.input.on('pointerdown', () => this.onSwingTap());
    this.input.keyboard?.on('keydown-SPACE', () => {
      if (this.phase === 'gauge') this.onStop();
      else this.onSwingTap();
    });

    this.scoreboard.update(this.gs);
    this.startPitch();
  }

  // ───────── 배경 ─────────
  private drawField() {
    const g = this.add.graphics();
    g.fillStyle(0x16331f, 1).fillRect(0, 0, 540, 960);
    g.fillStyle(0x1f4a2b, 1).fillRect(0, 200, 540, 520);
    g.fillStyle(0x8a6a3a, 1).fillEllipse(RELEASE_POINT.x, RELEASE_POINT.y + 12, 70, 22);
    g.fillStyle(0xdddddd, 1).fillCircle(RELEASE_POINT.x, RELEASE_POINT.y - 22, 8);
    g.fillStyle(0x3366aa, 1).fillRect(RELEASE_POINT.x - 7, RELEASE_POINT.y - 14, 14, 24);
    g.fillStyle(0x6b5230, 0.55).fillEllipse(ZONE_CENTER.x, ZONE_CENTER.y + 105, 400, 130);
    this.drawBatter(g);
    g.lineStyle(3, 0xffffff, 0.9).strokeRect(
      ZONE_CENTER.x - ZONE_SCALE,
      ZONE_CENTER.y - ZONE_SCALE,
      ZONE_SCALE * 2,
      ZONE_SCALE * 2,
    );
  }

  /** 타자: 스트라이크존(무릎~가슴)의 2배쯤 되는 키로 그려 존의 상대적 크기를 보여준다 */
  private drawBatter(g: Phaser.GameObjects.Graphics) {
    const { x, hands } = BATTER;
    g.fillStyle(0x2c2c3a, 1).fillRect(x - 18, 468, 14, 134).fillRect(x + 4, 468, 14, 134); // 다리
    g.fillStyle(0xcc4444, 1).fillRect(x - 22, 352, 44, 120); // 상체
    g.lineStyle(10, 0xcc4444, 1).lineBetween(x + 14, 372, hands.x, hands.y); // 팔
    g.fillStyle(0xf0c9a0, 1).fillCircle(hands.x, hands.y, 7); // 손
    g.fillStyle(0xf0c9a0, 1).fillCircle(x, 332, 17); // 얼굴
    g.fillStyle(0x224488, 1).fillRect(x - 19, 312, 38, 14); // 헬멧
  }

  // ───────── 투수 패널 ─────────
  private buildPitcherPanel() {
    PITCH_TYPES.forEach((t, i) => {
      const spec = DEFAULT_PITCH_PARAMS.types[t];
      const b = new Button(
        this,
        75 + i * 130,
        775,
        122,
        62,
        `${ko.pitchType[t]}\n${spec.speed}km/h`,
        () => {
          if (this.phase !== 'pitcherPick') return;
          this.pitchType = t;
          this.refreshTypeButtons();
        },
        { fontSize: '18px' },
      );
      this.typeButtons.push(b);
      this.pitcherObjs.push(b);
    });
    this.pitcherObjs.push(this.add.text(270, 822, ko.gaugeLabel, { fontSize: '16px', color: '#cfe8cf' }).setOrigin(0.5));
    const bar = this.add.rectangle(GAUGE.x + GAUGE.w / 2, GAUGE.y, GAUGE.w, GAUGE.h, 0x333333).setStrokeStyle(2, 0x88aa88);
    const good = this.add.rectangle(GAUGE.x + GAUGE.w / 2, GAUGE.y, GAUGE.w * 0.2, GAUGE.h, 0x3fae4f);
    this.gaugeMarker = this.add.rectangle(GAUGE.x, GAUGE.y, 6, GAUGE.h + 12, 0xffffff).setVisible(false);
    this.pitcherObjs.push(bar, good, this.gaugeMarker);
    this.stopBtn = new Button(this, 270, 905, 440, 60, ko.waitCourse, () => this.onStop(), {
      fontSize: '24px',
      fill: 0x8a4b12,
    });
    this.pitcherObjs.push(this.stopBtn);
  }

  private showPitcherPanel(visible: boolean) {
    for (const o of this.pitcherObjs) (o as unknown as Phaser.GameObjects.Components.Visible).setVisible(visible);
    this.gaugeMarker.setVisible(false);
  }

  private refreshTypeButtons() {
    this.typeButtons.forEach((b, i) => b.setSelected(PITCH_TYPES[i] === this.pitchType));
  }

  // ───────── 투구 시작 (사람 투수 / 컴퓨터 투수) ─────────
  private resetVisuals() {
    this.fieldView.hide();
    this.ball.setVisible(false);
    this.titleText.setText('');
    this.subText.setText('');
    this.bat.setAngle(BAT_REST);
    this.grid.clear();
    this.grid.setEnabled(false);
  }

  private startPitch() {
    this.resetVisuals();
    this.pendingThrow = null;
    this.previewLoc = null;
    if (this.humanPitching) this.startHumanPitch();
    else this.startAiPitch();
  }

  private startHumanPitch() {
    this.phase = 'pitcherPick';
    this.showPitcherPanel(true);
    this.grid.setEnabled(true, PITCHER_COLOR);
    this.stopBtn.setText(ko.waitCourse).setEnabled(false);
    this.refreshTypeButtons();
    this.roleText.setText(ko.role.pitcher(this.humanTeam)).setColor('#ffb066');
    this.hintText.setText(ko.pitcherHint);
  }

  /** 코스를 고르는 즉시 제구 게이지가 움직이기 시작한다 */
  private onCourseSelected(target: Location) {
    if (this.phase !== 'pitcherPick') return;
    this.pendingTarget = target;
    this.phase = 'gauge';
    this.gaugeStart = now();
    this.gaugeMarker.setVisible(true);
    this.grid.setEnabled(false, PITCHER_COLOR);
    this.stopBtn.setText(ko.stopBtn).setEnabled(true);
    this.hintText.setText(ko.pitcherGauge);
  }

  private onStop() {
    if (this.phase !== 'gauge' || !this.pendingTarget) return;
    const accuracy = gaugeAccuracy(gaugePosition(now() - this.gaugeStart));
    this.pendingThrow = { pitchType: this.pitchType, target: this.pendingTarget, gauge: accuracy };
    this.stopBtn.setEnabled(false);
    this.hintText.setText('');
    this.phase = 'ready';
    this.launchAt = now() + THROW_DELAY_MS;
  }

  private startAiPitch() {
    this.phase = 'ready';
    this.showPitcherPanel(false);
    const choice = aiChoosePitch(this.gs, this.history, this.level, this.rng);
    this.history.push(choice);
    this.pendingThrow = { ...choice, gauge: aiGauge(this.level, this.rng) };
    this.roleText.setText(ko.role.batter(this.humanTeam)).setColor('#66bbff');
    this.hintText.setText(ko.batterHint);
    this.titleText.setText(ko.getReady).setColor('#ffffff');
    this.launchAt = now() + AI_PITCH_DELAY_MS;
  }

  // ───────── 비행 ─────────
  private launchPitch() {
    const pitch = this.pendingThrow;
    if (!pitch) return;
    const dur = flightMs(DEFAULT_PITCH_PARAMS.types[pitch.pitchType].speed);
    const start = now();
    this.previewLoc = throwLocation(pitch, AVERAGE_PITCHER, this.rng);
    this.phase = 'flight';
    this.titleText.setText('');
    this.ball.setVisible(true);

    if (this.humanPitching) {
      // 컴퓨터 타자: 공을 보고 스윙 여부와 타이밍을 정한다
      const a = aiBatterAction(this.previewLoc, this.gs.strikes, this.level, this.rng);
      this.flight = { start, dur, swingAt: a.swing ? start + dur + a.timingMs : null, aiDecided: true, batSwung: false };
      this.hintText.setText('');
    } else {
      this.flight = { start, dur, swingAt: null, aiDecided: false, batSwung: false };
      this.hintText.setText(ko.swingHint);
    }
  }

  /** 사람 타자의 스윙 입력 */
  private onSwingTap() {
    const f = this.flight;
    if (this.phase !== 'flight' || !f || f.aiDecided || f.swingAt !== null) return;
    f.swingAt = now();
  }

  update() {
    if (this.phase === 'gauge') {
      const pos = gaugePosition(now() - this.gaugeStart);
      this.gaugeMarker.setPosition(GAUGE.x + GAUGE.w * pos, GAUGE.y);
    }
    if (this.phase === 'ready' && now() >= this.launchAt) this.launchPitch();
    if (this.phase !== 'flight' || !this.flight || !this.pendingThrow || !this.previewLoc) return;

    const f = this.flight;
    const t = (now() - f.start) / f.dur;
    const p = ballAt(t, this.previewLoc, this.pendingThrow.pitchType);
    this.ball.setPosition(p.x, p.y).setRadius(p.r);

    if (f.swingAt !== null && !f.batSwung && now() >= f.swingAt) {
      f.batSwung = true;
      this.tweens.add({ targets: this.bat, angle: { from: BAT_REST, to: 110 }, duration: 140 });
    }

    const arrival = f.start + f.dur;
    const done = f.aiDecided
      ? now() >= (f.swingAt !== null ? Math.max(arrival, f.swingAt) : arrival)
      : f.swingAt !== null
        ? now() >= arrival
        : now() >= arrival + LATE_GRACE_MS;
    if (done) this.resolve();
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
    const action: BatterAction = { swing, timingMs };
    const detail = resolvePitch(pitch, action, AVERAGE_PITCHER, AVERAGE_BATTER, this.rng, DEFAULT_PITCH_PARAMS, actual);
    const out = applyPitch(this.gs, detail.event, this.rng);
    this.gs = out.state;

    const spec = DEFAULT_PITCH_PARAMS.types[pitch.pitchType];
    const trace = out.trace;
    const showResult = () => {
      const msg = describeOutcome(detail.event, out.result, out.runs, trace?.distanceM);
      // 구장 화면이 떠 있으면 글자를 아래쪽에 둔다
      this.titleText.setY(trace ? 838 : 215);
      this.subText.setY(trace ? 868 : 244);
      this.titleText.setText(msg.title).setColor(out.runs > 0 || out.result === 'homeRun' ? '#ffcc33' : '#ffffff');
      this.subText.setText(
        [msg.sub, swing ? ko.timing(timingMs) : ko.noSwing, ko.pitchInfo(pitch.pitchType, spec.speed)]
          .filter(Boolean)
          .join('\n'),
      );
      this.scoreboard.update(this.gs);
      this.time.delayedCall(RESULT_HOLD_MS, () => {
        this.fieldView.hide();
        this.titleText.setY(215);
        this.subText.setY(244);
        if (this.gs.status === 'finished') this.showGameOver();
        else this.startPitch();
      });
    };

    this.hintText.setText('');
    this.showPitcherPanel(false);
    this.previewLoc = null;
    if (trace) {
      // 컨택: 타구가 날아가는 모습을 먼저 보여주고 결과를 띄운다
      this.ball.setVisible(false);
      this.fieldView.show(trace, showResult);
    } else {
      showResult();
    }
  }

  // ───────── 경기 종료 ─────────
  private showGameOver() {
    this.phase = 'over';
    const w = this.gs.winner;
    const verdict = w === 'draw' ? ko.draw : w === this.humanTeam ? ko.youWin : ko.youLose;
    const c = this.add.container(0, 0).setDepth(100);
    c.add(this.add.rectangle(270, 480, 540, 960, 0x0b1d12, 0.94).setInteractive());
    c.add(this.add.text(270, 330, ko.gameOver, { fontSize: '40px', color: '#ffffff', fontStyle: 'bold' }).setOrigin(0.5));
    c.add(this.add.text(270, 400, verdict, { fontSize: '38px', color: '#ffe066', fontStyle: 'bold' }).setOrigin(0.5));
    c.add(
      this.add
        .text(270, 465, `${ko.team.away} ${this.gs.score.away} : ${this.gs.score.home} ${ko.team.home}`, {
          fontSize: '30px',
          color: '#ffffff',
        })
        .setOrigin(0.5),
    );
    const opts: GameOptions = { innings: this.innings, level: this.level, humanTeam: this.humanTeam };
    c.add(new Button(this, 270, 580, 300, 64, ko.again, () => this.scene.restart(opts), { fontSize: '26px' }));
    c.add(new Button(this, 270, 660, 300, 64, ko.toTitle, () => this.scene.start('TitleScene'), { fontSize: '26px' }));
  }
}
