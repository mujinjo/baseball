import Phaser from 'phaser';
import { TitleScene } from './scenes/TitleScene';
import { GameScene } from './scenes/GameScene';
import { Stage } from './three/stage';

const container = document.getElementById('game')!;
container.style.position = 'relative';
// 3D 장면(three.js)은 Phaser 캔버스 뒤에 깔고, Phaser는 투명 배경으로 그 위에 UI를 그린다
const stage = new Stage(container);
stage.renderer.domElement.style.zIndex = '0';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  transparent: true,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: 540,
    height: 960,
  },
  scene: [TitleScene, GameScene],
});
game.registry.set('stage', stage);

const sync = () => {
  game.canvas.style.position = 'relative';
  game.canvas.style.zIndex = '1';
  stage.syncTo(game.canvas);
};
game.events.once(Phaser.Core.Events.READY, sync);
game.scale.on(Phaser.Scale.Events.RESIZE, sync);
window.addEventListener('resize', () => requestAnimationFrame(sync));

// 개발 서버에서만 디버깅용으로 노출
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
