export interface Prompt {
  show(text: string): void;
  hide(): void;
}

/** Centered bottom-of-screen banner; fades in/out with CSS. */
export function createPrompt(parent: HTMLElement, opts: { id?: string; bottom?: string } = {}): Prompt {
  const el = document.createElement('div');
  el.id = opts.id ?? 'prompt';
  el.style.cssText =
    'position:absolute;left:50%;bottom:' + (opts.bottom ?? '12%') + ';transform:translateX(-50%);padding:10px 24px;' +
    'background:rgba(0,0,0,.72);color:#fff;font:600 22px system-ui,sans-serif;border-radius:6px;' +
    'border:1px solid rgba(255,255,255,.35);white-space:nowrap;pointer-events:none;' +
    'opacity:0;transition:opacity .25s ease';
  parent.append(el);
  return {
    show(text) {
      el.textContent = text;
      el.style.opacity = '1';
    },
    hide() {
      el.style.opacity = '0';
    },
  };
}
