// ==UserScript==
// @name         Peppol Verbinding Automatisering
// @namespace    http://tampermonkey.net/
// @version      3.0
// @description  Automatiseer Peppol verbinding voor zakelijke klanten met telefoonnummer validatie en gedetailleerde tracking
// @author       Daniel
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:*
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=108011:100:*
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=KLANT_KLANTEN_RS*
// @match        file:///C:/Users/d/Desktop/Tampermonkey/*
// @downloadURL  https://raw.githubusercontent.com/Daniel-HM/tmScripts/refs/heads/main/peppol.js
// @updateURL    https://raw.githubusercontent.com/Daniel-HM/tmScripts/refs/heads/main/peppol.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @connect      *
// ==/UserScript==

(function() {
    'use strict';

    // Configuratie
    const CONFIG = {
        // Zoekpagina (pagina 1)
        searchInput: '#P1_KLANR',
        searchButton: 'button[onclick*="apex.submit({request:\'SEARCH\'})"]',
        firstResultLink: 'td.t-Report-cell a[href*="P100_DEKEYCE"]',

        // Detailpagina (pagina 100)
        phoneField1: '#P100_DEMBLNR',
        phoneField2: '#P100_DETELNR',
        btwField: '#P100_DEKLBTW',
        peppolConnectButton: 'button[onclick*="KOPPELEN_AAN_PEPPOL"]',
        peppolStatusField: '#P100_USES_PEPPOL_DISPLAY',
        peppolMessageField: '#P100_PEPPOL_MESSAGE_DISPLAY',

        // URLs
        searchPageUrl: 'https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:',

        // Vertragingen (in milliseconden)
        delayAfterSearch: 1000,
        delayBeforeConnect: 300,
        delayAfterConnect: 500,
        delayBetweenChecks: 500,
        delayBeforeReturnToSearch: 500,

        // Vergrendeling timeout (milliseconden)
        processingLockTimeout: 30000 // 30 seconden
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

    // Resultaat tracking categorieën
    const RESULT_TYPES = {
        SUCCESS: 'success',
        SKIPPED_NO_BTW: 'skipped_no_btw',
        SKIPPED_ALREADY_CONNECTED: 'skipped_already_connected',
        NOT_REGISTERED: 'not_registered_in_peppol',
        ERROR: 'error'
    };

    // Status beheer
    const STATE = {
        get currentIndex() { return GM_getValue('peppol_currentIndex', 0); },
        set currentIndex(val) { GM_setValue('peppol_currentIndex', val); },

        get clientList() { return JSON.parse(GM_getValue('peppol_clientList', '[]')); },
        set clientList(val) { GM_setValue('peppol_clientList', JSON.stringify(val)); },

        get isRunning() { return GM_getValue('peppol_isRunning', false); },
        set isRunning(val) { GM_setValue('peppol_isRunning', val); },

        get processedCount() { return GM_getValue('peppol_processedCount', 0); },
        set processedCount(val) { GM_setValue('peppol_processedCount', val); },

        // Vergrendeling met tijdstempel
        get isProcessing() { return GM_getValue('peppol_isProcessing', false); },
        set isProcessing(val) {
            GM_setValue('peppol_isProcessing', val);
            if (val) {
                GM_setValue('peppol_processingTimestamp', Date.now());
            }
        },

        get processingTimestamp() { return GM_getValue('peppol_processingTimestamp', 0); },

        // Gedetailleerde resultaat tracking
        get results() { return JSON.parse(GM_getValue('peppol_results', '[]')); },
        set results(val) { GM_setValue('peppol_results', JSON.stringify(val)); },

        // Moet opnieuw controleren na verbinden
        get needsRecheck() { return GM_getValue('peppol_needsRecheck', false); },
        set needsRecheck(val) { GM_setValue('peppol_needsRecheck', val); },

        // Bijhouden van laatst verwerkte klant om dubbele verwerking te voorkomen
        get lastProcessedClient() { return GM_getValue('peppol_lastProcessed', ''); },
        set lastProcessedClient(val) { GM_setValue('peppol_lastProcessed', val); }
    };

    // Controleer of verwerkingsvergrendeling verlopen is en wis deze
    function checkAndClearStaleLock() {
        if (STATE.isProcessing) {
            const lockAge = Date.now() - STATE.processingTimestamp;
            if (lockAge > CONFIG.processingLockTimeout) {
                log(`Verwerkingsvergrendeling is verlopen (${Math.round(lockAge/1000)}s oud), wordt gewist`);
                STATE.isProcessing = false;
                return true;
            }
        }
        return false;
    }

    // Handmatig vergrendeling wissen
    function clearProcessingLock() {
        log('Verwerkingsvergrendeling handmatig gewist');
        STATE.isProcessing = false;
        updateControlPanel();
    }

    // Voeg resultaat toe aan tracking
    function addResult(clientNumber, resultType, message = '') {
        const results = STATE.results;
        results.push({
            clientNumber,
            resultType,
            message,
            timestamp: new Date().toISOString()
        });
        STATE.results = results;
        log(`Resultaat vastgelegd: ${clientNumber} - ${resultType}`, message);
    }

    // Krijg aantallen per resultaattype
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

    // Exporteer niet-geregistreerde klanten naar JSON
    function exportNotRegisteredToJSON() {
        const notRegistered = getNotRegisteredClients();
        if (notRegistered.length === 0) {
            alert('Geen "Klant geen Peppol" resultaten om te exporteren');
            return;
        }

        const jsonData = JSON.stringify(notRegistered, null, 2);
        const blob = new Blob([jsonData], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `peppol_niet_geregistreerd_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        log(`JSON geëxporteerd met ${notRegistered.length} niet-geregistreerde klanten`);
    }


    // Krijg lijst van niet-geregistreerde klanten
    function getNotRegisteredClients() {
        return STATE.results
            .filter(r => r.resultType === RESULT_TYPES.NOT_REGISTERED)
            .map(r => r.clientNumber);
    }

    // Hulpfuncties
    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(selector);
            if (existing) {
                log(`Element direct gevonden: ${selector}`);
                return resolve(existing);
            }

            log(`Wachten op element: ${selector}`);

            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) {
                    observer.disconnect();
                    log(`Element verschenen: ${selector}`);
                    resolve(el);
                }
            });

            observer.observe(document.body, {
                childList: true,
                subtree: true
            });

            setTimeout(() => {
                observer.disconnect();
                log(`Timeout wachten op: ${selector}`);
                reject(new Error(`Timeout wachten op: ${selector}`));
            }, timeout);
        });
    }

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    // Wacht tot APEX pagina klaar is met laden
    function waitForApexReady(timeout = 15000) {
        return new Promise((resolve) => {
            const startTime = Date.now();

            const checkReady = () => {
                // Controleer of pagina klaar is met laden
                const loadingIndicators = document.querySelectorAll('.apex-page-loader, .u-Processing');
                const hasLoadingIndicators = loadingIndicators.length > 0;

                // Controleer op jQuery animaties
                const hasAnimations = typeof $ !== 'undefined' && $(':animated').length > 0;

                if (!loadingIndicators && !hasAnimations) {
                    log('Pagina klaar (geen laadindicatoren)');
                    resolve();
                    return;
                }

                if (Date.now() - startTime > timeout) {
                    log('Timeout wachten op pagina, doorgaan');
                    resolve();
                    return;
                }

                setTimeout(checkReady, 50);
            };

            setTimeout(checkReady, 200);
        });
    }

    function getCurrentPage() {
        const url = window.location.href;
        if (url.includes(':1:') || url.includes('f?p=KLANT_KLANTEN_RS:1')) return 'search';
        if (url.includes(':100:') || url.includes('f?p=KLANT_KLANTEN_RS:100')) return 'detail';

        // Terugval: controleer op specifieke elementen
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

    // Zoekpagina handler
    async function handleSearchPage() {
        log('=== ZOEKPAGINA HANDLER GESTART ===');

        if (!STATE.isRunning) {
            log('Niet actief, afsluiten');
            return;
        }

        if (STATE.isProcessing) {
            log('Al aan het verwerken, overslaan om dubbele uitvoering te voorkomen');
            return;
        }

        STATE.isProcessing = true;
        log('Verwerkingsvergrendeling verkregen');

        try {
            const clients = STATE.clientList;
            const index = STATE.currentIndex;

            log(`Voortgang: ${index}/${clients.length}`);

            if (index >= clients.length) {
                log('Alle klanten verwerkt!');
                STATE.isRunning = false;
                STATE.isProcessing = false;
                updateControlPanel();

                const counts = getResultCounts();
                alert(`Automatisering Voltooid!\n\n` +
                    `Totaal Verwerkt: ${counts.total}\n` +
                    `Succesvol Verbonden: ${counts.success}\n` +
                    `Overgeslagen (Geen BTW): ${counts.skippedNoBtw}\n` +
                    `Reeds Verbonden: ${counts.alreadyConnected}\n` +
                    `Niet Geregistreerd in Peppol: ${counts.notRegistered}\n` +
                    `Fouten: ${counts.errors}\n\n` +
                    `Klik op "Export klant geen Pepppol" om gedetailleerde resultaten te downloaden`);
                return;
            }

            const clientNumber = getCurrentClientNumber();
            const resultsVisible = document.querySelector(CONFIG.firstResultLink);
            if (STATE.lastProcessedClient === clientNumber && resultsVisible) {
                log(`Resultaten al zichtbaar voor ${clientNumber}, eerste resultaat aanklikken`);
                STATE.lastProcessedClient = '';
                await delay(200);
                resultsVisible.click();
                log('Eerste resultaat aangeklikt, navigeren naar detail');
                return;
            }

            if (STATE.lastProcessedClient === clientNumber && !resultsVisible) {
                log(`Al gezocht naar ${clientNumber} maar geen resultaten, overslaan`);
                STATE.currentIndex++;
                STATE.lastProcessedClient = '';
                STATE.isProcessing = false;
                await delay(1000);
                window.location.reload();
                return;
            }

            log(`Klant verwerken ${index + 1}/${clients.length}: ${clientNumber}`);
            STATE.lastProcessedClient = clientNumber;
            updateControlPanel();

            // Vul zoekveld in
            const searchInput = document.querySelector(CONFIG.searchInput);
            if (!searchInput) {
                throw new Error('Zoekveld niet gevonden');
            }
            log('Zoekveld gevonden');

            searchInput.value = clientNumber;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));
            log(`Zoekveld ingevuld met: ${clientNumber}`);

            await delay(500);

            // Klik zoekknop
            const searchBtn = document.querySelector(CONFIG.searchButton);
            if (!searchBtn) {
                throw new Error('Zoekknop niet gevonden');
            }
            log('Zoekknop gevonden');

            searchBtn.click();
            log('Zoekknop aangeklikt');

            // Wacht tot APEX zoekresultaten toont
            await delay(CONFIG.delayAfterSearch);
            await waitForApexReady();
            log('Zoekresultaten klaar');

            // Wacht op en klik eerste resultaat
            const firstResult = await waitForElement(CONFIG.firstResultLink, 15000);
            log('Eerste resultaat link gevonden');

            await delay(500);

            log('Eerste resultaat link aanklikken');

            // Wis verwerkingsvergrendeling VOOR het klikken (kritiek!)
            STATE.isProcessing = false;
            log('Verwerkingsvergrendeling vrijgegeven VOOR het klikken op link');

            firstResult.click();
            log('Eerste resultaat aangeklikt, navigeren naar detailpagina');

        } catch (error) {
            log('FOUT in zoekpagina handler:', error.message);
            console.error('Volledige fout:', error);

            const clientNumber = getCurrentClientNumber();
            addResult(clientNumber, RESULT_TYPES.ERROR, `Zoekfout: ${error.message}`);
            STATE.currentIndex++;
            STATE.isProcessing = false;
            STATE.lastProcessedClient = '';

            await delay(2000);
            window.location.reload();
        }
    }

    // Detailpagina handler
    async function handleDetailPage() {
        log('=== DETAILPAGINA HANDLER GESTART ===');

        if (!STATE.isRunning) {
            log('Niet actief, afsluiten');
            return;
        }

        if (STATE.isProcessing && !STATE.needsRecheck) {
            log('Al aan het verwerken (geen hercontrole), overslaan');
            return;
        }

        if (!STATE.needsRecheck) {
            STATE.isProcessing = true;
            log('Verwerkingsvergrendeling verkregen');
        }

        const clientNumber = getCurrentClientNumber();
        log(`Detailpagina verwerken voor: ${clientNumber}`);
        log(`Hercontrole modus: ${STATE.needsRecheck}`);

        try {
            await delay(500);
            await waitForApexReady();

            // Controleer eerst BTW veld
            const btwField = document.querySelector(CONFIG.btwField);
            if (!btwField) {
                throw new Error('BTW veld niet gevonden - pagina mogelijk niet volledig geladen');
            }
            log('BTW veld gevonden');

            const btwValue = btwField.value.trim();
            log(`BTW waarde: "${btwValue}"`);

            if (!btwValue || btwValue === '') {
                log('Overslaan - Geen BTW nummer (particuliere klant)');
                addResult(clientNumber, RESULT_TYPES.SKIPPED_NO_BTW, 'Geen BTW nummer aanwezig');
                STATE.currentIndex++;
                STATE.processedCount++;
                STATE.isProcessing = false;
                STATE.lastProcessedClient = '';
                await returnToSearch();
                return;
            }

            log(`BTW nummer aanwezig: ${btwValue}`);

            // Als we net verbonden hebben en status moeten hercontroleren
            if (STATE.needsRecheck) {
                log('Hercontrole modus - Peppol status verifiëren na verbinding');
                STATE.needsRecheck = false;
                await checkPeppolStatus(clientNumber, btwValue);
                return;
            }

            // Controleer of al verbonden met Peppol
            const peppolStatus = document.querySelector(CONFIG.peppolStatusField);
            if (!peppolStatus) {
                log('Peppol status veld niet gevonden');
            } else {
                const statusText = peppolStatus.textContent.trim();
                log(`Huidige Peppol status: "${statusText}"`);

                if (statusText === 'Ja') {
                    log('Al verbonden met Peppol');
                    addResult(clientNumber, RESULT_TYPES.SKIPPED_ALREADY_CONNECTED, 'Al verbonden met Peppol');
                    STATE.currentIndex++;
                    STATE.processedCount++;
                    STATE.isProcessing = false;
                    STATE.lastProcessedClient = '';
                    await returnToSearch();
                    return;
                }
            }

            // Controleer telefoonnummer velden
            const phone1 = document.querySelector(CONFIG.phoneField1);
            const phone2 = document.querySelector(CONFIG.phoneField2);

            if (!phone1 || !phone2) {
                throw new Error('Telefoonnummer velden niet gevonden');
            }
            log('Telefoonnummer velden gevonden');

            const hasPhone1 = phone1.value && phone1.value.trim() !== '';
            const hasPhone2 = phone2.value && phone2.value.trim() !== '';
            log(`Telefoon1: "${phone1.value}" (heeft waarde: ${hasPhone1})`);
            log(`Telefoon2: "${phone2.value}" (heeft waarde: ${hasPhone2})`);

            // Als geen van beide telefoonnummer velden een waarde heeft, vul met placeholder
            if (!hasPhone1 && !hasPhone2) {
                log('Geen telefoonnummers gevonden, placeholder "0" toevoegen');
                phone1.value = '0';
                phone1.dispatchEvent(new Event('input', { bubbles: true }));
                phone1.dispatchEvent(new Event('change', { bubbles: true }));
                log('Placeholder toegevoegd aan telefoon1');
                await delay(CONFIG.delayBeforeConnect);
            } else {
                log('Telefoonnummer(s) al aanwezig');
            }

            // Klik Peppol verbindingsknop
            const connectBtn = document.querySelector(CONFIG.peppolConnectButton);
            if (!connectBtn) {
                throw new Error('Peppol verbindingsknop niet gevonden');
            }
            log('Verbindingsknop gevonden');

            log('"Koppelen aan Peppol" knop aanklikken...');
            connectBtn.click();

            // Markeer dat we na herladen opnieuw moeten controleren
            STATE.needsRecheck = true;
            log('Hercontrole ingesteld - zal status verifiëren na navigatie');

            // Wis verwerkingsvergrendeling VOOR navigatie
            STATE.isProcessing = false;
            log('Verwerkingsvergrendeling vrijgegeven voor navigatie');

            await delay(CONFIG.delayAfterConnect);
            await waitForApexReady();
            log('Gewacht na verbindingsknop klik');

            // De verbindingsknop gaat terug naar zoekpagina, dus navigeer terug naar klant
            log('Navigeren terug naar klant om status te verifiëren');
            await navigateToClient(clientNumber);

        } catch (error) {
            log('FOUT in detailpagina handler:', error.message);
            console.error('Volledige fout:', error);

            const clientNumber = getCurrentClientNumber();
            addResult(clientNumber, RESULT_TYPES.ERROR, `Detailpagina fout: ${error.message}`);
            STATE.currentIndex++;
            STATE.processedCount++;
            STATE.isProcessing = false;
            STATE.needsRecheck = false;
            STATE.lastProcessedClient = '';
            await returnToSearch();
        }
    }

    // Controleer Peppol verbindingsstatus na verbinden
    async function checkPeppolStatus(clientNumber, btwValue) {
        log('=== PEPPOL STATUS CONTROLEREN ===');

        try {
            await delay(CONFIG.delayBetweenChecks);

            const peppolStatus = document.querySelector(CONFIG.peppolStatusField);
            const peppolMessage = document.querySelector(CONFIG.peppolMessageField);

            if (!peppolStatus) {
                throw new Error('Peppol status veld niet gevonden tijdens verificatie');
            }

            const statusText = peppolStatus.textContent.trim();
            const messageText = peppolMessage ? peppolMessage.textContent.trim() : '';

            log(`Status na verbinding: "${statusText}"`);
            log(`Bericht: "${messageText}"`);

            if (statusText === 'Ja') {
                log('Succesvol verbonden met Peppol!');
                addResult(clientNumber, RESULT_TYPES.SUCCESS, 'Verbonden met Peppol');
            } else if (messageText.includes('Customer is not registered in Peppol')) {
                log('Klant nog niet geregistreerd in Peppol');
                addResult(clientNumber, RESULT_TYPES.NOT_REGISTERED, `Niet geregistreerd in Peppol (BTW: ${btwValue})`);
            } else {
                log('Onverwachte status na verbinding');
                addResult(clientNumber, RESULT_TYPES.ERROR, `Onverwachte status: ${statusText}, bericht: ${messageText}`);
            }

            STATE.currentIndex++;
            STATE.processedCount++;
            STATE.isProcessing = false;
            STATE.lastProcessedClient = '';
            log('Statuscontrole compleet, naar volgende klant');

            await returnToSearch();

        } catch (error) {
            log('FOUT bij controleren Peppol status:', error.message);
            console.error('Volledige fout:', error);

            addResult(clientNumber, RESULT_TYPES.ERROR, `Statuscontrole mislukt: ${error.message}`);
            STATE.currentIndex++;
            STATE.processedCount++;
            STATE.isProcessing = false;
            STATE.lastProcessedClient = '';
            await returnToSearch();
        }
    }

    // Navigeer naar een specifieke klant
    async function navigateToClient(clientNumber) {
        log(`Terug navigeren naar zoeken om klant te heropenen: ${clientNumber}`);

        const match = window.location.href.match(/f\?p=\d+:\d+:(\d+)/);
        const sessionId = match ? match[1] : null;
        if (sessionId) {
            const searchUrl = `https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:${sessionId}`;
            log(`Navigeren naar: ${searchUrl}`);
            window.location.href = searchUrl;
        } else {
            log('Kon sessie-ID niet extraheren, pagina herladen');
            window.location.reload();
        }
    }

    // Terug naar zoekpagina
    async function returnToSearch() {
        log('Terug naar zoekpagina');
        updateControlPanel();

        await delay(CONFIG.delayBeforeReturnToSearch);

        const match = window.location.href.match(/f\?p=\d+:\d+:(\d+)/);
        const sessionId = match ? match[1] : null;

        if (sessionId) {
            const searchUrl = `https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:${sessionId}`;
            log(`Navigeren naar: ${searchUrl}`);
            window.location.href = searchUrl;
        } else {
            log('Kon sessie-ID niet extraheren, herladen');
            window.location.reload();
        }
    }

    // Maak controlepaneel
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
            <div style="margin-bottom: 10px; font-size: 13px;">
                <strong>Voortgang:</strong> <span id="peppol-progress">0/0</span><br>
                <div style="margin-top: 5px;">
                    <progress id="peppol-progressbar" value="0" max="100" style="width: 100%; height: 20px;"></progress>
                </div>
            </div>
            <div style="margin-bottom: 10px; font-size: 12px; line-height: 1.6;">
                <strong style="color: #16a34a;">Verbonden:</strong> <span id="peppol-success">${counts.success}</span><br>
                <strong style="color: #9ca3af;">Geen zakelijke klant:</strong> <span id="peppol-skipped-btw">${counts.skippedNoBtw}</span><br>
                <strong style="color: #9ca3af;">Reeds verbonden:</strong> <span id="peppol-skipped-connected">${counts.alreadyConnected}</span><br>
                <strong style="color: #f59e0b;">Klant geen Peppol:</strong> <span id="peppol-not-registered">${counts.notRegistered}</span><br>
                <strong style="color: #dc2626;">Fouten:</strong> <span id="peppol-errors">${counts.errors}</span><br>
                <hr style="margin: 8px 0;">
                <strong>Status:</strong> <span id="peppol-status">Inactief</span><br>
            </div>
            <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 5px;">
                <button id="peppol-toggle" style="flex: 1; padding: 8px; background: #16a34a; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">▶ Start</button>
            </div>
            <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px;">
                <button id="peppol-reset" style="flex: 1; padding: 6px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">🔄 Alles Resetten</button>
                <button id="peppol-export" style="flex: 1; padding: 6px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">📥 Export klant geen Peppol(JSON)</button>
            </div>
            
            <details style="margin-bottom: 10px;">
                <summary style="cursor: pointer; font-weight: bold; font-size: 12px; margin-bottom: 5px;">📋 Laad Klantenlijst</summary>
                <textarea id="peppol-json-input" placeholder='Plak JSON array hier, bijv.:
[12345, 67890]
of
[{"klantnummer": 12345}]' style="width: 100%; height: 100px; font-size: 11px; padding: 5px; margin-top: 5px; font-family: monospace;"></textarea>
                <button id="peppol-load" style="width: 100%; padding: 6px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 5px; font-size: 11px;">📁 Laad JSON</button>
            </details>
            <details>
                <summary style="cursor: pointer; font-weight: bold; font-size: 12px;">📊 Niet Geregistreerd Lijst</summary>
                <div id="peppol-not-reg-list" style="margin-top: 5px; font-size: 11px; max-height: 150px; overflow-y: auto; background: #f3f4f6; padding: 8px; border-radius: 4px;">
                    <em style="color: #6b7280;">Nog geen data</em>
                </div>
            </details>
        `;

        document.body.appendChild(panel);

        // Maak paneel versleepbaar
        function makeDraggable(panel) {
            let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;

            panel.onmousedown = dragMouseDown;

            function dragMouseDown(e) {
                // Alleen slepen als je op het header gebied klikt
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

                // Bewaar positie
                GM_setValue('peppol_panel_top', panel.offsetTop);
                GM_setValue('peppol_panel_left', panel.offsetLeft);
                log(`Paneelpositie opgeslagen: top=${panel.offsetTop}, left=${panel.offsetLeft}`);
            }
        }

        makeDraggable(panel);
        attachPanelListeners();
        updateControlPanel();
        log('✓ Controlepaneel aangemaakt');
    }

    // Update controlepaneel
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
        if (statusEl) statusEl.textContent = STATE.isRunning ? '🟢 Actief' : '⚪ Gepauzeerd';

        // Update wisselknop
        const toggleBtn = document.getElementById('peppol-toggle');
        if (toggleBtn) {
            if (STATE.isRunning) {
                toggleBtn.textContent = '⏸ Pauzeer';
                toggleBtn.style.background = '#f59e0b';
            } else {
                toggleBtn.textContent = '▶ Start';
                toggleBtn.style.background = '#16a34a';
            }
        }

        const progressBar = document.getElementById('peppol-progressbar');
        if (progressBar && clients.length > 0) {
            progressBar.value = (index / clients.length) * 100;
        }

        // Update niet-geregistreerd lijst
        const notRegList = document.getElementById('peppol-not-reg-list');
        if (notRegList) {
            const notRegistered = getNotRegisteredClients();
            if (notRegistered.length > 0) {
                notRegList.innerHTML = notRegistered.map(num =>
                    `<div style="padding: 2px 0;">${num}</div>`
                ).join('');
            } else {
                notRegList.innerHTML = '<em style="color: #6b7280;">Nog geen niet-geregistreerde klanten</em>';
            }
        }
    }

    // Koppel event listeners
    function attachPanelListeners() {
        document.getElementById('peppol-toggle').addEventListener('click', async () => {
            if (STATE.isRunning) {
                // Pauzeer
                log('PAUZEER knop aangeklikt');
                STATE.isRunning = false;
                STATE.isProcessing = false;
                STATE.needsRecheck = false;
                STATE.lastProcessedClient = '';
                updateControlPanel();
            } else {
                // Start
                if (STATE.clientList.length === 0) {
                    alert('Eerst een klantenlijst laden, aub :-)');
                    return;
                }

                log('START knop aangeklikt');
                STATE.isRunning = true;
                STATE.isProcessing = false;
                STATE.lastProcessedClient = '';
                updateControlPanel();

                const page = getCurrentPage();
                log(`Huidige pagina: ${page}`);

                if (page === 'search') {
                    await handleSearchPage();
                } else if (page === 'detail') {
                    await handleDetailPage();
                } else {
                    log('Onbekend paginatype, navigeer naar de zoekpagina');
                    alert('Navigeer eerst naar de zoekpagina');
                }
            }
        });

        document.getElementById('peppol-reset').addEventListener('click', () => {
            if (confirm('Alles resetten (voortgang, resultaten en geladen klantenlijst)? Dit kan niet ongedaan worden gemaakt!')) {
                log('VOLLEDIGE RESET bevestigd');
                STATE.currentIndex = 0;
                STATE.processedCount = 0;
                STATE.results = [];
                STATE.clientList = [];
                STATE.isRunning = false;
                STATE.isProcessing = false;
                STATE.needsRecheck = false;
                STATE.lastProcessedClient = '';

                // Wis ook het tekstveld
                const jsonInput = document.getElementById('peppol-json-input');
                if (jsonInput) jsonInput.value = '';

                updateControlPanel();
                alert('Alles gereset. Alle data gewist.');
            }
        });

        document.getElementById('peppol-load').addEventListener('click', () => {
            const jsonText = document.getElementById('peppol-json-input').value.trim();

            if (!jsonText) {
                alert('Plak JSON in het tekstveld');
                return;
            }

            try {
                const data = JSON.parse(jsonText);
                const clients = Array.isArray(data) ? data : [data];

                if (clients.length === 0) {
                    alert('JSON array is leeg');
                    return;
                }

                STATE.clientList = clients;
                log(`${clients.length} klanten geladen`);
                alert(`${clients.length} klanten geladen`);
                updateControlPanel();
            } catch(e) {
                log('JSON parse fout:', e.message);
                alert('Ongeldig JSON formaat: ' + e.message);
            }
        });

        document.getElementById('peppol-export').addEventListener('click', () => {
            exportNotRegisteredToJSON();
        });

    }

    // Initialiseer
    function init() {
        log('='.repeat(50));
        log('Peppol Automatisering v3.0 Initialiseren');
        log(`Huidige URL: ${window.location.href}`);
        log(`Pagina gedetecteerd als: ${getCurrentPage()}`);
        log(`▶isRunning: ${STATE.isRunning}`);
        log(`isProcessing: ${STATE.isProcessing}`);
        log(`needsRecheck: ${STATE.needsRecheck}`);
        log(`Huidige index: ${STATE.currentIndex}/${STATE.clientList.length}`);

        STATE.isProcessing = false;
        log('Verwerkingsvergrendeling gewist bij pagina laden');

        // Controleer en wis verlopen vergrendeling
        const wasStale = checkAndClearStaleLock();
        if (wasStale) {
            log('Verlopen vergrendeling gewist');
        }

        log('='.repeat(50));

        if (!document.getElementById('peppol-automation-panel')) {
            createControlPanel();
        }

        // Ga door met automatisering als deze actief was en niet aan het verwerken
        if (STATE.isRunning && !STATE.isProcessing) {
            const page = getCurrentPage();
            log(`Automatisering voortzetten op ${page} pagina`);

            if (page === 'search') {
                setTimeout(() => handleSearchPage(), 2500);
            } else if (page === 'detail') {
                setTimeout(() => handleDetailPage(), 2500);
            } else {
                log('Onbekend paginatype, kan automatisering niet voortzetten');
            }
        } else if (STATE.isProcessing) {
            log('Verwerkingsvergrendeling nog steeds actief');
        }
    }

    // Start na pagina laden
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1500);
    }
})();