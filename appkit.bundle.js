
/*
  appkit.bundle.js
  Test-mode bundle wrapper for Reown AppKit (WalletConnect v2)
  - Defines global function: initWallet(projectId)
  - Tries multiple CDN ESM paths (jsdelivr, unpkg). If one fails, logs helpful diagnostics.
  - If createAppKit is available, wires button#connectBtn and div#address.
  - Designed for testing on EdgeOne at https://cozytes.edgeone.app
  - Logs detailed info to console (test mode).
*/

(function () {
  // ensure we don't redefine
  if (window.initWallet) {
    console.warn('initWallet already defined — skipping duplicate bundle init.');
    return;
  }

  // helper: dynamic ESM import via blob + script for browsers that block direct import from cross-origin
  async function dynamicImport(url) {
    // try direct import first
    try {
      return await import(url);
    } catch (err) {
      console.warn('Direct import failed for', url, err);
    }
    // fallback: fetch then create blob URL
    try {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('Fetch failed: ' + res.status);
      const code = await res.text();
      const blob = new Blob([code], { type: 'text/javascript' });
      const blobUrl = URL.createObjectURL(blob);
      const mod = await import(blobUrl);
      URL.revokeObjectURL(blobUrl);
      return mod;
    } catch (err) {
      console.warn('Blob import fallback failed for', url, err);
      throw err;
    }
  }

  // Try a list of potential ESM entry points for @reown/appkit and wagmi adapter
  const CDN_CANDIDATES = [
    {
      name: 'jsdelivr-appkit-esm',
      appkit: 'https://cdn.jsdelivr.net/npm/@reown/appkit@latest/dist/esm/index.js',
      adapter: 'https://cdn.jsdelivr.net/npm/@reown/appkit-adapter-wagmi@latest/dist/esm/index.js',
      networks: 'https://cdn.jsdelivr.net/npm/@reown/appkit@latest/dist/esm/networks/index.js'
    },
    {
      name: 'unpkg-appkit-esm',
      appkit: 'https://unpkg.com/@reown/appkit@latest/dist/esm/index.js',
      adapter: 'https://unpkg.com/@reown/appkit-adapter-wagmi@latest/dist/esm/index.js',
      networks: 'https://unpkg.com/@reown/appkit@latest/dist/esm/networks/index.js'
    }
  ];

  // Provide a minimalist no-op UI fallback so page doesn't break
  function uiLog(msg) {
    console.log('[appkit.bundle.js]', msg);
  }

  // main init function
  window.initWallet = async function initWallet(projectId, opts = {}) {
    uiLog('initWallet called — test mode');
    uiLog('projectId=' + projectId);

    // Only run in secure context
    if (location.protocol !== 'https:' && location.hostname !== 'localhost') {
      console.warn('Non-HTTPS context detected. WalletConnect v2 may fail. Use HTTPS.');
    }

    // Grab HTML elements
    const connectBtn = document.getElementById('connectBtn');
    const addressDiv = document.getElementById('address');

    if (!connectBtn) {
      console.warn('No element with id "connectBtn" found in DOM — creating one for test.');
      // create basic ones
      const btn = document.createElement('button');
      btn.id = 'connectBtn';
      btn.textContent = 'Connect Wallet';
      document.body.appendChild(btn);
    }
    if (!addressDiv) {
      const d = document.createElement('div');
      d.id = 'address';
      d.style.marginTop = '8px';
      document.body.appendChild(d);
    }

    // Attempt to load SDKs from candidate CDNs
    let appkitModule = null;
    let adapterModule = null;
    let networksModule = null;
    let lastErr = null;

    for (const cand of CDN_CANDIDATES) {
      uiLog('Trying CDN candidate: ' + cand.name);
      try {
        appkitModule = await dynamicImport(cand.appkit);
        adapterModule = await dynamicImport(cand.adapter);
        networksModule = await dynamicImport(cand.networks);
        uiLog('Imported modules from ' + cand.name);
        break;
      } catch (err) {
        console.warn('Candidate failed:', cand.name, err);
        lastErr = err;
      }
    }

    if (!appkitModule || !adapterModule) {
      console.error('Unable to import Reown AppKit ESM modules from CDNs. See console for details.', lastErr);
      uiLog('Import failed — fallback: try using a bundler (Vite/webpack) or request the "bundle" version from developer.');
      // Provide fallback connect via window.ethereum (MetaMask) so user can still test connect in browser wallets
      fallbackToWindowEthereum();
      return;
    }

    uiLog('Creating AppKit modal (test-mode).');

    try {
      const { createAppKit } = appkitModule;
      const { WagmiAdapter } = adapterModule;
      const networks = networksModule;

      // create adapter
      const wagmiAdapter = new WagmiAdapter({
        projectId,
        networks: [networks.mainnet]
      });

      const modal = createAppKit({
        adapters: [wagmiAdapter],
        projectId,
        networks: [networks.mainnet],
        metadata: {
          name: opts.name || 'CozySwap DApp (test)',
          description: 'Test-mode AppKit bundle',
          url: window.location.origin,
          icons: []
        },
        features: opts.features || { analytics: false }
      });

      // attach UI
      const btn = document.getElementById('connectBtn');
      const addrDiv = document.getElementById('address');

      btn.addEventListener('click', async function onClick() {
        const state = wagmiAdapter.getState?.();
        if (state?.wallet?.address) {
          uiLog('Disconnect requested via button');
          await wagmiAdapter.disconnectWallet();
          return;
        }
        uiLog('Opening AppKit modal...');
        modal.open();
      });

      wagmiAdapter.subscribeWallet((wallet) => {
        uiLog('wagmiAdapter.subscribeWallet event: ' + JSON.stringify(!!wallet));
        if (wallet && wallet.address) {
          const short = wallet.address.slice(0, 6) + '...' + wallet.address.slice(-4);
          addrDiv.textContent = 'Connected: ' + short + ' (full: ' + wallet.address + ')';
          btn.textContent = 'Disconnect Wallet';
        } else {
          addrDiv.textContent = '';
          btn.textContent = 'Connect Wallet';
        }
      });

      uiLog('AppKit initialized. Click Connect Wallet to open modal.');

    } catch (err) {
      console.error('Error while initializing AppKit modal:', err);
      uiLog('Falling back to window.ethereum method for quick test.');
      fallbackToWindowEthereum();
    }

    // simple fallback to window.ethereum (MetaMask) so user can at least test connect in-browser
    function fallbackToWindowEthereum() {
      const btn = document.getElementById('connectBtn');
      const addrDiv = document.getElementById('address');

      async function connectMetaMask() {
        try {
          if (!window.ethereum) {
            alert('No injected wallet detected (MetaMask). Please use a wallet browser or install MetaMask.');
            console.warn('No window.ethereum present.');
            return;
          }
          const provider = window.ethereum;
          const accounts = await provider.request({ method: 'eth_requestAccounts' });
          const address = accounts[0];
          const short = address.slice(0, 6) + '...' + address.slice(-4);
          addrDiv.textContent = 'Connected (injected): ' + short + ' (full: ' + address + ')';
          btn.textContent = 'Disconnect Wallet';
          btn.onclick = async () => {
            addrDiv.textContent = '';
            btn.textContent = 'Connect Wallet';
            btn.onclick = connectMetaMask;
            try {
              if (provider.removeListener) provider.removeListener('accountsChanged', onAccountsChanged);
            } catch (e) {}
          };
          function onAccountsChanged(accounts) {
            if (!accounts || accounts.length === 0) {
              addrDiv.textContent = '';
              btn.textContent = 'Connect Wallet';
            } else {
              addrDiv.textContent = 'Connected (injected): ' + accounts[0];
            }
          }
          if (provider.on) {
            provider.on('accountsChanged', onAccountsChanged);
          }
        } catch (e) {
          console.error('Injected connect error', e);
        }
      }

      btn.onclick = connectMetaMask;
      uiLog('Fallback (injected) connect method ready. Click the button to test MetaMask/connect-injected-wallet.');
    }
  };

  // expose a simple diagnostic helper
  window.appkitBundleDiagnostic = function () {
    console.log('appkit.bundle.js diagnostic: location:', location.href);
    console.log('User Agent:', navigator.userAgent);
    console.log('HTTPS:', location.protocol === 'https:');
    console.log('Has window.ethereum:', !!window.ethereum);
  };

})();
