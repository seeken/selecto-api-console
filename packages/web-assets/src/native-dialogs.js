/* Shared native dialog accessibility behavior for HTMX, Livewire, and Blazor hosts. */
(() => {
  const dialogSelector = 'dialog[open], [role="dialog"]:not(dialog)';
  const focusableSelector = [
    'a[href]',
    'button:not([disabled])',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  let activeDialog = null;
  let returnFocus = null;
  let pendingTrigger = null;
  let restoreRowAfterSwap = false;
  const focusableElements = (dialog) =>
    [...dialog.querySelectorAll(focusableSelector)].filter(
      (element) => element instanceof HTMLElement && !element.hidden
    );
  const synchronizeDialog = () => {
    const nextDialog = document.querySelector(dialogSelector);
    if (nextDialog === activeDialog) return;
    if (!nextDialog && activeDialog) {
      const target = returnFocus?.isConnected
        ? returnFocus
        : document.querySelector(
            '[aria-label="Selecto query results"] tbody tr[tabindex="0"], [aria-label="Query controls"]'
          );
      activeDialog = null;
      returnFocus = null;
      pendingTrigger = null;
      if (target instanceof HTMLElement) requestAnimationFrame(() => target.focus());
      return;
    }
    if (nextDialog instanceof HTMLElement) {
      returnFocus =
        pendingTrigger ??
        (document.activeElement instanceof HTMLElement && document.activeElement !== document.body
          ? document.activeElement
          : null);
      activeDialog = nextDialog;
      activeDialog.setAttribute('tabindex', '-1');
      const initial =
        activeDialog.querySelector('[aria-label^="Close"]') ??
        focusableElements(activeDialog)[0] ??
        activeDialog;
      if (initial instanceof HTMLElement) requestAnimationFrame(() => initial.focus());
    }
  };
  document.addEventListener('keydown', (event) => {
    if (
      event.key === 'Enter' &&
      event.target instanceof HTMLElement &&
      event.target.matches('tr[tabindex="0"][hx-get], tr[tabindex="0"][hx-post]')
    ) {
      event.preventDefault();
      pendingTrigger = event.target;
      event.target.click();
      return;
    }
    if (!activeDialog?.isConnected) return;
    if (event.key === 'Escape') {
      const close = activeDialog.querySelector('[aria-label^="Close"]');
      if (close instanceof HTMLElement) {
        event.preventDefault();
        restoreRowAfterSwap = true;
        close.click();
      }
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableElements(activeDialog);
    if (focusable.length === 0) {
      event.preventDefault();
      activeDialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
  document.addEventListener(
    'click',
    (event) => {
      const trigger =
        event.target instanceof Element ? event.target.closest('tr[tabindex="0"]') : null;
      if (trigger instanceof HTMLElement) pendingTrigger = trigger;
      if (
        activeDialog?.isConnected &&
        event.target instanceof Element &&
        event.target.closest('[aria-label="Close row details"]')
      ) {
        restoreRowAfterSwap = true;
      }
    },
    true
  );
  new MutationObserver(synchronizeDialog).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['open']
  });
  document.addEventListener('DOMContentLoaded', synchronizeDialog);
  document.addEventListener('livewire:navigated', synchronizeDialog);

  const afterSwap = () => {
    synchronizeDialog();
    const replacement = document.querySelector(
      '#workbench[data-restore-row-focus="true"] [aria-label="Selecto query results"] tbody tr[tabindex="0"]'
    );
    if (replacement instanceof HTMLElement) requestAnimationFrame(() => replacement.focus());
  };
  const afterSettle = () => {
    const markedReplacement = document.querySelector(
      '#workbench[data-restore-row-focus="true"] [aria-label="Selecto query results"] tbody tr[tabindex="0"]'
    );
    if (markedReplacement instanceof HTMLElement) {
      restoreRowAfterSwap = false;
      requestAnimationFrame(() => markedReplacement.focus());
      return;
    }
    if (!restoreRowAfterSwap || document.querySelector(dialogSelector)) return;
    restoreRowAfterSwap = false;
    const row = document.querySelector(
      '[aria-label="Selecto query results"] tbody tr[tabindex="0"]'
    );
    if (row instanceof HTMLElement) requestAnimationFrame(() => row.focus());
  };

  // htmx 4 uses colon-separated lifecycle names. The camel-case aliases keep
  // the helper compatible with existing beta-era native examples during the
  // transition to the shared stable runtime.
  document.addEventListener('htmx:after:swap', afterSwap);
  document.addEventListener('htmx:afterSwap', afterSwap);
  document.addEventListener('htmx:after:settle', afterSettle);
  document.addEventListener('htmx:afterSettle', afterSettle);
})();
