/** Keep the current product navigation accessible when the retained prototype renders a route. */
export function installProductNavigation(doc: Document = document): void {
  const button = doc.querySelector<HTMLButtonElement>('.menu-toggle');
  const links = doc.querySelector('#nav-links');
  if (!button || !links) return;
  const sync = () => {
    button.setAttribute(
      'aria-label',
      button.getAttribute('aria-expanded') === 'true' ? 'Collapse navigation' : 'Expand navigation',
    );
  };
  sync();
  new MutationObserver(sync).observe(button, { attributes: true, attributeFilter: ['aria-expanded'] });
  doc.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || button.getAttribute('aria-expanded') !== 'true') return;
    links.classList.remove('open');
    button.setAttribute('aria-expanded', 'false');
    sync();
    button.focus();
  });
}
