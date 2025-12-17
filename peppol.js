// ==UserScript==
// @name         Intratuin Peppol Connection Automation
// @namespace    http://tampermonkey.net/
// @version      2.5
// @description  Automate Peppol connection for business customers with phone validation and detailed tracking
// @author       Daniel
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:*
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=108011:100:*
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=KLANT_KLANTEN_RS*
// @downloadURL  https://raw.githubusercontent.com/Daniel-HM/tmScripts/refs/heads/main/peppol.js
// @updateURL    https://raw.githubusercontent.com/Daniel-HM/tmScripts/refs/heads/main/peppol.js
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
        phoneField1: '#P100_DEMBLNR',
        phoneField2: '#P100_DETELNR',
        btwField: '#P100_DEKLBTW',
        peppolConnectButton: 'button[onclick*="KOPPELEN_AAN_PEPPOL"]',
        peppolStatusField: '#P100_USES_PEPPOL_DISPLAY',
        peppolMessageField: '#P100_PEPPOL_MESSAGE_DISPLAY',

        // URLs
        searchPageUrl: 'https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:',

        // Delays (in milliseconds)
        delayAfterSearch: 3000,
        delayBeforeConnect: 800,
        delayAfterConnect: 3000,
        delayBetweenChecks: 2000,
        delayBeforeReturnToSearch: 1500,

        // Lock timeout (milliseconds)
        processingLockTimeout: 30000 // 30 seconds
    };

    // Debug logging helper
    function log(message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        const prefix = `[Peppol ${timestamp}]`;
        if (data) {
            console.log(prefix, message, data);
        } else {
            console.log(prefix, message);
        }
    }

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

        // Processing lock with timestamp
        get isProcessing() { return GM_getValue('peppol_isProcessing', false); },
        set isProcessing(val) {
            GM_setValue('peppol_isProcessing', val);
            if (val) {
                GM_setValue('peppol_processingTimestamp', Date.now());
            }
        },

        get processingTimestamp() { return GM_getValue('peppol_processingTimestamp', 0); },

        // Detailed result tracking
        get results() { return JSON.parse(GM_getValue('peppol_results', '[]')); },
        set results(val) { GM_setValue('peppol_results', JSON.stringify(val)); },

        // Need to re-check after connect
        get needsRecheck() { return GM_getValue('peppol_needsRecheck', false); },
        set needsRecheck(val) { GM_setValue('peppol_needsRecheck', val); },

        // Track last processed client to prevent duplicate processing
        get lastProcessedClient() { return GM_getValue('peppol_lastProcessed', ''); },
        set lastProcessedClient(val) { GM_setValue('peppol_lastProcessed', val); }
    };

    // Check if processing lock is stale and clear it
    function checkAndClearStaleLock() {
        if (STATE.isProcessing) {
            const lockAge = Date.now() - STATE.processingTimestamp;
            if (lockAge > CONFIG.processingLockTimeout) {
                log(`⚠️ Processing lock is stale (${Math.round(lockAge/1000)}s old), clearing it`);
                STATE.isProcessing = false;
                return true;
            }
        }
        return false;
    }

    // Manually clear processing lock
    function clearProcessingLock() {
        log('🔓 Manually clearing processing lock');
        STATE.isProcessing = false;
        updateControlPanel();
    }

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
        log(`📝 Result recorded: ${clientNumber} - ${resultType}`, message);
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
        log('📥 CSV exported');
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
                log(`✓ Element found immediately: ${selector}`);
                return resolve(existing);
            }

            log(`⏳ Waiting for element: ${selector}`);

            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    log(`✓ Element appeared: ${selector}`);
                    resolve(el);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                log(`❌ Timeout waiting for: ${selector}`);
                reject(new Error(`Timeout waiting for: ${selector}`));
            }, timeout);
        });
    }

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    function getCurrentPage() {
        const url = window.location.href;
        if (url.includes(':1:') || url.includes('f?p=KLANT_KLANTEN_RS:1')) return 'search';
        if (url.includes(':100:') || url.includes('f?p=KLANT_KLANTEN_RS:100')) return 'detail';

        // Fallback: check for specific elements
        if (document.querySelector(CONFIG.searchInput)) return 'search';
        if (document.querySelector(CONFIG.btwField)) return 'detail';

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
        log('🔍 === SEARCH PAGE HANDLER STARTED ===');

        if (!STATE.isRunning) {
            log('⏸️ Not running, exiting');
            return;
        }

        if (STATE.isProcessing) {
            log('⚠️ Already processing, skipping to prevent duplicate execution');
            return;
        }

        STATE.isProcessing = true;
        log('🔒 Processing lock acquired');

        try {
            const clients = STATE.clientList;
            const index = STATE.currentIndex;

            log(`📊 Progress: ${index}/${clients.length}`);

            if (index >= clients.length) {
                log('✅ All clients processed!');
                STATE.isRunning = false;
                STATE.isProcessing = false;
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
            const resultsVisible = document.querySelector(CONFIG.firstResultLink);
            if (STATE.lastProcessedClient === clientNumber && resultsVisible) {
                log(`✓ Results already visible for ${clientNumber}, clicking first result`);
                STATE.lastProcessedClient = ''; // Clear so we can move to next
                await delay(500);
                resultsVisible.click();
                log('✓ Clicked first result, navigating to detail');
                return;
            }

            if (STATE.lastProcessedClient === clientNumber && !resultsVisible) {
                log(`⏭️ Already searched ${clientNumber} but no results, skipping`);
                STATE.currentIndex++;
                STATE.lastProcessedClient = '';
                STATE.isProcessing = false;
                await delay(1000);
                window.location.reload();
                return;
            }

            log(`🎯 Processing client ${index + 1}/${clients.length}: ${clientNumber}`);
            STATE.lastProcessedClient = clientNumber;
            updateControlPanel();

            // Fill search field
            const searchInput = document.querySelector(CONFIG.searchInput);
            if (!searchInput) {
                throw new Error('Search input not found');
            }
            log('✓ Search input found');

            searchInput.value = clientNumber;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));
            log(`✓ Search field filled with: ${clientNumber}`);

            await delay(500);

            // Click search button
            const searchBtn = document.querySelector(CONFIG.searchButton);
            if (!searchBtn) {
                throw new Error('Search button not found');
            }
            log('✓ Search button found');

            searchBtn.click();
            log('🔍 Search button clicked');

            // Wait for APEX to process and show results
            await delay(CONFIG.delayAfterSearch);
            log('⏳ Waited for search results');

            // Wait for and click first result
            const firstResult = await waitForElement(CONFIG.firstResultLink, 15000);
            log('✓ First result link found');

            await delay(500);

            log('🖱️ Clicking first result link');

            // Clear processing lock BEFORE clicking (critical!)
            STATE.isProcessing = false;
            log('🔓 Processing lock released BEFORE clicking link');

            firstResult.click();
            log('✓ First result clicked, navigating to detail page');

        } catch (error) {
            log('❌ ERROR in search page handler:', error.message);
            console.error('Full error:', error);

            const clientNumber = getCurrentClientNumber();
            addResult(clientNumber, RESULT_TYPES.ERROR, `Search error: ${error.message}`);
            STATE.currentIndex++;
            STATE.isProcessing = false;
            STATE.lastProcessedClient = '';

            await delay(2000);
            window.location.reload();
        }
    }

    // Detail page handler
    async function handleDetailPage() {
        log('📋 === DETAIL PAGE HANDLER STARTED ===');

        if (!STATE.isRunning) {
            log('⏸️ Not running, exiting');
            return;
        }

        if (STATE.isProcessing && !STATE.needsRecheck) {
            log('⚠️ Already processing (not a recheck), skipping');
            return;
        }

        if (!STATE.needsRecheck) {
            STATE.isProcessing = true;
            log('🔒 Processing lock acquired');
        }

        const clientNumber = getCurrentClientNumber();
        log(`📋 Processing detail page for: ${clientNumber}`);
        log(`🔄 Recheck mode: ${STATE.needsRecheck}`);

        try {
            await delay(CONFIG.delayBetweenChecks);

            // Check BTW field first
            const btwField = document.querySelector(CONFIG.btwField);
            if (!btwField) {
                throw new Error('BTW field not found - page may not be fully loaded');
            }
            log('✓ BTW field found');

            const btwValue = btwField.value.trim();
            log(`📄 BTW value: "${btwValue}"`);

            if (!btwValue || btwValue === '') {
                log('⏭️ Skipping - No BTW number (private customer)');
                addResult(clientNumber, RESULT_TYPES.SKIPPED_NO_BTW, 'No BTW number present');
                STATE.currentIndex++;
                STATE.processedCount++;
                STATE.isProcessing = false;
                STATE.lastProcessedClient = '';
                await returnToSearch();
                return;
            }

            log(`✓ BTW number present: ${btwValue}`);

            // If we just connected and need to recheck status
            if (STATE.needsRecheck) {
                log('🔄 Recheck mode - verifying Peppol status after connection');
                STATE.needsRecheck = false;
                await checkPeppolStatus(clientNumber, btwValue);
                return;
            }

            // Check if already connected to Peppol
            const peppolStatus = document.querySelector(CONFIG.peppolStatusField);
            if (!peppolStatus) {
                log('⚠️ Peppol status field not found');
            } else {
                const statusText = peppolStatus.textContent.trim();
                log(`📊 Current Peppol status: "${statusText}"`);

                if (statusText === 'Ja') {
                    log('⏭️ Already connected to Peppol');
                    addResult(clientNumber, RESULT_TYPES.SKIPPED_ALREADY_CONNECTED, 'Already connected to Peppol');
                    STATE.currentIndex++;
                    STATE.processedCount++;
                    STATE.isProcessing = false;
                    STATE.lastProcessedClient = '';
                    await returnToSearch();
                    return;
                }
            }

            // Check phone fields
            const phone1 = document.querySelector(CONFIG.phoneField1);
            const phone2 = document.querySelector(CONFIG.phoneField2);

            if (!phone1 || !phone2) {
                throw new Error('Phone fields not found');
            }
            log('✓ Phone fields found');

            const hasPhone1 = phone1.value && phone1.value.trim() !== '';
            const hasPhone2 = phone2.value && phone2.value.trim() !== '';
            log(`📞 Phone1: "${phone1.value}" (has value: ${hasPhone1})`);
            log(`📞 Phone2: "${phone2.value}" (has value: ${hasPhone2})`);

            // If neither phone field has a value, fill with placeholder
            if (!hasPhone1 && !hasPhone2) {
                log('📞 No phone numbers found, adding placeholder "0"');
                phone1.value = '0';
                phone1.dispatchEvent(new Event('input', { bubbles: true }));
                phone1.dispatchEvent(new Event('change', { bubbles: true }));
                log('✓ Placeholder added to phone1');
                await delay(CONFIG.delayBeforeConnect);
            } else {
                log('✓ Phone number(s) already present');
            }

            // Click Peppol connect button
            const connectBtn = document.querySelector(CONFIG.peppolConnectButton);
            if (!connectBtn) {
                throw new Error('Peppol connect button not found');
            }
            log('✓ Connect button found');

            log('🔗 Clicking "Koppelen aan Peppol" button...');
            connectBtn.click();

            // Mark that we need to recheck after the page reloads
            STATE.needsRecheck = true;
            log('🔄 Recheck flag set - will verify status after navigation');

            // Clear processing lock BEFORE navigation
            STATE.isProcessing = false;
            log('🔓 Processing lock released before navigation');

            await delay(CONFIG.delayAfterConnect);
            log('⏳ Waited after connect click');

            // The connect button returns to search page, so navigate back to client
            log('🔙 Navigating back to client to verify status');
            await navigateToClient(clientNumber);

        } catch (error) {
            log('❌ ERROR in detail page handler:', error.message);
            console.error('Full error:', error);

            const clientNumber = getCurrentClientNumber();
            addResult(clientNumber, RESULT_TYPES.ERROR, `Detail page error: ${error.message}`);
            STATE.currentIndex++;
            STATE.processedCount++;
            STATE.isProcessing = false;
            STATE.needsRecheck = false;
            STATE.lastProcessedClient = '';
            await returnToSearch();
        }
    }

    // Check Peppol connection status after connecting
    async function checkPeppolStatus(clientNumber, btwValue) {
        log('🔍 === CHECKING PEPPOL STATUS ===');

        try {
            await delay(CONFIG.delayBetweenChecks);

            const peppolStatus = document.querySelector(CONFIG.peppolStatusField);
            const peppolMessage = document.querySelector(CONFIG.peppolMessageField);

            if (!peppolStatus) {
                throw new Error('Peppol status field not found during verification');
            }

            const statusText = peppolStatus.textContent.trim();
            const messageText = peppolMessage ? peppolMessage.textContent.trim() : '';

            log(`📊 Status after connection: "${statusText}"`);
            log(`💬 Message: "${messageText}"`);

            if (statusText === 'Ja') {
                log('✅ Successfully connected to Peppol!');
                addResult(clientNumber, RESULT_TYPES.SUCCESS, 'Connected to Peppol');
            } else if (messageText.includes('Customer is not registered in Peppol with CBE number')) {
                log('⚠️ Customer not registered in Peppol yet');
                addResult(clientNumber, RESULT_TYPES.NOT_REGISTERED, `Not registered in Peppol (BTW: ${btwValue})`);
            } else {
                log('❓ Unexpected status after connection');
                addResult(clientNumber, RESULT_TYPES.ERROR, `Unexpected status: ${statusText}, message: ${messageText}`);
            }

            STATE.currentIndex++;
            STATE.processedCount++;
            STATE.isProcessing = false;
            STATE.lastProcessedClient = '';
            log('✓ Status check complete, moving to next client');

            await returnToSearch();

        } catch (error) {
            log('❌ ERROR checking Peppol status:', error.message);
            console.error('Full error:', error);

            addResult(clientNumber, RESULT_TYPES.ERROR, `Status check failed: ${error.message}`);
            STATE.currentIndex++;
            STATE.processedCount++;
            STATE.isProcessing = false;
            STATE.lastProcessedClient = '';
            await returnToSearch();
        }
    }

    // Navigate to a specific client
    async function navigateToClient(clientNumber) {
        log(`🔄 Navigating back to search to re-open client: ${clientNumber}`);

        const sessionId = window.location.href.match(/:(\d+):/)?.[1];
        if (!sessionId) {
            log('⚠️ Could not extract session ID, reloading page');
            window.location.reload();
            return;
        }

        // Go to search page first
        window.location.href = `${CONFIG.searchPageUrl}${sessionId}`;
    }

    // Return to search page
    async function returnToSearch() {
        log('🔙 Returning to search page');
        updateControlPanel();

        await delay(CONFIG.delayBeforeReturnToSearch);

        const sessionId = window.location.href.match(/:(\d+):/)?.[1];
        if (sessionId) {
            window.location.href = `${CONFIG.searchPageUrl}${sessionId}`;
        } else {
            log('⚠️ Could not extract session ID, reloading');
            window.location.reload();
        }
    }

    // Create control panel
    function createControlPanel() {
        const panel = document.createElement('div');
        panel.id = 'peppol-automation-panel';
        panel.style.cssText = `
    position: fixed;
    top: ${GM_getValue('peppol_panel_top', '60')}px;
    left: ${GM_getValue('peppol_panel_left', '')}${GM_getValue('peppol_panel_left', '') ? 'px' : ''};
    right: ${GM_getValue('peppol_panel_left', '') ? '' : '10px'};
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
    cursor: move;
`;

        const counts = getResultCounts();

        panel.innerHTML = `
            <div style="border-bottom: 2px solid #2563eb; padding-bottom: 10px; margin-bottom: 10px;">
                <h3 style="margin: 0; color: #2563eb; font-size: 16px;">☁️ Peppol Automation v2.2</h3>
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
                <strong>Status:</strong> <span id="peppol-status">Idle</span><br>
                <strong>Lock:</strong> <span id="peppol-processing-status">🔓 Unlocked</span>
            </div>
            <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 5px;">
                <button id="peppol-start" style="flex: 1; padding: 8px; background: #16a34a; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">▶ Start</button>
                <button id="peppol-pause" style="flex: 1; padding: 8px; background: #f59e0b; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">⏸ Pause</button>
            </div>
            <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px;">
                <button id="peppol-unlock" style="flex: 1; padding: 6px; background: #8b5cf6; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">🔓 Unlock</button>
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
        // Make panel draggable
        function makeDraggable(panel) {
            let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

            panel.onmousedown = dragMouseDown;

            function dragMouseDown(e) {
                // Only drag if clicking the header area
                if (e.target.tagName === 'BUTTON' || e.target.tagName === 'TEXTAREA' ||
                    e.target.tagName === 'INPUT' || e.target.tagName === 'SUMMARY') {
                    return;
                }

                e.preventDefault();
                pos3 = e.clientX;
                pos4 = e.clientY;
                document.onmouseup = closeDragElement;
                document.onmousemove = elementDrag;
            }

            function elementDrag(e) {
                e.preventDefault();
                pos1 = pos3 - e.clientX;
                pos2 = pos4 - e.clientY;
                pos3 = e.clientX;
                pos4 = e.clientY;

                const newTop = (panel.offsetTop - pos2);
                const newLeft = (panel.offsetLeft - pos1);

                panel.style.top = newTop + "px";
                panel.style.left = newLeft + "px";
                panel.style.right = "auto";
            }

            function closeDragElement() {
                document.onmouseup = null;
                document.onmousemove = null;

                // Save position
                GM_setValue('peppol_panel_top', panel.offsetTop);
                GM_setValue('peppol_panel_left', panel.offsetLeft);
                log(`💾 Panel position saved: top=${panel.offsetTop}, left=${panel.offsetLeft}`);
            }
        }

        makeDraggable(panel);
        attachPanelListeners();
        updateControlPanel();
        log('✓ Control panel created');
    }

    // Update control panel
    function updateControlPanel() {
        const clients = STATE.clientList;
        const index = STATE.currentIndex;
        const counts = getResultCounts();

        const progressEl = document.getElementById('peppol-progress');
        if (progressEl) progressEl.textContent = `${index}/${clients.length}`;

        const successEl = document.getElementById('peppol-success');
        if (successEl) successEl.textContent = counts.success;

        const skippedBtwEl = document.getElementById('peppol-skipped-btw');
        if (skippedBtwEl) skippedBtwEl.textContent = counts.skippedNoBtw;

        const skippedConnectedEl = document.getElementById('peppol-skipped-connected');
        if (skippedConnectedEl) skippedConnectedEl.textContent = counts.alreadyConnected;

        const notRegisteredEl = document.getElementById('peppol-not-registered');
        if (notRegisteredEl) notRegisteredEl.textContent = counts.notRegistered;

        const errorsEl = document.getElementById('peppol-errors');
        if (errorsEl) errorsEl.textContent = counts.errors;

        const statusEl = document.getElementById('peppol-status');
        if (statusEl) statusEl.textContent = STATE.isRunning ? '🟢 Running' : '⚪ Paused';

        const processingEl = document.getElementById('peppol-processing-status');
        if (processingEl) {
            if (STATE.isProcessing) {
                const lockAge = Math.round((Date.now() - STATE.processingTimestamp) / 1000);
                processingEl.textContent = `🔒 Locked (${lockAge}s)`;
                processingEl.style.color = lockAge > 10 ? '#dc2626' : '#f59e0b';
            } else {
                processingEl.textContent = '🔓 Unlocked';
                processingEl.style.color = '#16a34a';
            }
        }

        const progressBar = document.getElementById('peppol-progressbar');
        if (progressBar && clients.length > 0) {
            progressBar.value = (index / clients.length) * 100;
        }

        // Update not registered list
        const notRegList = document.getElementById('peppol-not-reg-list');
        if (notRegList) {
            const notRegistered = getNotRegisteredClients();
            if (notRegistered.length > 0) {
                notRegList.innerHTML = notRegistered.map(num =>
                    `<div style="padding: 2px 0;">${num}</div>`
                ).join('');
            } else {
                notRegList.innerHTML = '<em style="color: #6b7280;">No unregistered clients yet</em>';
            }
        }
    }

    // Attach event listeners
    function attachPanelListeners() {
        document.getElementById('peppol-start').addEventListener('click', async () => {
            if (STATE.clientList.length === 0) {
                alert('⚠️ Please load client list JSON first');
                return;
            }

            log('▶️ START button clicked');
            STATE.isRunning = true;
            STATE.isProcessing = false;
            STATE.lastProcessedClient = '';
            updateControlPanel();

            const page = getCurrentPage();
            log(`📍 Current page: ${page}`);

            if (page === 'search') {
                await handleSearchPage();
            } else if (page === 'detail') {
                await handleDetailPage();
            } else {
                log('❌ Unknown page type, please navigate to search page');
                alert('Please navigate to the search page first');
            }
        });

        document.getElementById('peppol-pause').addEventListener('click', () => {
            log('⏸️ PAUSE button clicked');
            STATE.isRunning = false;
            STATE.isProcessing = false;
            STATE.needsRecheck = false;
            STATE.lastProcessedClient = '';
            updateControlPanel();
        });

        document.getElementById('peppol-unlock').addEventListener('click', () => {
            clearProcessingLock();
        });

        document.getElementById('peppol-reset').addEventListener('click', () => {
            if (confirm('⚠️ Reset all progress and results? This cannot be undone!')) {
                log('🔄 RESET button confirmed');
                STATE.currentIndex = 0;
                STATE.processedCount = 0;
                STATE.results = [];
                STATE.isRunning = false;
                STATE.isProcessing = false;
                STATE.needsRecheck = false;
                STATE.lastProcessedClient = '';
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
                log(`📁 Loaded ${clients.length} clients`);
                alert(`✅ Loaded ${clients.length} clients`);
                updateControlPanel();
            } catch(e) {
                log('❌ JSON parse error:', e.message);
                alert('❌ Invalid JSON format: ' + e.message);
            }
        });

        document.getElementById('peppol-export').addEventListener('click', () => {
            exportResultsToCSV();
        });
    }

    // Initialize
    function init() {
        log('='.repeat(50));
        log('🚀 Peppol Automation v2.2 Initializing');
        log(`📍 Current URL: ${window.location.href}`);
        log(`📄 Page detected as: ${getCurrentPage()}`);
        log(`▶️ isRunning: ${STATE.isRunning}`);
        log(`🔒 isProcessing: ${STATE.isProcessing}`);
        log(`🔄 needsRecheck: ${STATE.needsRecheck}`);
        log(`📊 Current index: ${STATE.currentIndex}/${STATE.clientList.length}`);

        STATE.isProcessing = false;
        log('🔓 Processing lock cleared on page load');

        // Check and clear stale processing lock
        const wasStale = checkAndClearStaleLock();
        if (wasStale) {
            log('✓ Stale lock cleared');
        }

        log('='.repeat(50));

        if (!document.getElementById('peppol-automation-panel')) {
            createControlPanel();
        }

        // Continue automation if it was running and not processing
        if (STATE.isRunning && !STATE.isProcessing) {
            const page = getCurrentPage();
            log(`▶️ Continuing automation on ${page} page`);

            if (page === 'search') {
                setTimeout(() => handleSearchPage(), 2500);
            } else if (page === 'detail') {
                setTimeout(() => handleDetailPage(), 2500);
            } else {
                log('⚠️ Unknown page type, cannot continue automation');
            }
        } else if (STATE.isProcessing) {
            log('⚠️ Processing lock still active - use Unlock button if stuck');
        }
    }

    // Start after page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1500);
    }
})();