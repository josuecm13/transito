import type { GamePlugin } from '../ecs/plugin.ts';
import type { MenuEntry, Screen } from '../ui/screens.ts';
import { PAUSE_MENU_ID } from '../ui/screens.ts';
import { CameraControlKey, ScreensKey } from './keys.ts';
import { SENSITIVITY_STEPS, nextCameraMode, type CameraMode } from '../sim/camera-settings.ts';

const PANEL_CSS =
  'min-width:340px;padding:20px 28px;background:rgba(0,0,0,.78);color:#fff;border-radius:6px;' +
  'border:1px solid rgba(255,255,255,.35);font:600 22px system-ui,sans-serif';

function panel(root: HTMLElement, title: string): HTMLDivElement {
  const box = document.createElement('div');
  box.style.cssText = PANEL_CSS;
  const h = document.createElement('div');
  h.textContent = title;
  h.style.cssText = 'font-size:28px;margin-bottom:14px;text-align:center';
  box.append(h);
  root.append(box);
  return box;
}

const CONTROLS: ReadonlyArray<readonly [string, string]> = [
  ['Moverse', 'WASD / flechas'],
  ['Correr', 'Shift'],
  ['Subir / bajar del carro', 'E'],
  ['Acelerar / frenar y reversa', 'W / S'],
  ['Girar el carro', 'A / D'],
  ['Freno de mano', 'Espacio'],
  ['Girar cámara (3D)', 'Mouse'],
  ['Cambiar cámara', 'V'],
  ['Mirar atrás (carro, 3D)', 'C'],
  ['Zoom del minimapa', 'M'],
  ['Mapa', 'Tab'],
  ['Pausa', 'Esc'],
  ['Modo debug (ver todo el mapa)', 'F2'],
  ['Volar (debug)', 'WASD / Espacio / C'],
  ['Vista general (debug)', 'O'],
  ['Velocidad (debug)', 'Rueda'],
];

