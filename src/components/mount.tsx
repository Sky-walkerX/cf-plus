import { render, type ComponentChild } from 'preact';
import css from './ui.css?inline';

/** Create a shadow-rooted host next to `anchor` and render `node` into it. */
export function mountShadow(
  anchor: Element,
  where: InsertPosition,
  node: ComponentChild,
  id: string,
): HTMLElement {
  document.getElementById(id)?.remove();
  const host = document.createElement('div');
  host.id = id;
  host.className = 'cfx-host';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = css;
  shadow.appendChild(style);
  const mountPoint = document.createElement('div');
  shadow.appendChild(mountPoint);
  anchor.insertAdjacentElement(where, host);
  render(node, mountPoint);
  return host;
}
