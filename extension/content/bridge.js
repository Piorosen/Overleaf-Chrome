// Overleaf AI — private channel between the isolated content scripts and the MAIN-world script.
//
// Runs at document_start in the ISOLATED world. Both this script and main-world.js run before any
// page script (Chrome guarantee for document_start content scripts), so we can hand a DOM node to
// the MAIN world with a synchronous event, then detach it. All later requests/responses are
// CustomEvents dispatched on that detached node, which page scripts cannot reach or observe —
// unlike window.postMessage, which every page script (and other extensions) can read and spoof.
(() => {
  'use strict';
  if (globalThis.__olaiBridge) return;
  const node = document.createElement('olai-bridge');
  const bridge = { node, ready: false };
  globalThis.__olaiBridge = bridge;
  node.addEventListener('olai-main-ack', () => { bridge.ready = true; }, { once: true });
  // If the MAIN-world script is already listening it adopts the node right now (synchronously);
  // otherwise it finds the node in the DOM when it starts, which is still before any page script.
  (document.documentElement || document).appendChild(node);
  node.dispatchEvent(new CustomEvent('olai-bridge-offer', { bubbles: true, composed: false }));
})();
