export interface Screen {
  id: string;
  title: string;
  mount(root: HTMLElement): void;
  unmount(): void;
  /** Return true when the key was handled. */
  onKey?(e: KeyboardEvent): boolean;
}

export interface MenuEntry {
  label: string;
  order: number;
  action: () => void;
}

export interface Screens {
  /** Throws on duplicate id. */
  register(screen: Screen): void;
  /** Push on the stack; the game is paused (reason 'screens') while the stack is non-empty. */
  open(id: string): void;
  /** Pop the top screen; when the stack empties the game resumes. */
  back(): void;
  closeAll(): void;
  readonly top: string | undefined;
  addMenuEntry(entry: MenuEntry): void;
  /** Sorted by order (stable for equal orders). */
  menuEntries(): readonly MenuEntry[];
  /** Toggles: opens the screen if it is not the top, back() if it is. */
  addShortcut(code: string, screenId: string): void;
}

export interface ScreensHost {
  /** Mount point inside the UI overlay. */
  parent: HTMLElement;
  pause: { pause(reason: string): void; resume(reason: string): void };
  /** Where key and focus events are listened for. */
  win: Window;
}

export const PAUSE_REASON = 'screens';
export const PAUSE_MENU_ID = 'pause-menu';

export function createScreens(host: ScreensHost): { screens: Screens; dispose(): void } {
  const { parent, pause, win } = host;
  const registry = new Map<string, Screen>();
  const stack: string[] = [];
  const entries: MenuEntry[] = [];
  const shortcuts = new Map<string, string>();

  const root = document.createElement('div');
  root.id = 'screens';
  root.style.cssText =
    'position:absolute;inset:0;display:none;align-items:center;justify-content:center;' +
    'background:rgba(0,0,0,.6);pointer-events:none;font:600 18px system-ui,sans-serif;color:#fff';
  parent.append(root);

  const topScreen = (): Screen | undefined => {
    const id = stack[stack.length - 1];
    return id === undefined ? undefined : registry.get(id);
  };
  const mountTop = (): void => {
    root.replaceChildren();
    const t = topScreen();
    if (!t) {
      root.style.display = 'none';
      root.style.pointerEvents = 'none';
      return;
    }
    root.style.display = 'flex';
    root.style.pointerEvents = 'auto';
    t.mount(root);
  };
  const unmountTop = (): void => {
    topScreen()?.unmount();
    root.replaceChildren();
  };

  const screens: Screens = {
    register(screen) {
      if (registry.has(screen.id)) throw new Error(`Screen "${screen.id}" is already registered`);
      registry.set(screen.id, screen);
    },
    open(id) {
      if (!registry.has(id)) throw new Error(`Screen "${id}" is not registered`);
      if (stack[stack.length - 1] === id) return;
      unmountTop();
      stack.push(id);
      pause.pause(PAUSE_REASON);
      mountTop();
    },
    back() {
      if (stack.length === 0) return;
      unmountTop();
      stack.pop();
      if (stack.length === 0) pause.resume(PAUSE_REASON);
      mountTop();
    },
    closeAll() {
      if (stack.length === 0) return;
      unmountTop();
      stack.length = 0;
      pause.resume(PAUSE_REASON);
      mountTop();
    },
    get top() {
      return stack[stack.length - 1];
    },
    addMenuEntry(entry) {
      entries.push(entry);
    },
    menuEntries: () => [...entries].sort((a, b) => a.order - b.order),
    addShortcut(code, screenId) {
      shortcuts.set(code, screenId);
    },
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      if (e.code === 'Escape' || e.code === 'Tab' || shortcuts.has(e.code)) e.preventDefault();
      return;
    }
    if (topScreen()?.onKey?.(e)) {
      e.preventDefault();
      return;
    }
    if (e.code === 'Escape') {
      e.preventDefault();
      if (stack.length === 0) screens.open(PAUSE_MENU_ID);
      else screens.back();
      return;
    }
    const target = shortcuts.get(e.code);
    if (target !== undefined) {
      e.preventDefault();
      if (screens.top === target) screens.back();
      else screens.open(target);
      return;
    }
    if (e.code === 'Tab') e.preventDefault();
  };
  const onBlur = (): void => {
    if (stack.length === 0 && registry.has(PAUSE_MENU_ID)) screens.open(PAUSE_MENU_ID);
  };
  const onVisibility = (): void => {
    if (win.document.visibilityState === 'hidden') onBlur();
  };
  win.addEventListener('keydown', onKeyDown);
  win.addEventListener('blur', onBlur);
  win.document.addEventListener('visibilitychange', onVisibility);

  return {
    screens,
    dispose() {
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('blur', onBlur);
      win.document.removeEventListener('visibilitychange', onVisibility);
      screens.closeAll();
      root.remove();
    },
  };
}