export const pauseMenu: GamePlugin = {
  name: 'pause-menu',
  dependsOn: ['screens', 'camera-settings'],
  setup(ctx) {
    const screens = ctx.services.get(ScreensKey);

    const controls: Screen = {
      id: 'controls',
      title: 'Controles',
      mount(root) {
        const box = panel(root, this.title);
        for (const [action, keys] of CONTROLS) {
          const row = document.createElement('div');
          row.style.cssText = 'display:flex;justify-content:space-between;gap:32px;padding:4px 0;font-size:18px';
          const a = document.createElement('span');
          a.textContent = action;
          const k = document.createElement('span');
          k.textContent = keys;
          k.style.opacity = '.8';
          row.append(a, k);
          box.append(row);
        }
        const hint = document.createElement('div');
        hint.textContent = 'Esc para volver';
        hint.style.cssText = 'margin-top:12px;font-size:14px;opacity:.6;text-align:center';
        box.append(hint);
      },
      unmount() {},
    };
    screens.register(controls);

    const camera = ctx.services.get(CameraControlKey);
    const MODE_LABEL: Record<CameraMode, string> = { topdown: 'Cenital', near: '3D cerca', far: '3D lejos' };
    const lastStep = SENSITIVITY_STEPS.length - 1;
    const settingRows: { label: string; value: () => string; change: (dir: 1 | -1) => void }[] = [
      {
        label: 'Cámara',
        value: () => MODE_LABEL[camera.mode],
        change: (dir) => {
          let m = camera.mode;
          for (let i = 0; i < (dir === 1 ? 1 : 2); i++) m = nextCameraMode(m);
          camera.update({ cameraMode: m });
        },
      },
      {
        label: 'Sensibilidad del mouse',
        value: () => `${camera.settings.sensitivity + 1} / ${lastStep + 1}`,
        change: (dir) => camera.update({ sensitivity: Math.min(lastStep, Math.max(0, camera.settings.sensitivity + dir)) }),
      },
      {
        label: 'Invertir eje Y',
        value: () => (camera.settings.invertY ? 'Sí' : 'No'),
        change: () => camera.update({ invertY: !camera.settings.invertY }),
      },
    ];
    let settingSel = 0;
    let settingEls: { row: HTMLElement; value: HTMLElement }[] = [];
    const paintSettings = (): void =>
      settingEls.forEach((e, i) => {
        const r = settingRows[i];
        if (r) e.value.textContent = `‹ ${r.value()} ›`;
        e.row.style.background = i === settingSel ? 'rgba(255,255,255,.22)' : 'transparent';
      });
    const settingsScreen: Screen = {
      id: 'settings',
      title: 'Ajustes',
      mount(root) {
        const box = panel(root, this.title);
        settingSel = 0;
        settingEls = settingRows.map((def, i) => {
          const row = document.createElement('div');
          row.style.cssText =
            'display:flex;justify-content:space-between;gap:32px;padding:8px 14px;border-radius:4px;cursor:pointer;margin:2px 0;font-size:18px';
          const a = document.createElement('span');
          a.textContent = def.label;
          const value = document.createElement('span');
          row.append(a, value);
          row.addEventListener('mouseenter', () => {
            settingSel = i;
            paintSettings();
          });
          row.addEventListener('click', () => {
            def.change(1);
            paintSettings();
          });
          box.append(row);
          return { row, value };
        });
        const hint = document.createElement('div');
        hint.textContent = 'Flechas o clic para cambiar · Esc para volver';
        hint.style.cssText = 'margin-top:12px;font-size:14px;opacity:.6;text-align:center';
        box.append(hint);
        paintSettings();
      },
      unmount() {
        settingEls = [];
      },
      onKey(e) {
        if (e.code === 'ArrowDown') settingSel = (settingSel + 1) % settingRows.length;
        else if (e.code === 'ArrowUp') settingSel = (settingSel - 1 + settingRows.length) % settingRows.length;
        else if (e.code === 'ArrowRight' || e.code === 'Enter' || e.code === 'NumpadEnter') settingRows[settingSel]?.change(1);
        else if (e.code === 'ArrowLeft') settingRows[settingSel]?.change(-1);
        else return false;
        paintSettings();
        return true;
      },
    };
    screens.register(settingsScreen);

    let selected = 0;
    let list: MenuEntry[] = [];
    let rows: HTMLElement[] = [];
    const paint = (): void =>
      rows.forEach((r, i) => {
        r.style.background = i === selected ? 'rgba(255,255,255,.22)' : 'transparent';
      });

    const menu: Screen = {
      id: PAUSE_MENU_ID,
      title: 'Pausa',
      mount(root) {
        list = [
          { label: 'Continuar', order: 0, action: () => screens.closeAll() },
          ...screens.menuEntries(),
          { label: 'Ajustes', order: 90, action: () => screens.open('settings') },
          { label: 'Controles', order: 100, action: () => screens.open('controls') },
        ].sort((a, b) => a.order - b.order);
        selected = 0;
        const box = panel(root, this.title);
        rows = list.map((entry, i) => {
          const row = document.createElement('div');
          row.textContent = entry.label;
          row.style.cssText = 'padding:8px 14px;border-radius:4px;cursor:pointer;margin:2px 0';
          row.addEventListener('mouseenter', () => {
            selected = i;
            paint();
          });
          row.addEventListener('click', () => entry.action());
          box.append(row);
          return row;
        });
        paint();
      },
      unmount() {
        rows = [];
        list = [];
      },
      onKey(e) {
        if (list.length === 0) return false;
        if (e.code === 'ArrowDown') selected = (selected + 1) % list.length;
        else if (e.code === 'ArrowUp') selected = (selected - 1 + list.length) % list.length;
        else if (e.code === 'Enter' || e.code === 'NumpadEnter') list[selected]?.action();
        else return false;
        paint();
        return true;
      },
    };
    screens.register(menu);
  },
};
