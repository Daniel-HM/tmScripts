// ==UserScript==
// @name         Intratuin Peppol Connection Automation
// @namespace    http://tampermonkey.net/
// @version      2.0
// @description  Automate Peppol connection for business customers with phone validation and detailed tracking
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:*
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=108011:100:*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // Configuration
    const CONFIG = {
        // Search page (page 1)
        searchInput: '#P1_KLANR',
        searchButton: 'button[onclick*="apex.submit({request:\'SEARCH\'})"]',
        firstResultLink: 'td.t-Report-cell a[href*="P100_DEKEYCE"]',

        // Detail page (page 100)
        phoneField1: '#P100_DEMBLNR', // Mobile number
        phoneField2: '#P100_DETELNR', // Telephone number
        btwField: '#P100_DEKLBTW', // BTW nummer
        peppolConnectButton: 'button[onclick*="KOPPELEN_AAN_PEPPOL"]',
        peppolStatusField: '#P100_USES_PEPPOL_DISPLAY', // "Ja" or "Nee"
        peppolMessageField: '#P100_PEPPOL_MESSAGE_DISPLAY', // Error message

        // URLs
        searchPageUrl: 'https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:',

        // Delays (in milliseconds)
        delayAfterSearch: 2000,
        delayBeforeConnect: 500,
        delayAfterConnect: 2500,
        delayBetweenChecks: 1500
    };

    // Result tracking categories
    const RESULT_TYPES = {
        SUCCESS: 'success',
        SKIPPED_NO_BTW: 'skipped_no_btw',
        SKIPPED_ALREADY_CONNECTED: 'skipped_already_connected',
        NOT_REGISTERED: 'not_registered_in_peppol',
        ERROR: 'error'
    };

    // State management
    const STATE = {
        get currentIndex() { return GM_getValue('peppol_currentIndex', 0); },
        set currentIndex(val) { GM_setValue('peppol_currentIndex', val); },

        get clientList() { return JSON.parse(GM_getValue('peppol_clientList', '[]')); },
        set clientList(val) { GM_setValue('peppol_clientList', JSON.stringify(val)); },

        get isRunning() { return GM_getValue('peppol_isRunning', false); },
        set isRunning(val) { GM_setValue('peppol_isRunning', val); },

        get processedCount() { return GM_getValue('peppol_processedCount', 0); },
        set processedCount(val) { GM_setValue('peppol_processedCount', val); },

        // Detailed result tracking
        get results() { return JSON.parse(GM_getValue('peppol_results', '[]')); },
        set results(val) { GM_setValue('peppol_results', JSON.stringify(val)); },

        // Need to re-check after connect
        get needsRecheck() { return GM_getValue('peppol_needsRecheck', false); },
        set needsRecheck(val) { GM_setValue('peppol_needsRecheck', val); }
    };

    // Add result to tracking
    function addResult(clientNumber, resultType, message = '') {
        const results = STATE.results;
        results.push({
            clientNumber,
            resultType,
            message,
            timestamp: new Date().toISOString()
        });
        STATE.results = results;
    }

    // Get counts by result type
    function getResultCounts() {
        const results = STATE.results;
        return {
            total: results.length,
            success: results.filter(r => r.resultType === RESULT_TYPES.SUCCESS).length,
            skippedNoBtw: results.filter(r => r.resultType === RESULT_TYPES.SKIPPED_NO_BTW).length,
            alreadyConnected: results.filter(r => r.resultType === RESULT_TYPES.SKIPPED_ALREADY_CONNECTED).length,
            notRegistered: results.filter(r => r.resultType === RESULT_TYPES.NOT_REGISTERED).length,
            errors: results.filter(r => r.resultType === RESULT_TYPES.ERROR).length
        };
    }

    // Export results to CSV
    function exportResultsToCSV() {
        const results = STATE.results;
        if (results.length === 0) {
            alert('No results to export');
            return;
        }

        let csv = 'Klantnummer,Result Type,Message,Timestamp\n';
        results.forEach(r => {
            csv += `"${r.clientNumber}","${r.resultType}","${r.message}","${r.timestamp}"\n`;
        });

        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `peppol_results_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    }

    // Get list of not registered clients
    function getNotRegisteredClients() {
        return STATE.results
            .filter(r => r.resultType === RESULT_TYPES.NOT_REGISTERED)
            .map(r => r.clientNumber);
    }

    // Utility functions
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(selector);
            if (existing) {
                return resolve(existing);
            }

            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    resolve(el);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout waiting for: ${selector}`));
            }, timeout);
        });
    }

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    function getCurrentPage() {
        const url = window.location.href;
        if (url.includes(':1:')) return 'search';
        if (url.includes(':100:')) return 'detail';
        return 'unknown';
    }

    function getCurrentClientNumber() {
        const clients = STATE.clientList;
        const index = STATE.currentIndex;
        if (index >= clients.length) return null;

        const currentClient = clients[index];
        return currentClient.klantnummer || currentClient.clientNumber || currentClient;
    }

    // Search page handler
    async function handleSearchPage() {
        if (!STATE.isRunning) return;

        const clients = STATE.clientList;
        const index = STATE.currentIndex;

        if (index >= clients.length) {
            console.log('✅ Processing complete!');
            STATE.isRunning = false;
            updateControlPanel();

            const counts = getResultCounts();
            alert(`Automation Complete!\n\n` +
                `Total Processed: ${counts.total}\n` +
                `✅ Successfully Connected: ${counts.success}\n` +
                `⏭️ Skipped (No BTW): ${counts.skippedNoBtw}\n` +
                `⏭️ Already Connected: ${counts.alreadyConnected}\n` +
                `⚠️ Not Registered in Peppol: ${counts.notRegistered}\n` +
                `❌ Errors: ${counts.errors}\n\n` +
                `Click "Export Results" to download detailed CSV`);
            return;
        }

        const clientNumber = getCurrentClientNumber();

        console.log(`🔍 Processing ${index + 1}/${clients.length}: ${clientNumber}`);
        updateControlPanel();

        try {
            const searchInput = document.querySelector(CONFIG.searchInput);
            if (!searchInput) {
                throw new Error('Search input not found');
            }

            searchInput.value = clientNumber;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));

            await delay(500);

            const searchBtn = document.querySelector(CONFIG.searchButton);
            if (!searchBtn) {
                throw new Error('Search button not found');
            }

            searchBtn.click();
            await delay(CONFIG.delayAfterSearch);

            const firstResult = await waitForElement(CONFIG.firstResultLink, 15000);
            await delay(500);
            firstResult.click();

        } catch (error) {
            console.error('❌ Error on search page:', error);
            addResult(clientNumber, RESULT_TYPES.ERROR, error.message);
            STATE.currentIndex++;

            await delay(2000);
            window.location.reload();
        }
    }

    // Detail page handler
    async function handleDetailPage() {
        if (!STATE.isRunning) return;

        const clientNumber = getCurrentClientNumber();
        console.log(`📋 On detail page for: ${clientNumber}`);

        try {
            await delay(CONFIG.delayBetweenChecks);

            // Check BTW field first
            const btwField = document.querySelector(CONFIG.btwField);
            if (!btwField) {
                throw new Error('BTW field not found');
            }

            const btwValue = btwField.value.trim();
            if (!btwValue || btwValue === '') {
                console.log('⏭️ Skipping - No BTW number (not a business customer)');
                addResult(clientNumber, RESULT_TYPES.SKIPPED_NO_BTW, 'No BTW number present');
                STATE.currentIndex++;
                STATE.processedCount++;
                await returnToSearch();
                return;
            }

            console.log(`✓ BTW number present: ${btwValue}`);

            // If we just connected and need to recheck status
            if (STATE.needsRecheck) {
                STATE.needsRecheck = false;
                await checkPeppolStatus(clientNumber, btwValue);
                return;
            }

            // Check if already connected to Peppol
            const peppolStatus = document.querySelector(CONFIG.peppolStatusField);
            if (peppolStatus && peppolStatus.textContent.trim() === 'Ja') {
                console.log('⏭️ Already connected to Peppol');
                addResult(clientNumber, RESULT_TYPES.SKIPPED_ALREADY_CONNECTED, 'Already connected to Peppol');
                STATE.currentIndex++;
                STATE.processedCount++;
                await returnToSearch();
                return;
            }

            // Check phone fields
            const phone1 = document.querySelector(CONFIG.phoneField1);
            const phone2 = document.querySelector(CONFIG.phoneField2);

            if (!phone1 || !phone2) {
                throw new Error('Phone fields not found');
            }

            const hasPhone1 = phone1.value && phone1.value.trim() !== '';
            const hasPhone2 = phone2.value && phone2.value.trim() !== '';

            // If neither phone field has a value, fill with placeholder
            if (!hasPhone1 && !hasPhone2) {
                console.log('📞 No phone numbers, adding placeholder "0"');
                phone1.value = '0';
                phone1.dispatchEvent(new Event('input', { bubbles: true }));
                phone1.dispatchEvent(new Event('change', { bubbles: true }));
                await delay(CONFIG.delayBeforeConnect);
            } else {
                console.log('✓ Phone number(s) present');
            }

            // Click Peppol connect button
            const connectBtn = document.querySelector(CONFIG.peppolConnectButton);
            if (!connectBtn) {
                throw new Error('Peppol connect button not found');
            }

            console.log('🔗 Connecting to Peppol...');
            connectBtn.click();

            // Mark that we need to recheck after the page reloads
            STATE.needsRecheck = true;

            await delay(CONFIG.delayAfterConnect);

            // The connect button returns to search page, so we need to go back to detail
            await navigateToClient(clientNumber);

        } catch (error) {
            console.error('❌ Error on detail page:', error);
            addResult(clientNumber, RESULT_TYPES.ERROR, error.message);
            STATE.currentIndex++;
            STATE.processedCount++;
            await returnToSearch();
        }
    }

    // Check Peppol connection status after connecting
    async function checkPeppolStatus(clientNumber, btwValue) {
        try {
            await delay(CONFIG.delayBetweenChecks);

            const peppolStatus = document.querySelector(CONFIG.peppolStatusField);
            const peppolMessage = document.querySelector(CONFIG.peppolMessageField);

            if (peppolStatus && peppolStatus.textContent.trim() === 'Ja') {
                console.log('✅ Successfully connected to Peppol!');
                addResult(clientNumber, RESULT_TYPES.SUCCESS, 'Connected to Peppol');
            } else if (peppolMessage && peppolMessage.textContent.includes('Customer is not registered in Peppol with CBE number')) {
                console.log('⚠️ Customer not registered in Peppol yet');
                addResult(clientNumber, RESULT_TYPES.NOT_REGISTERED, `Not registered in Peppol (BTW: ${btwValue})`);
            } else {
                console.log('❓ Unexpected status');
                const statusText = peppolStatus ? peppolStatus.textContent.trim() : 'unknown';
                const messageText = peppolMessage ? peppolMessage.textContent.trim() : 'no message';
                addResult(clientNumber, RESULT_TYPES.ERROR, `Unexpected status: ${statusText}, message: ${messageText}`);
            }

            STATE.currentIndex++;
            STATE.processedCount++;
            await returnToSearch();

        } catch (error) {
            console.error('❌ Error checking Peppol status:', error);
            addResult(clientNumber, RESULT_TYPES.ERROR, `Status check failed: ${error.message}`);
            STATE.currentIndex++;
            STATE.processedCount++;
            await returnToSearch();
        }
    }

    // Navigate to a specific client
    async function navigateToClient(clientNumber) {
        const sessionId = window.location.href.match(/:(\d+):/)?.[1];
        if (!sessionId) {
            window.location.reload();
            return;
        }

        // Go to search page first
        window.location.href = `${CONFIG.searchPageUrl}${sessionId}`;
    }

    // Return to search page
    async function returnToSearch() {
        updateControlPanel();

        const sessionId = window.location.href.match(/:(\d+):/)?.[1];
        if (sessionId) {
            window.location.href = `${CONFIG.searchPageUrl}${sessionId}`;
        } else {
            window.location.reload();
        }
    }

    // Create control panel
    function createControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'peppol-automation-panel';
        panel.style.cssText = `
            position: fixed;
            top: 60px;
            right: 10px;
            background: white;
            border: 2px solid #2563eb;
            padding: 15px;
            z-index: 999999;
            border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            font-family: Arial, sans-serif;
            min-width: 320px;
            max-width: 400px;
            max-height: 90vh;
            overflow-y: auto;
        `;

        const counts = getResultCounts();

        panel.innerHTML = `
            <div style="border-bottom: 2px solid #2563eb; padding-bottom: 10px; margin-bottom: 10px;">
                <h3 style="margin: 0; color: #2563eb; font-size: 16px;">☁️ Peppol Automation</h3>
            </div>
            <div style="margin-bottom: 10px; font-size: 13px;">
                <strong>Progress:</strong> <span id="peppol-progress">0/0</span><br>
                <div style="margin-top: 5px;">
                    <progress id="peppol-progressbar" value="0" max="100" style="width: 100%; height: 20px;"></progress>
                </div>
            </div>
            <div style="margin-bottom: 10px; font-size: 12px; line-height: 1.6;">
                <strong style="color: #16a34a;">✅ Connected:</strong> <span id="peppol-success">${counts.success}</span><br>
                <strong style="color: #9ca3af;">⏭️ No BTW:</strong> <span id="peppol-skipped-btw">${counts.skippedNoBtw}</span><br>
                <strong style="color: #9ca3af;">⏭️ Already Connected:</strong> <span id="peppol-skipped-connected">${counts.alreadyConnected}</span><br>
                <strong style="color: #f59e0b;">⚠️ Not Registered:</strong> <span id="peppol-not-registered">${counts.notRegistered}</span><br>
                <strong style="color: #dc2626;">❌ Errors:</strong> <span id="peppol-errors">${counts.errors}</span><br>
                <hr style="margin: 8px 0;">
                <strong>Status:</strong> <span id="peppol-status">Idle</span>
            </div>
            <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 5px;">
                <button id="peppol-start" style="flex: 1; padding: 8px; background: #16a34a; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">▶ Start</button>
                <button id="peppol-pause" style="flex: 1; padding: 8px; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">⏸ Pause</button>
            </div>
            <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px;">
                <button id="peppol-reset" style="flex: 1; padding: 6px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">🔄 Reset</button>
                <button id="peppol-export" style="flex: 1; padding: 6px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">📥 Export</button>
            </div>
            <details style="margin-bottom: 10px;">
                <summary style="cursor: pointer; font-weight: bold; font-size: 12px; margin-bottom: 5px;">📋 Load Client List</summary>
                <textarea id="peppol-json-input" placeholder='Paste JSON array here, e.g.:
["12345", "67890"]
or
[{"klantnummer": "12345"}]' style="width: 100%; height: 100px; font-size: 11px; padding: 5px; margin-top: 5px; font-family: monospace;"></textarea>
                <button id="peppol-load" style="width: 100%; padding: 6px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 5px; font-size: 11px;">📁 Load JSON</button>
            </details>
            <details>
                <summary style="cursor: pointer; font-weight: bold; font-size: 12px;">📊 Not Registered List</summary>
                <div id="peppol-not-reg-list" style="margin-top: 5px; font-size: 11px; max-height: 150px; overflow-y: auto; background: #f3f4f6; padding: 8px; border-radius: 4px;">
                    <em style="color: #6b7280;">No data yet</em>
                </div>
            </details>
        `;

        document.body.appendChild(panel);
        attachPanelListeners();
        updateControlPanel();
    }

    // Update control panel
    function updateControlPanel() {
        const clients = STATE.clientList;
        const index = STATE.currentIndex;
        const counts = getResultCounts();

        document.getElementById('peppol-progress').textContent = `${index}/${clients.length}`;
        document.getElementById('peppol-success').textContent = counts.success;
        document.getElementById('peppol-skipped-btw').textContent = counts.skippedNoBtw;
        document.getElementById('peppol-skipped-connected').textContent = counts.alreadyConnected;
        document.getElementById('peppol-not-registered').textContent = counts.notRegistered;
        document.getElementById('peppol-errors').textContent = counts.errors;
        document.getElementById('peppol-status').textContent = STATE.isRunning ? '🟢 Running' : '⚪ Paused';

        const progressBar = document.getElementById('peppol-progressbar');
        if (clients.length > 0) {
            progressBar.value = (index / clients.length) * 100;
        }

        // Update not registered list
        const notRegList = document.getElementById('peppol-not-reg-list');
        const notRegistered = getNotRegisteredClients();
        if (notRegistered.length > 0) {
            notRegList.innerHTML = notRegistered.map(num =>
                `<div style="padding: 2px 0;">${num}</div>`
            ).join('');
        } else {
            notRegList.innerHTML = '<em style="color: #6b7280;">No unregistered clients yet</em>';
        }
    }

    // Attach event listeners
    function attachPanelListeners() {
        document.getElementById('peppol-start').addEventListener('click', async () => {
            if (STATE.clientList.length === 0) {
                alert('⚠️ Please load client list JSON first');
                return;
            }

            STATE.isRunning = true;
            updateControlPanel();

            const page = getCurrentPage();
            if (page === 'search') {
                await handleSearchPage();
            } else if (page === 'detail') {
                await handleDetailPage();
            }
        });

        document.getElementById('peppol-pause').addEventListener('click', () => {
            STATE.isRunning = false;
            STATE.needsRecheck = false;
            updateControlPanel();
            console.log('⏸ Automation paused');
        });

        document.getElementById('peppol-reset').addEventListener('click', () => {
            if (confirm('⚠️ Reset all progress and results? This cannot be undone!')) {
                STATE.currentIndex = 0;
                STATE.processedCount = 0;
                STATE.results = [];
                STATE.isRunning = false;
                STATE.needsRecheck = false;
                updateControlPanel();
                alert('🔄 Progress reset. Results cleared.');
            }
        });

        document.getElementById('peppol-load').addEventListener('click', () => {
            const jsonText = document.getElementById('peppol-json-input').value.trim();

            if (!jsonText) {
                alert('⚠️ Please paste JSON in the text area');
                return;
            }

            try {
                const data = JSON.parse(jsonText);
                const clients = Array.isArray(data) ? data : [data];

                if (clients.length === 0) {
                    alert('⚠️ JSON array is empty');
                    return;
                }

                STATE.clientList = clients;
                alert(`✅ Loaded ${clients.length} clients`);
                updateControlPanel();
            } catch(e) {
                alert('❌ Invalid JSON format: ' + e.message);
            }
        });

        document.getElementById('peppol-export').addEventListener('click', () => {
            exportResultsToCSV();
        });
    }

    // Initialize
    function init() {
        console.log('🚀 Peppol Automation initialized');
        console.log('📍 Current page:', getCurrentPage());

        if (!document.getElementById('peppol-automation-panel')) {
            createControlPanel();
        }

        // Continue automation if it was running
        if (STATE.isRunning) {
            const page = getCurrentPage();
            console.log('▶️ Continuing automation on', page, 'page');

            if (page === 'search') {
                setTimeout(() => handleSearchPage(), 2000);
            } else if (page === 'detail') {
                setTimeout(() => handleDetailPage(), 2000);
            }
        }
    }

    // Start after page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1000);
    }
})();