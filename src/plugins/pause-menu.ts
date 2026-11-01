import type { GamePlugin } from '../ecs/plugin.ts';
import type { MenuEntry, Screen } from '../ui/screens.ts';
import { PAUSE_MENU_ID } from '../ui/screens.ts';
import { ScreensKey } from './keys.ts';

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
  ['Zoom del minimapa', 'M'],
  ['Mapa', 'Tab'],
  ['Pausa', 'Esc'],
];

export const pauseMenu: GamePlugin = {
  name: 'pause-menu',
  dependsOn: ['screens'],
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
