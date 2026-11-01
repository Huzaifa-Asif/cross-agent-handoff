'use strict';
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    const code = document.getElementById(button.dataset.copy);
    const status = document.getElementById('copy-status');
    try {
      await navigator.clipboard.writeText(code.textContent);
      status.textContent = 'Commands copied. Review them before running.';
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = button.dataset.copy === 'task-code' ? 'Copy commands' : 'Copy command'; }, 2000);
    } catch {
      status.textContent = 'Clipboard unavailable. Select and copy the command text manually.';
    }
  });
}
