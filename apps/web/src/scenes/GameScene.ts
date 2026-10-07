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
  battingTeam,
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
import { FOLLOW_THROUGH_MS, SWING_CONTACT_MS } from '../game/swing';
import type { Stage } from '../three/stage';
import { WINDUP_MS } from '../three/rigs';
import { FieldView } from '../ui/FieldView';
import { ZoneGrid } from '../ui/ZoneGrid';
import {
  ZONE_CENTER,
  ZONE_SCALE_X,
  ZONE_SCALE_Y,
  ballWorldAt,
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
const AI_PITCH_DELAY_MS = WINDUP_MS + 250;
const THROW_DELAY_MS = WINDUP_MS;
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
  /** 3D 장면. 개발/테스트에서 자세를 확인할 수 있게 공개해 둔다 */
  stage!: Stage;
  private swingTween: Phaser.Tweens.Tween | null = null;
  private releaseAt = 0;
  /** 개발/테스트: 투수 동작 진행도를 고정해서 볼 때 쓴다 */
  debugTau: number | null = null;
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

    this.stage = this.registry.get('stage') as Stage;
    this.stage.setVisible(true);
    this.drawZoneOutline();
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
  /** 3D 장면(Stage)은 Phaser 캔버스 뒤에 깔려 있고, 여기서는 그 위에 스트라이크존 테두리만 덧그린다 */
  private drawZoneOutline() {
    this.add
      .graphics()
      .setDepth(3)
      .lineStyle(2, 0xffffff, 0.9)
      .strokeRect(ZONE_CENTER.x - ZONE_SCALE_X, ZONE_CENTER.y - ZONE_SCALE_Y, ZONE_SCALE_X * 2, ZONE_SCALE_Y * 2);
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
    this.stage.setBall(null);
    this.titleText.setText('');
    this.subText.setText('');
    this.stopSwing();
    this.stage.batter.reset();
    this.releaseAt = 0;
    this.stage.setBattingTeam(battingTeam(this.gs));
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
    this.releaseAt = this.launchAt;
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
    this.releaseAt = this.launchAt;
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

  private startSwing(target: Location) {
    this.stopSwing();
    const state = { u: 0 };
    const draw = () => this.stage.batter.poseAtProgress(target, state.u);
    this.swingTween = this.tweens.add({
      targets: state,
      u: 1,
      duration: SWING_CONTACT_MS,
      ease: 'Quad.easeIn',
      onUpdate: draw,
      onComplete: () => {
        this.swingTween = this.tweens.add({ targets: state, u: 2, duration: FOLLOW_THROUGH_MS, ease: 'Quad.easeOut', onUpdate: draw });
      },
    });
  }

  private stopSwing() {
    this.swingTween?.stop();
    this.swingTween = null;
  }

  update() {
    // 투수 동작: 릴리스 시각에 맞춰 와인드업 → 투구 → 팔로스루
    const tau = this.debugTau ?? (this.releaseAt > 0 ? Math.min(1.4, (now() - (this.releaseAt - WINDUP_MS)) / WINDUP_MS) : 0);
    this.stage.pitcher.setProgress(Math.max(0, tau));
    // 릴리스 전에는 공이 투수의 오른손에 들려 있다
    if (this.releaseAt > 0 && tau < 1 && this.phase === 'ready') this.stage.setBall(this.stage.pitcher.rightHandWorld());
    this.stage.render();
    if (this.phase === 'gauge') {
      const pos = gaugePosition(now() - this.gaugeStart);
      this.gaugeMarker.setPosition(GAUGE.x + GAUGE.w * pos, GAUGE.y);
    }
    if (this.phase === 'ready' && now() >= this.launchAt) this.launchPitch();
    if (this.phase !== 'flight' || !this.flight || !this.pendingThrow || !this.previewLoc) return;

    const f = this.flight;
    const t = (now() - f.start) / f.dur;
    this.stage.setBall(ballWorldAt(t, this.previewLoc, this.pendingThrow.pitchType, this.stage.pitcher.releasePoint()));

    if (f.swingAt !== null && !f.batSwung && now() >= f.swingAt) {
      f.batSwung = true;
      this.startSwing(this.previewLoc);
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
      this.stage.setBall(null);
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
