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
import { Batter, SWING_CONTACT_MS } from '../ui/Batter';
import { FieldView } from '../ui/FieldView';
import { ZoneGrid } from '../ui/ZoneGrid';
import {
  GROUND_Y,
  PLATE_WIDTH_M,
  RELEASE_POINT,
  ZONE_CENTER,
  ZONE_SCALE_X,
  ZONE_SCALE_Y,
  ballAt,
  flightMs,
  gaugeAccuracy,
  gaugePosition,
  project,
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
const PITCHER_COLOR = 0xff9933;
/** 결과 문구는 하늘(위쪽) 영역에 띄운다. 구장 화면(타구 연출) 중에는 아래쪽으로 옮긴다 */
const TITLE_Y = 160;
const SUB_Y = 190;

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
  /** 개발/테스트에서 스윙 자세를 확인하기 위해 외부에서 접근할 수 있게 둔다 */
  batter!: Batter;
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
    this.roleText = this.add
      .text(270, 112, '', { fontSize: '18px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5, 0)
      .setDepth(25);
    this.titleText = this.add
      .text(270, TITLE_Y, '', { fontSize: '44px', color: '#ffe066', fontStyle: 'bold', stroke: '#000000', strokeThickness: 5 })
      .setOrigin(0.5)
      .setDepth(60);
    this.subText = this.add
      .text(270, SUB_Y, '', { fontSize: '22px', color: '#ffffff', align: 'center', stroke: '#000000', strokeThickness: 4 })
      .setOrigin(0.5, 0)
      .setDepth(60);
    this.hintText = this.add
      .text(270, 714, '', { fontSize: '16px', color: '#cfe8cf', align: 'center', wordWrap: { width: 520 }, stroke: '#000000', strokeThickness: 3 })
      .setOrigin(0.5, 0)
      .setDepth(30);

    this.grid = new ZoneGrid(this, (cell) => this.onCourseSelected(cell.center));
    this.ball = this.add.circle(0, 0, 5, 0xffffff).setStrokeStyle(2, 0xcc3333).setVisible(false).setDepth(5);
    this.batter = new Batter(this);
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
  /**
   * 야간 구장을 타자 뒤 낮은 시점에서 본 장면. 홈플레이트·타석 박스·파울 라인은 3D 투영(geometry.project)으로 그리고,
   * 멀리 있는 마운드·야수·관중석·전광판은 같은 카메라 기준 위치에 배치한다.
   */
  private drawField() {
    const g = this.add.graphics();
    const W = 540;
    // 간단한 시드 난수(장식용 점 배치가 항상 같도록)
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);

    // 밤하늘
    [0x03050b, 0x060a14, 0x0a1120, 0x0f192d].forEach((c, i) => g.fillStyle(c, 1).fillRect(0, i * 90, W, 92));
    // 멀리 보이는 도시 스카이라인
    for (let x = 0; x < W; x += 34) {
      const h = 30 + Math.floor(rnd() * 70);
      g.fillStyle(0x0b101b, 1).fillRect(x, 440 - h, 32, h + 40);
      for (let k = 0; k < 6; k++) {
        if (rnd() > 0.5) g.fillStyle(0x6a6a45, 0.7).fillRect(x + 4 + (k % 3) * 9, 440 - h + 6 + Math.floor(k / 3) * 14, 4, 6);
      }
    }
    // 조명탑
    g.fillStyle(0x1b1f28, 1).fillRect(5, 250, 5, 220);
    g.fillStyle(0xaec8ff, 0.1).fillCircle(16, 234, 70).fillCircle(16, 234, 40);
    g.fillStyle(0xf2f7ff, 1).fillRect(-2, 214, 36, 40);
    for (let i = 0; i < 12; i++) g.fillStyle(0xc8d4e8, 1).fillRect(1 + (i % 4) * 8, 218 + Math.floor(i / 4) * 12, 6, 8);

    // 대형 전광판
    g.fillStyle(0x090d18, 1).fillRect(226, 312, 236, 112);
    g.fillStyle(0x12347a, 1).fillRect(231, 317, 226, 102);
    g.fillStyle(0x0b2150, 1).fillRect(231, 317, 226, 14);
    for (let i = 0; i < 14; i++) g.fillStyle(0xdfe7ff, 0.85).fillRect(236 + i * 15, 320, 10, 7);
    g.fillStyle(0x0a1a44, 1).fillRect(236, 336, 100, 78).fillRect(342, 336, 110, 78);
    for (let r = 0; r < 7; r++) {
      g.fillStyle(r % 3 === 0 ? 0xffd23f : 0xdfe7ff, 0.8).fillRect(240, 340 + r * 10, 30 + ((r * 37) % 50), 5);
      g.fillStyle(0xdfe7ff, 0.7).fillRect(346, 340 + r * 10, 24 + ((r * 53) % 70), 5);
    }
    g.fillStyle(0xc41e2a, 1).fillRect(346, 398, 102, 14);

    // 관중석
    g.fillStyle(0x171a22, 1).fillRect(0, 428, W, 52);
    for (let i = 0; i < 260; i++) {
      const c = [0x7a3b3b, 0x3b5a7a, 0xb0a070, 0x4a4a55, 0xc04040][Math.floor(rnd() * 5)]!;
      g.fillStyle(c, 0.8).fillRect(Math.floor(rnd() * W), 432 + Math.floor(rnd() * 44), 3, 3);
    }
    // 외야 펜스와 광고판
    g.fillStyle(0x0f1830, 1).fillRect(0, 479, W, 24);
    const ads = [0x1f4fb0, 0xf2f2f2, 0x1f7a3a, 0xb02a2a, 0xf0b020];
    for (let i = 0; i < 11; i++) {
      const c = ads[i % ads.length]!;
      g.fillStyle(c, 1).fillRect(i * 50 + 2, 483, 46, 16);
      g.fillStyle(c === 0xf2f2f2 || c === 0xf0b020 ? 0x222222 : 0xffffff, 0.8).fillRect(i * 50 + 8, 488, 34, 5);
    }
    // 외야~내야 잔디(줄무늬)
    const bands = [503, 520, 540, 565, 595, 630];
    bands.forEach((y0, i) => {
      const y1 = bands[i + 1] ?? 660;
      g.fillStyle(i % 2 ? 0x1f6a2e : 0x1a5c28, 1).fillRect(0, y0, W, y1 - y0);
    });

    // 마운드 (투수까지 18.44m)
    const m = project({ x: 0, y: 18.44, z: 0 });
    g.fillStyle(0x9a5f38, 1).fillEllipse(m.x, m.y, 5.5 * m.scale, 0.45 * m.scale);
    g.fillStyle(0xf2f2f2, 1).fillRect(m.x - 0.3 * m.scale, m.y - 0.05 * m.scale, 0.6 * m.scale, 0.05 * m.scale);
    // 야수와 베이스 (실제 위치는 화면 밖이라 보이도록 옮겨 둠)
    const fielder = (x: number, y: number, h: number, shirt: number) => {
      g.fillStyle(0x000000, 0.25).fillEllipse(x, y + 1, h * 0.5, h * 0.12);
      g.fillStyle(0xeeeeee, 1).fillRect(x - h * 0.12, y - h * 0.42, h * 0.24, h * 0.42); // 바지
      g.fillStyle(shirt, 1).fillRect(x - h * 0.13, y - h * 0.78, h * 0.26, h * 0.38); // 상의
      g.fillStyle(0xd9a07a, 1).fillCircle(x, y - h * 0.86, h * 0.1);
      g.fillStyle(0xc41e2a, 1).fillRect(x - h * 0.11, y - h * 0.97, h * 0.22, h * 0.07);
    };
    const base = (x: number, y: number, w: number) => {
      g.fillStyle(0xffffff, 1).fillPoints(
        [
          { x: x - w / 2, y },
          { x, y: y - w * 0.22 },
          { x: x + w / 2, y },
          { x, y: y + w * 0.22 },
        ],
        true,
      );
    };
    base(470, 516, 22);
    base(210, 516, 22);
    base(392, 498, 14);
    fielder(470, 512, 30, 0xc41e2a); // 1루수
    fielder(392, 494, 26, 0xc41e2a); // 2루수
    fielder(298, 494, 26, 0xc41e2a); // 유격수
    fielder(210, 512, 30, 0xc41e2a); // 3루수
    // 투수 (마운드 위)
    const ps = m.scale;
    const px = m.x;
    const py = m.y - 0.15 * ps;
    g.fillStyle(0x000000, 0.25).fillEllipse(px, py + 1, 0.8 * ps, 0.18 * ps);
    g.fillStyle(0xf2f2f2, 1).fillRect(px - 0.17 * ps, py - 0.9 * ps, 0.34 * ps, 0.9 * ps); // 하의
    g.fillStyle(0xc41e2a, 1).fillRect(px - 0.19 * ps, py - 1.5 * ps, 0.38 * ps, 0.62 * ps); // 상의
    g.fillStyle(0xd9a07a, 1).fillCircle(px, py - 1.62 * ps, 0.11 * ps);
    g.fillStyle(0xc41e2a, 1).fillRect(px - 0.12 * ps, py - 1.76 * ps, 0.24 * ps, 0.1 * ps);

    // 내야 흙: 홈 쪽으로 넓게
    g.fillStyle(0x9c5d3b, 1).fillEllipse(336, 842, 1180, 424);
    g.fillStyle(0xa86a44, 1).fillEllipse(336, 800, 640, 170);
    for (let i = 0; i < 220; i++) {
      const x = Math.floor(rnd() * W);
      const y = 640 + Math.floor(rnd() * 320);
      g.fillStyle(rnd() > 0.5 ? 0x88502f : 0xb57a4e, 0.55).fillRect(x, y, 2 + Math.floor(rnd() * 3), 2);
    }

    // 파울 라인과 타석 박스(흰 선)
    const plateHalf = PLATE_WIDTH_M / 2;
    g.lineStyle(5, 0xf3f0e8, 0.95);
    for (const side of [-1, 1]) {
      const a0 = project({ x: side * plateHalf, y: 0, z: 0 });
      const a1 = project({ x: side * 3.4, y: 3.4, z: 0 });
      g.lineBetween(a0.x, a0.y, a1.x, a1.y);
    }
    const boxIn = plateHalf + 0.152;
    const boxOut = boxIn + 1.219;
    const boxY = 0.914;
    for (const side of [-1, 1]) {
      g.strokePoints(
        [
          project({ x: side * boxIn, y: boxY, z: 0 }),
          project({ x: side * boxOut, y: boxY, z: 0 }),
          project({ x: side * boxOut, y: -boxY, z: 0 }),
          project({ x: side * boxIn, y: -boxY, z: 0 }),
        ],
        true,
      );
    }
    // 홈플레이트(오각형): 평평한 변이 투수 쪽
    const plate = [
      project({ x: -plateHalf, y: 0.216, z: 0 }),
      project({ x: plateHalf, y: 0.216, z: 0 }),
      project({ x: plateHalf, y: 0, z: 0 }),
      project({ x: 0, y: -0.216, z: 0 }),
      project({ x: -plateHalf, y: 0, z: 0 }),
    ];
    g.fillStyle(0xf1eee6, 1).fillPoints(plate, true);
    g.lineStyle(2, 0x777777, 0.9).strokePoints(plate, true);

    // 스트라이크존 테두리
    g.lineStyle(2, 0xffffff, 0.9).strokeRect(
      ZONE_CENTER.x - ZONE_SCALE_X,
      ZONE_CENTER.y - ZONE_SCALE_Y,
      ZONE_SCALE_X * 2,
      ZONE_SCALE_Y * 2,
    );
  }

  // ───────── 투수 패널 ─────────
  private buildPitcherPanel() {
    this.pitcherObjs.push(this.add.rectangle(270, 742, 540, 218, 0x0a1610, 0.86).setOrigin(0.5, 0));
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
    // 타자·공보다 위에 그려야 하단 조작부가 가려지지 않는다
    this.pitcherObjs.forEach((o, i) => (o as unknown as Phaser.GameObjects.Components.Depth).setDepth(i === 0 ? 15 : 16));
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
    this.batter.reset();
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
    this.hintText.setY(714).setText(ko.pitcherHint);
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
    this.hintText.setY(900).setText(ko.batterHint);
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
      // timingMs는 배트가 닿는 시점 기준이므로, 스윙 시작은 그만큼 앞선다
      const swingAt = a.swing ? Math.max(start, start + dur + a.timingMs - SWING_CONTACT_MS) : null;
      this.flight = { start, dur, swingAt, aiDecided: true, batSwung: false };
      this.hintText.setText('');
    } else {
      this.flight = { start, dur, swingAt: null, aiDecided: false, batSwung: false };
      this.hintText.setY(900).setText(ko.swingHint);
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
      this.batter.swing(this.previewLoc);
    }

    const arrival = f.start + f.dur;
    const contactAt = f.swingAt !== null ? f.swingAt + SWING_CONTACT_MS : null;
    // 스윙했다면 공 도착과 배트 접촉 중 늦은 쪽에서 판정한다. 사람 타자는 도착 후 잠깐 더 기다려 준다
    const done =
      contactAt !== null
        ? now() >= Math.max(arrival, contactAt)
        : now() >= (f.aiDecided ? arrival : arrival + LATE_GRACE_MS);
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
    // 판정 기준: 배트가 닿는 시점이 공 도착 시점보다 얼마나 빠른지/늦은지
    const timingMs = swing ? f.swingAt! + SWING_CONTACT_MS - (f.start + f.dur) : 0;
    const action: BatterAction = { swing, timingMs };
    const detail = resolvePitch(pitch, action, AVERAGE_PITCHER, AVERAGE_BATTER, this.rng, DEFAULT_PITCH_PARAMS, actual);
    const out = applyPitch(this.gs, detail.event, this.rng);
    this.gs = out.state;

    const spec = DEFAULT_PITCH_PARAMS.types[pitch.pitchType];
    const trace = out.trace;
    const showResult = () => {
      const msg = describeOutcome(detail.event, out.result, out.runs, trace?.distanceM);
      // 구장 화면이 떠 있으면 글자를 아래쪽에 둔다
      this.titleText.setY(trace ? 838 : TITLE_Y);
      this.subText.setY(trace ? 868 : SUB_Y);
      this.titleText.setText(msg.title).setColor(out.runs > 0 || out.result === 'homeRun' ? '#ffcc33' : '#ffffff');
      this.subText.setText(
        [msg.sub, swing ? ko.timing(timingMs) : ko.noSwing, ko.pitchInfo(pitch.pitchType, spec.speed)]
          .filter(Boolean)
          .join('\n'),
      );
      this.scoreboard.update(this.gs);
      this.time.delayedCall(RESULT_HOLD_MS, () => {
        this.fieldView.hide();
        this.titleText.setY(TITLE_Y);
        this.subText.setY(SUB_Y);
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
