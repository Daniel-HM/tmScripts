// ==UserScript==
// @name         Peppol Verbinding Automatisering
// @namespace    http://tampermonkey.net/
// @version      4.4
// @description  Automatiseer Peppol verbinding voor zakelijke klanten met telefoonnummer validatie en gedetailleerde tracking. Klant deactivatie module inbegrepen.
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

    // ─── Configuratie ─────────────────────────────────────────────────────────
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

        // Deactivatie specifiek
        activeCheckbox: '#P100_DEACTIN',
        saveButton: 'button[onclick*="UPDATE"]',
        lastPurchaseDateField: '#P100_DELAKDT',

        // Deactivatie drempelwaarde: klanten met laatste aankoop vóór deze datum worden gedeactiveerd
        // Formaat: new Date(jaar, maand-1, dag)  →  31/12/2022 = new Date(2022, 11, 31)
        deactivateBefore: new Date(2022, 11, 31),

        // Peppol CBE herpoging
        // cbeRetryEnabled wordt gelezen/geschreven via GM_getValue/GM_setValue (overleeft paginaladingen)
        get cbeRetryEnabled() { return GM_getValue('peppol_cbeRetryEnabled', false); },
        set cbeRetryEnabled(val) { GM_setValue('peppol_cbeRetryEnabled', val); },
        peppolIdentifierTypeField: '#P100_PEPPOL_IDENTIFIER_TYPE',

        // URLs
        searchPageUrl: 'https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:',

        // Vertragingen (in milliseconden)
        // ── Zoekpagina ──────────────────────────────────────────────────────
        delayBeforeSearchClick: 500,           // wacht na invullen zoekveld vóór klikken zoekknop
        delayAfterSearch: 1000,               // wacht na klikken zoekknop vóór waitForApexReady
        delayBeforeFirstResultClick: 500,     // korte pauze nadat zoekresultaten zichtbaar zijn
        delayBeforeAlreadyVisibleClick: 200,  // wanneer resultaten al zichtbaar zijn (herstart)
        delayOnNoResults: 1000,               // wacht voor page reload bij geen zoekresultaten
        delayOnSearchError: 2000,             // wacht voor page reload bij zoekfout

        // ── Detailpagina (Peppol) ────────────────────────────────────────────
        delayAtDetailPageStart: 500,          // initiële wacht bij laden detailpagina
        delayBeforeConnect: 300,              // wacht na invullen telefoonnummer vóór koppelen
        delayAfterConnect: 500,               // wacht na klikken koppelknop
        delayBetweenChecks: 500,              // wacht vóór status hercontrole na terugnavigatie

        // ── Detailpagina (Deactivatie) ───────────────────────────────────────
        delayAtDeactDetailPageStart: 800,     // initiële wacht bij laden detailpagina (deact)
        delayAfterCheckboxClick: 300,         // wacht na uitvinken checkbox (APEX verwerking)
        delayAfterCheckboxFallback: 300,      // wacht na fallback change-event op checkbox
        delayAfterSave: 1000,                 // wacht na klikken Bewaren vóór waitForApexReady

        // ── Navigatie ────────────────────────────────────────────────────────
        delayBeforeReturnToSearch: 500,       // wacht vóór terugnavigatie naar zoekpagina

        // ── Initialisatie ────────────────────────────────────────────────────
        delayOnInit: 2500,                    // wacht bij hervatten automatisering na pageload

        // ── Overig ───────────────────────────────────────────────────────────
        processingLockTimeout: 5000          // max tijd verwerkingsvergrendeling (ms)
    };

    // ─── Debug logging ────────────────────────────────────────────────────────
    function log(message, data = null) {
        const timestamp = new Date().toLocaleTimeString();
        const mode = getMode();
        const prefix = `[${mode === 'deactivation' ? 'Deact' : 'Peppol'} ${timestamp}]`;
        if (data) {
            console.log(prefix, message, data);
        } else {
            console.log(prefix, message);
        }
    }

    // ─── Mode beheer ──────────────────────────────────────────────────────────
    function getMode() { return GM_getValue('automation_mode', null); }
    function setMode(mode) { GM_setValue('automation_mode', mode); }

    // ─── Resultaat types (Peppol) ─────────────────────────────────────────────
    const RESULT_TYPES = {
        SUCCESS: 'success',
        SUCCESS_VIA_CBE: 'success_via_cbe',
        SKIPPED_NO_BTW: 'skipped_no_btw',
        SKIPPED_ALREADY_CONNECTED: 'skipped_already_connected',
        NOT_REGISTERED: 'not_registered_in_peppol',
        ERROR: 'error'
    };

    // Resultaat types deactivatie
    const DEACT_RESULT_TYPES = {
        DEACTIVATED: 'deactivated',
        SKIPPED_RECENT_PURCHASE: 'skipped_recent_purchase',
        SKIPPED_ALREADY_INACTIVE: 'skipped_already_inactive',
        NOT_FOUND: 'not_found',
        ERROR: 'error'
    };

    // ─── Status beheer ────────────────────────────────────────────────────────
    const STATE = {
        // Peppol state
        get currentIndex() { return GM_getValue('peppol_currentIndex', 0); },
        set currentIndex(val) { GM_setValue('peppol_currentIndex', val); },

        get clientList() { return JSON.parse(GM_getValue('peppol_clientList', '[]')); },
        set clientList(val) { GM_setValue('peppol_clientList', JSON.stringify(val)); },

        get isRunning() { return GM_getValue('peppol_isRunning', false); },
        set isRunning(val) { GM_setValue('peppol_isRunning', val); },

        get processedCount() { return GM_getValue('peppol_processedCount', 0); },
        set processedCount(val) { GM_setValue('peppol_processedCount', val); },

        get isProcessing() { return GM_getValue('peppol_isProcessing', false); },
        set isProcessing(val) {
            GM_setValue('peppol_isProcessing', val);
            if (val) GM_setValue('peppol_processingTimestamp', Date.now());
        },

        get processingTimestamp() { return GM_getValue('peppol_processingTimestamp', 0); },

        get results() { return JSON.parse(GM_getValue('peppol_results', '[]')); },
        set results(val) { GM_setValue('peppol_results', JSON.stringify(val)); },

        get needsRecheck() { return GM_getValue('peppol_needsRecheck', false); },
        set needsRecheck(val) { GM_setValue('peppol_needsRecheck', val); },

        get lastProcessedClient() { return GM_getValue('peppol_lastProcessed', ''); },
        set lastProcessedClient(val) { GM_setValue('peppol_lastProcessed', val); },

        // Peppol CBE herpoging state
        get needsCbeSwitch() { return GM_getValue('peppol_needsCbeSwitch', false); },
        set needsCbeSwitch(val) { GM_setValue('peppol_needsCbeSwitch', val); },

        get needsCbeConnect() { return GM_getValue('peppol_needsCbeConnect', false); },
        set needsCbeConnect(val) { GM_setValue('peppol_needsCbeConnect', val); },

        get needsCbeRecheck() { return GM_getValue('peppol_needsCbeRecheck', false); },
        set needsCbeRecheck(val) { GM_setValue('peppol_needsCbeRecheck', val); },

        get cbeOriginalValue() { return GM_getValue('peppol_cbeOriginalValue', ''); },
        set cbeOriginalValue(val) { GM_setValue('peppol_cbeOriginalValue', val); },

        // Deactivatie state
        get deactCurrentIndex() { return GM_getValue('deact_currentIndex', 0); },
        set deactCurrentIndex(val) { GM_setValue('deact_currentIndex', val); },

        get deactClientList() { return JSON.parse(GM_getValue('deact_clientList', '[]')); },
        set deactClientList(val) { GM_setValue('deact_clientList', JSON.stringify(val)); },

        get deactIsRunning() { return GM_getValue('deact_isRunning', false); },
        set deactIsRunning(val) { GM_setValue('deact_isRunning', val); },

        get deactIsProcessing() { return GM_getValue('deact_isProcessing', false); },
        set deactIsProcessing(val) {
            GM_setValue('deact_isProcessing', val);
            if (val) GM_setValue('deact_processingTimestamp', Date.now());
        },

        get deactResults() { return JSON.parse(GM_getValue('deact_results', '[]')); },
        set deactResults(val) { GM_setValue('deact_results', JSON.stringify(val)); },

        get deactLastProcessedClient() { return GM_getValue('deact_lastProcessed', ''); },
        set deactLastProcessedClient(val) { GM_setValue('deact_lastProcessed', val); },

        get deactPhase() { return GM_getValue('deact_phase', 'search'); },
        set deactPhase(val) { GM_setValue('deact_phase', val); },

        // Timer state – opgeslagen in ms epoch zodat ze paginaladingen overleven
        get peppolStartTime() { return GM_getValue('peppol_startTime', 0); },
        set peppolStartTime(val) { GM_setValue('peppol_startTime', val); },
        get peppolElapsed() { return GM_getValue('peppol_elapsed', 0); },   // ms vóór pauze
        set peppolElapsed(val) { GM_setValue('peppol_elapsed', val); },

        get deactStartTime() { return GM_getValue('deact_startTime', 0); },
        set deactStartTime(val) { GM_setValue('deact_startTime', val); },
        get deactElapsed() { return GM_getValue('deact_elapsed', 0); },
        set deactElapsed(val) { GM_setValue('deact_elapsed', val); }
    };

    // ─── Hulpfuncties ─────────────────────────────────────────────────────────
    function checkAndClearStaleLock() {
        if (STATE.isProcessing) {
            const lockAge = Date.now() - STATE.processingTimestamp;
            if (lockAge > CONFIG.processingLockTimeout) {
                log(`Verwerkingsvergrendeling verlopen (${Math.round(lockAge/1000)}s), wordt gewist`);
                STATE.isProcessing = false;
                return true;
            }
        }
        return false;
    }

    function clearProcessingLock() {
        log('Verwerkingsvergrendeling handmatig gewist');
        STATE.isProcessing = false;
        STATE.deactIsProcessing = false;
        updateControlPanel();
    }

    function clearCbeState() {
        STATE.needsRecheck = false;
        STATE.needsCbeSwitch = false;
        STATE.needsCbeConnect = false;
        STATE.needsCbeRecheck = false;
        STATE.cbeOriginalValue = '';
    }


    // ─── Timer hulpfuncties ───────────────────────────────────────────────────
    // Één interval-handle gedeeld door beide modules (alleen actieve tikt)
    let _timerInterval = null;

    function formatElapsed(ms) {
        const totalSec = Math.floor(ms / 1000);
        const h = Math.floor(totalSec / 3600);
        const m = Math.floor((totalSec % 3600) / 60);
        const s = totalSec % 60;
        const pad = n => String(n).padStart(2, '0');
        return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
    }

    function getTotalElapsed(startTime, savedElapsed) {
        if (!startTime) return savedElapsed;
        return savedElapsed + (Date.now() - startTime);
    }

    function startTimer(isPeppol) {
        if (isPeppol) { STATE.peppolStartTime = Date.now(); }
        else { STATE.deactStartTime = Date.now(); }
        _startTimerInterval();
    }

    function pauseTimer(isPeppol) {
        if (isPeppol) {
            if (STATE.peppolStartTime) {
                STATE.peppolElapsed += Date.now() - STATE.peppolStartTime;
                STATE.peppolStartTime = 0;
            }
        } else {
            if (STATE.deactStartTime) {
                STATE.deactElapsed += Date.now() - STATE.deactStartTime;
                STATE.deactStartTime = 0;
            }
        }
        _stopTimerInterval();
    }

    function resetTimer(isPeppol) {
        if (isPeppol) { STATE.peppolStartTime = 0; STATE.peppolElapsed = 0; }
        else { STATE.deactStartTime = 0; STATE.deactElapsed = 0; }
        _stopTimerInterval();
    }

    function _startTimerInterval() {
        if (_timerInterval) return;
        _timerInterval = setInterval(_tickTimer, 1000);
    }

    function _stopTimerInterval() {
        if (_timerInterval) { clearInterval(_timerInterval); _timerInterval = null; }
    }

    function _tickTimer() {
        const mode = getMode();
        if (mode === 'peppol') {
            if (!STATE.isRunning) { _stopTimerInterval(); return; }
            const ms = getTotalElapsed(STATE.peppolStartTime, STATE.peppolElapsed);
            const el = document.getElementById('peppol-elapsed');
            if (el) el.textContent = formatElapsed(ms);
            _updateRate('peppol', ms);
        } else if (mode === 'deactivation') {
            if (!STATE.deactIsRunning) { _stopTimerInterval(); return; }
            const ms = getTotalElapsed(STATE.deactStartTime, STATE.deactElapsed);
            const el = document.getElementById('deact-elapsed');
            if (el) el.textContent = formatElapsed(ms);
            _updateRate('deact', ms);
        }
    }

    function _updateRate(prefix, elapsedMs) {
        const rateEl = document.getElementById(`${prefix}-rate`);
        if (!rateEl) return;
        const processed = prefix === 'peppol' ? STATE.currentIndex : STATE.deactCurrentIndex;
        const minutes = elapsedMs / 60000;
        if (minutes < 0.1 || processed === 0) { rateEl.textContent = '—'; return; }
        rateEl.textContent = (processed / minutes).toFixed(1);
    }

    function renderTimerDisplay(prefix, elapsedMs) {
        const el = document.getElementById(`${prefix}-elapsed`);
        if (el) el.textContent = formatElapsed(elapsedMs);
        _updateRate(prefix, elapsedMs);
    }

    function resumeTimerIfRunning() {
        const mode = getMode();
        if (mode === 'peppol' && STATE.isRunning && STATE.peppolStartTime) _startTimerInterval();
        else if (mode === 'deactivation' && STATE.deactIsRunning && STATE.deactStartTime) _startTimerInterval();
    }

    function addResult(clientNumber, resultType, message = '') {
        const results = STATE.results;
        results.push({ clientNumber, resultType, message, timestamp: new Date().toISOString() });
        STATE.results = results;
    }

    function addDeactResult(clientNumber, resultType, message = '') {
        const results = STATE.deactResults;
        results.push({ clientNumber, resultType, message, timestamp: new Date().toISOString() });
        STATE.deactResults = results;
    }

    function getResultCounts() {
        const results = STATE.results;
        return {
            total: results.length,
            success: results.filter(r => r.resultType === RESULT_TYPES.SUCCESS).length,
            successViaCbe: results.filter(r => r.resultType === RESULT_TYPES.SUCCESS_VIA_CBE).length,
            skippedNoBtw: results.filter(r => r.resultType === RESULT_TYPES.SKIPPED_NO_BTW).length,
            alreadyConnected: results.filter(r => r.resultType === RESULT_TYPES.SKIPPED_ALREADY_CONNECTED).length,
            notRegistered: results.filter(r => r.resultType === RESULT_TYPES.NOT_REGISTERED).length,
            errors: results.filter(r => r.resultType === RESULT_TYPES.ERROR).length
        };
    }

    function getDeactResultCounts() {
        const results = STATE.deactResults;
        return {
            total: results.length,
            deactivated: results.filter(r => r.resultType === DEACT_RESULT_TYPES.DEACTIVATED).length,
            skippedRecentPurchase: results.filter(r => r.resultType === DEACT_RESULT_TYPES.SKIPPED_RECENT_PURCHASE).length,
            alreadyInactive: results.filter(r => r.resultType === DEACT_RESULT_TYPES.SKIPPED_ALREADY_INACTIVE).length,
            notFound: results.filter(r => r.resultType === DEACT_RESULT_TYPES.NOT_FOUND).length,
            errors: results.filter(r => r.resultType === DEACT_RESULT_TYPES.ERROR).length
        };
    }

    function getNotRegisteredClients() {
        return STATE.results
            .filter(r => r.resultType === RESULT_TYPES.NOT_REGISTERED)
            .map(r => r.clientNumber);
    }

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
    }

    function waitForElement(selector, timeout = 10000) {
        return new Promise((resolve, reject) => {
            const existing = document.querySelector(selector);
            if (existing) return resolve(existing);
            const observer = new MutationObserver(() => {
                const el = document.querySelector(selector);
                if (el) { observer.disconnect(); resolve(el); }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => {
                observer.disconnect();
                reject(new Error(`Timeout wachten op: ${selector}`));
            }, timeout);
        });
    }

    const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

    function waitForApexReady(timeout = 15000) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const checkReady = () => {
                const loadingIndicators = document.querySelectorAll('.apex-page-loader, .u-Processing');
                const hasAnimations = typeof $ !== 'undefined' && $(':animated').length > 0;
                if (!loadingIndicators.length && !hasAnimations) { resolve(); return; }
                if (Date.now() - startTime > timeout) { resolve(); return; }
                setTimeout(checkReady, 50);
            };
            setTimeout(checkReady, 200);
        });
    }

    function getCurrentPage() {
        const url = window.location.href;
        if (url.includes(':1:') || url.includes('f?p=KLANT_KLANTEN_RS:1')) return 'search';
        if (url.includes(':100:') || url.includes('f?p=KLANT_KLANTEN_RS:100')) return 'detail';
        if (document.querySelector(CONFIG.searchInput)) return 'search';
        if (document.querySelector(CONFIG.btwField)) return 'detail';
        return 'unknown';
    }

    function getCurrentClientNumber() {
        const clients = STATE.clientList;
        const index = STATE.currentIndex;
        if (index >= clients.length) return null;
        const c = clients[index];
        return c.klantnummer || c.clientNumber || c;
    }

    function getCurrentDeactClientNumber() {
        const clients = STATE.deactClientList;
        const index = STATE.deactCurrentIndex;
        if (index >= clients.length) return null;
        const c = clients[index];
        return c.klantnummer || c.clientNumber || c;
    }

    // ─── Peppol handlers ──────────────────────────────────────────────────────
    async function handleSearchPage() {
        log('=== ZOEKPAGINA HANDLER GESTART ===');

        if (!STATE.isRunning) { log('Niet actief, afsluiten'); return; }
        if (STATE.isProcessing) { log('Al aan het verwerken, overslaan'); return; }

        STATE.isProcessing = true;

        try {
            const clients = STATE.clientList;
            const index = STATE.currentIndex;

            log(`Voortgang: ${index}/${clients.length}`);

            if (index >= clients.length) {
                STATE.isRunning = false;
                STATE.isProcessing = false;
                updateControlPanel();
                const counts = getResultCounts();
                const _pMs = getTotalElapsed(STATE.peppolStartTime, STATE.peppolElapsed);
                const _pMin = _pMs / 60000;
                const _pRate = (_pMin > 0.1 && counts.total > 0) ? (counts.total / _pMin).toFixed(1) : '—';
                alert(`Automatisering Voltooid!\n\nTotaal Verwerkt: ${counts.total}\nSuccesvol Verbonden: ${counts.success}\nVerbonden via CBE/VAT wissel: ${counts.successViaCbe}\nOvergeslagen (Geen BTW): ${counts.skippedNoBtw}\nReeds Verbonden: ${counts.alreadyConnected}\nNiet Geregistreerd in Peppol: ${counts.notRegistered}\nFouten: ${counts.errors}\n\n⏱ Looptijd: ${formatElapsed(_pMs)}\n📊 Gemiddeld: ${_pRate} klanten/min\n\nKlik op "Export klant geen Peppol" om gedetailleerde resultaten te downloaden`);
                return;
            }

            const clientNumber = getCurrentClientNumber();
            const resultsVisible = document.querySelector(CONFIG.firstResultLink);

            if (STATE.lastProcessedClient === clientNumber && resultsVisible) {
                STATE.lastProcessedClient = '';
                await delay(CONFIG.delayBeforeAlreadyVisibleClick);
                STATE.isProcessing = false;
                resultsVisible.click();
                return;
            }

            if (STATE.lastProcessedClient === clientNumber && !resultsVisible) {
                addResult(clientNumber, RESULT_TYPES.ERROR, 'Geen zoekresultaten gevonden');
                STATE.currentIndex++;
                STATE.lastProcessedClient = '';
                STATE.isProcessing = false;
                clearCbeState();
                await delay(CONFIG.delayOnNoResults);
                window.location.reload();
                return;
            }

            log(`Klant verwerken ${index + 1}/${clients.length}: ${clientNumber}`);
            STATE.lastProcessedClient = clientNumber;
            updateControlPanel();

            const searchInput = document.querySelector(CONFIG.searchInput);
            if (!searchInput) throw new Error('Zoekveld niet gevonden');

            searchInput.value = clientNumber;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));

            await delay(CONFIG.delayBeforeSearchClick);

            const searchBtn = document.querySelector(CONFIG.searchButton);
            if (!searchBtn) throw new Error('Zoekknop niet gevonden');
            searchBtn.click();

            await delay(CONFIG.delayAfterSearch);
            await waitForApexReady();

            const firstResult = await waitForElement(CONFIG.firstResultLink, 15000);
            await delay(CONFIG.delayBeforeFirstResultClick);

            STATE.isProcessing = false;
            firstResult.click();

        } catch (error) {
            log('FOUT in zoekpagina handler:', error.message);
            const clientNumber = getCurrentClientNumber();
            addResult(clientNumber, RESULT_TYPES.ERROR, `Zoekfout: ${error.message}`);
            STATE.currentIndex++;
            STATE.isProcessing = false;
            STATE.lastProcessedClient = '';
            clearCbeState();
            await delay(CONFIG.delayOnSearchError);
            window.location.reload();
        }
    }

    async function handleDetailPage() {
        log('=== DETAILPAGINA HANDLER GESTART ===');

        if (!STATE.isRunning) { log('Niet actief, afsluiten'); return; }

        // Een van de herpoging-flags actief?
        const anyRecheck = STATE.needsRecheck || STATE.needsCbeSwitch || STATE.needsCbeConnect || STATE.needsCbeRecheck;
        if (STATE.isProcessing && !anyRecheck) { log('Al aan het verwerken, overslaan'); return; }
        if (!anyRecheck) { STATE.isProcessing = true; }

        const clientNumber = getCurrentClientNumber();

        try {
            await delay(CONFIG.delayAtDetailPageStart);
            await waitForApexReady();

            const btwField = document.querySelector(CONFIG.btwField);
            if (!btwField) throw new Error('BTW veld niet gevonden');
            const btwValue = btwField.value.trim();

            if (!btwValue) {
                addResult(clientNumber, RESULT_TYPES.SKIPPED_NO_BTW, 'Geen BTW nummer aanwezig');
                STATE.currentIndex++;
                STATE.processedCount++;
                STATE.isProcessing = false;
                STATE.lastProcessedClient = '';
                clearCbeState();
                await returnToSearch();
                return;
            }

            // ── Stap 4: CBE hercontrole na tweede connect ──────────────────
            if (STATE.needsCbeRecheck) {
                log('CBE hercontrole: status controleren na tweede connect poging');
                STATE.needsCbeRecheck = false;
                await checkPeppolStatus(clientNumber, btwValue, true);
                return;
            }

            // ── Stap 3: tweede connect poging na CBE/VAT wissel ───────────
            if (STATE.needsCbeConnect) {
                log('CBE herpoging: verbindingsknop klikken na wissel');
                STATE.needsCbeConnect = false;
                await attemptPeppolConnect(clientNumber, true);
                return;
            }

            // ── Stap 2: wissel VAT/CBE en sla op ─────────────────────────
            if (STATE.needsCbeSwitch) {
                log('CBE herpoging: identifier type wisselen');
                STATE.needsCbeSwitch = false;
                await switchIdentifierTypeAndSave(clientNumber);
                return;
            }

            // ── Stap 1: normale hercontrole na eerste connect ─────────────
            if (STATE.needsRecheck) {
                log('Eerste hercontrole na connect poging');
                STATE.needsRecheck = false;
                await checkPeppolStatus(clientNumber, btwValue, false);
                return;
            }

            // ── Eerste keer: basischecks ──────────────────────────────────
            const peppolStatus = document.querySelector(CONFIG.peppolStatusField);
            if (peppolStatus && peppolStatus.textContent.trim() === 'Ja') {
                addResult(clientNumber, RESULT_TYPES.SKIPPED_ALREADY_CONNECTED, 'Al verbonden met Peppol');
                STATE.currentIndex++;
                STATE.processedCount++;
                STATE.isProcessing = false;
                STATE.lastProcessedClient = '';
                await returnToSearch();
                return;
            }

            await attemptPeppolConnect(clientNumber, false);

        } catch (error) {
            log('FOUT in detailpagina handler:', error.message);
            addResult(clientNumber, RESULT_TYPES.ERROR, `Detailpagina fout: ${error.message}`);
            STATE.currentIndex++;
            STATE.processedCount++;
            STATE.isProcessing = false;
            STATE.lastProcessedClient = '';
            clearCbeState();
            await returnToSearch();
        }
    }

    // Hulpfunctie: zorg voor telefoonnummer en klik connect
    async function attemptPeppolConnect(clientNumber, isCbeRetry) {
        log(`Connect poging voor ${clientNumber} (CBE herpoging: ${isCbeRetry})`);

        const phone1 = document.querySelector(CONFIG.phoneField1);
        const phone2 = document.querySelector(CONFIG.phoneField2);
        if (!phone1 || !phone2) throw new Error('Telefoonnummer velden niet gevonden');

        if (!phone1.value.trim() && !phone2.value.trim()) {
            log('Geen telefoonnummer, placeholder "0" invullen');
            phone1.value = '0';
            phone1.dispatchEvent(new Event('input', { bubbles: true }));
            phone1.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(CONFIG.delayBeforeConnect);
        }

        const connectBtn = document.querySelector(CONFIG.peppolConnectButton);
        if (!connectBtn) throw new Error('Peppol verbindingsknop niet gevonden');

        connectBtn.click();

        if (isCbeRetry) {
            STATE.needsCbeRecheck = true;
        } else {
            STATE.needsRecheck = true;
        }
        STATE.isProcessing = false;

        await delay(CONFIG.delayAfterConnect);
        await waitForApexReady();
        await navigateToClient(clientNumber);
    }

    // Hulpfunctie: wissel VAT/CBE identifier en sla op
    async function switchIdentifierTypeAndSave(clientNumber) {
        log(`Identifier type wisselen voor ${clientNumber}`);

        const select = document.querySelector(CONFIG.peppolIdentifierTypeField);
        if (!select) throw new Error('Identifier type dropdown niet gevonden (#P100_PEPPOL_IDENTIFIER_TYPE)');

        const currentValue = select.value;
        STATE.cbeOriginalValue = currentValue;

        // Als CBE → VAT, anders → CBE
        const newValue = currentValue === 'CBE' ? 'VAT' : 'CBE';
        log(`Wisselen van "${currentValue}" naar "${newValue}"`);

        select.value = newValue;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await delay(CONFIG.delayBeforeConnect);

        // Telefoonnummer check vóór opslaan
        const phone1 = document.querySelector(CONFIG.phoneField1);
        const phone2 = document.querySelector(CONFIG.phoneField2);
        if (phone1 && phone2 && !phone1.value.trim() && !phone2.value.trim()) {
            log('Geen telefoonnummer, placeholder "0" invullen vóór opslaan');
            phone1.value = '0';
            phone1.dispatchEvent(new Event('input', { bubbles: true }));
            phone1.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(CONFIG.delayBeforeConnect);
        }

        const saveBtn = findSaveButton();
        if (!saveBtn) throw new Error('Opslaan knop niet gevonden na identifier wissel');

        log('Opslaan na identifier wissel...');
        saveBtn.click();

        STATE.needsCbeConnect = true;
        STATE.isProcessing = false;

        await delay(CONFIG.delayAfterSave);
        await waitForApexReady();
        await navigateToClient(clientNumber);
    }

    async function checkPeppolStatus(clientNumber, btwValue, isCbeRecheck) {
        log(`=== PEPPOL STATUS CONTROLEREN (CBE herpoging: ${isCbeRecheck}) ===`);
        try {
            await delay(CONFIG.delayBetweenChecks);
            const peppolStatus = document.querySelector(CONFIG.peppolStatusField);
            const peppolMessage = document.querySelector(CONFIG.peppolMessageField);

            if (!peppolStatus) throw new Error('Peppol status veld niet gevonden');

            const statusText = peppolStatus.textContent.trim();
            const messageText = peppolMessage ? peppolMessage.textContent.trim() : '';

            if (statusText === 'Ja') {
                // Verbonden!
                if (isCbeRecheck) {
                    const switchedTo = STATE.cbeOriginalValue === 'CBE' ? 'VAT' : 'CBE';
                    addResult(clientNumber, RESULT_TYPES.SUCCESS_VIA_CBE,
                        `Verbonden via ${switchedTo} (was: ${STATE.cbeOriginalValue})`);
                } else {
                    addResult(clientNumber, RESULT_TYPES.SUCCESS, 'Verbonden met Peppol');
                }
                clearCbeState();
                STATE.currentIndex++;
                STATE.processedCount++;
                STATE.isProcessing = false;
                STATE.lastProcessedClient = '';
                await returnToSearch();

            } else if (!isCbeRecheck && CONFIG.cbeRetryEnabled) {
                // Eerste poging mislukt + CBE herpoging staat aan → wissel identifier
                log('Eerste connect mislukt, CBE/VAT wissel inschakelen');
                STATE.needsCbeSwitch = true;
                STATE.isProcessing = false;
                STATE.lastProcessedClient = '';
                await returnToSearch();

            } else {
                // Definitief niet verbonden
                const reason = isCbeRecheck
                    ? `Niet verbonden na CBE/VAT wissel (origineel: ${STATE.cbeOriginalValue})`
                    : 'Niet geregistreerd in Peppol';
                if (messageText.includes('Customer is not registered in Peppol') || isCbeRecheck) {
                    addResult(clientNumber, RESULT_TYPES.NOT_REGISTERED, `${reason} (BTW: ${btwValue})`);
                } else {
                    addResult(clientNumber, RESULT_TYPES.ERROR,
                        `Onverwachte status: ${statusText}, bericht: ${messageText}`);
                }
                clearCbeState();
                STATE.currentIndex++;
                STATE.processedCount++;
                STATE.isProcessing = false;
                STATE.lastProcessedClient = '';
                await returnToSearch();
            }

        } catch (error) {
            addResult(clientNumber, RESULT_TYPES.ERROR, `Statuscontrole mislukt: ${error.message}`);
            clearCbeState();
            STATE.currentIndex++;
            STATE.processedCount++;
            STATE.isProcessing = false;
            STATE.lastProcessedClient = '';
            await returnToSearch();
        }
    }

    // ─── Deactivatie handlers ─────────────────────────────────────────────────
    function findSaveButton() {
        const selectors = [
            'button[onclick*="UPDATE"]',
            '#B10686789654961768945',
        ];
        for (const sel of selectors) {
            const btn = document.querySelector(sel);
            if (btn) return btn;
        }
        const allButtons = document.querySelectorAll('button, input[type="button"], input[type="submit"]');
        for (const btn of allButtons) {
            const txt = (btn.textContent || btn.value || '').toLowerCase();
            if (txt.includes('bewaren') || txt.includes('opslaan') || txt.includes('save')) return btn;
        }
        return null;
    }

    async function handleDeactSearchPage() {
        log('=== DEACT ZOEKPAGINA HANDLER GESTART ===');

        if (!STATE.deactIsRunning) { log('Deactivatie niet actief, afsluiten'); return; }
        if (STATE.deactIsProcessing) { log('Al aan het verwerken, overslaan'); return; }

        STATE.deactIsProcessing = true;

        try {
            const clients = STATE.deactClientList;
            const index = STATE.deactCurrentIndex;

            log(`Deact voortgang: ${index}/${clients.length}`);

            if (index >= clients.length) {
                STATE.deactIsRunning = false;
                STATE.deactIsProcessing = false;
                updateControlPanel();
                const counts = getDeactResultCounts();
                const _dMs = getTotalElapsed(STATE.deactStartTime, STATE.deactElapsed);
                const _dMin = _dMs / 60000;
                const _dRate = (_dMin > 0.1 && counts.total > 0) ? (counts.total / _dMin).toFixed(1) : '—';
                alert(`Deactivatie Voltooid!\n\nTotaal Verwerkt: ${counts.total}\nGedeactiveerd: ${counts.deactivated}\nOvergeslagen (Recente aankoop): ${counts.skippedRecentPurchase}\nAl Inactief: ${counts.alreadyInactive}\nNiet Gevonden: ${counts.notFound}\nFouten: ${counts.errors}\n\n⏱ Looptijd: ${formatElapsed(_dMs)}\n📊 Gemiddeld: ${_dRate} klanten/min`);
                return;
            }

            const clientNumber = getCurrentDeactClientNumber();
            const resultsVisible = document.querySelector(CONFIG.firstResultLink);

            if (STATE.deactLastProcessedClient === clientNumber && resultsVisible) {
                STATE.deactLastProcessedClient = '';
                await delay(CONFIG.delayBeforeAlreadyVisibleClick);
                STATE.deactIsProcessing = false;
                resultsVisible.click();
                return;
            }

            if (STATE.deactLastProcessedClient === clientNumber && !resultsVisible) {
                addDeactResult(clientNumber, DEACT_RESULT_TYPES.NOT_FOUND, 'Geen zoekresultaten gevonden');
                STATE.deactCurrentIndex++;
                STATE.deactLastProcessedClient = '';
                STATE.deactIsProcessing = false;
                await delay(CONFIG.delayOnNoResults);
                window.location.reload();
                return;
            }

            log(`Deact klant verwerken ${index + 1}/${clients.length}: ${clientNumber}`);
            STATE.deactLastProcessedClient = clientNumber;
            updateControlPanel();

            const searchInput = document.querySelector(CONFIG.searchInput);
            if (!searchInput) throw new Error('Zoekveld niet gevonden');

            searchInput.value = clientNumber;
            searchInput.dispatchEvent(new Event('input', { bubbles: true }));
            searchInput.dispatchEvent(new Event('change', { bubbles: true }));

            await delay(CONFIG.delayBeforeSearchClick);

            const searchBtn = document.querySelector(CONFIG.searchButton);
            if (!searchBtn) throw new Error('Zoekknop niet gevonden');
            searchBtn.click();

            await delay(CONFIG.delayAfterSearch);
            await waitForApexReady();

            const firstResult = await waitForElement(CONFIG.firstResultLink, 15000);
            await delay(CONFIG.delayBeforeFirstResultClick);

            STATE.deactIsProcessing = false;
            firstResult.click();

        } catch (error) {
            log('FOUT in deact zoekpagina handler:', error.message);
            const clientNumber = getCurrentDeactClientNumber();
            addDeactResult(clientNumber, DEACT_RESULT_TYPES.ERROR, `Zoekfout: ${error.message}`);
            STATE.deactCurrentIndex++;
            STATE.deactIsProcessing = false;
            STATE.deactLastProcessedClient = '';
            await delay(CONFIG.delayOnSearchError);
            window.location.reload();
        }
    }

    async function handleDeactDetailPage() {
        log('=== DEACT DETAILPAGINA HANDLER GESTART ===');

        if (!STATE.deactIsRunning) { log('Deactivatie niet actief, afsluiten'); return; }
        if (STATE.deactIsProcessing) { log('Al aan het verwerken, overslaan'); return; }

        STATE.deactIsProcessing = true;
        const clientNumber = getCurrentDeactClientNumber();

        try {
            await delay(CONFIG.delayAtDeactDetailPageStart);
            await waitForApexReady();

            const activeCheckbox = document.querySelector(CONFIG.activeCheckbox);
            if (!activeCheckbox) throw new Error('Actief checkbox (#P100_DEACTIN) niet gevonden op detailpagina');

            // Al inactief?
            if (!activeCheckbox.checked) {
                log(`Klant ${clientNumber} is al inactief, overslaan`);
                addDeactResult(clientNumber, DEACT_RESULT_TYPES.SKIPPED_ALREADY_INACTIVE, 'Klant was al inactief');
                STATE.deactCurrentIndex++;
                STATE.deactIsProcessing = false;
                STATE.deactLastProcessedClient = '';
                await returnToSearch();
                return;
            }

            // Controleer laatste aankoopdatum
            const lastPurchaseField = document.querySelector(CONFIG.lastPurchaseDateField);
            if (lastPurchaseField) {
                const rawDate = (lastPurchaseField.value || lastPurchaseField.textContent || '').trim();
                const parsedDate = parseApexDate(rawDate);
                if (parsedDate) {
                    const cutoff = CONFIG.deactivateBefore;
                    const cutoffStr = `${cutoff.getDate().toString().padStart(2,'0')}/${(cutoff.getMonth()+1).toString().padStart(2,'0')}/${cutoff.getFullYear()}`;
                    log(`Klant ${clientNumber} - Laatste aankoop: ${rawDate}, drempel: ${cutoffStr}`);
                    if (parsedDate >= cutoff) {
                        log(`Overslaan - Laatste aankoop (${rawDate}) is ná of op drempel (${cutoffStr})`);
                        addDeactResult(clientNumber, DEACT_RESULT_TYPES.SKIPPED_RECENT_PURCHASE,
                            `Laatste aankoop ${rawDate} is ná drempel ${cutoffStr}`);
                        STATE.deactCurrentIndex++;
                        STATE.deactIsProcessing = false;
                        STATE.deactLastProcessedClient = '';
                        await returnToSearch();
                        return;
                    }
                } else {
                    log(`Kon datum niet parsen: "${rawDate}", doorgaan met deactivatie`);
                }
            } else {
                log(`Laatste aankoopdatum veld niet gevonden, datumcheck overgeslagen`);
            }

            // Telefoonnummer check vóór opslaan (vereist door APEX)
            const phone1 = document.querySelector(CONFIG.phoneField1);
            const phone2 = document.querySelector(CONFIG.phoneField2);
            if (phone1 && phone2 && !phone1.value.trim() && !phone2.value.trim()) {
                log('Geen telefoonnummer, placeholder "0" invullen');
                phone1.value = '0';
                phone1.dispatchEvent(new Event('input', { bubbles: true }));
                phone1.dispatchEvent(new Event('change', { bubbles: true }));
                await delay(CONFIG.delayAfterCheckboxClick);
            }

            // Vink "Actief" uit
            log(`Actief checkbox uitvinken voor klant ${clientNumber}`);
            activeCheckbox.click();
            await delay(CONFIG.delayAfterCheckboxClick);

            // Zorg dat de checkbox echt unchecked is
            if (activeCheckbox.checked) {
                log('Checkbox nog steeds aangevinkt na click, proberen via change event');
                activeCheckbox.checked = false;
                activeCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
                await delay(CONFIG.delayAfterCheckboxFallback);
            }

            log('Actief checkbox is nu uitgevinkt');

            const saveBtn = findSaveButton();
            if (!saveBtn) throw new Error('Opslaan knop niet gevonden. Pas findSaveButton() aan voor dit scherm.');

            log('Opslaan knop gevonden, klikken...');
            saveBtn.click();

            await delay(CONFIG.delayAfterSave);
            await waitForApexReady();

            log(`Klant ${clientNumber} succesvol gedeactiveerd`);
            addDeactResult(clientNumber, DEACT_RESULT_TYPES.DEACTIVATED, 'Actief vinkje verwijderd en opgeslagen');

            STATE.deactCurrentIndex++;
            STATE.deactIsProcessing = false;
            STATE.deactLastProcessedClient = '';
            updateControlPanel();
            await returnToSearch();

        } catch (error) {
            log('FOUT in deact detailpagina handler:', error.message);
            console.error('Volledige fout:', error);
            addDeactResult(clientNumber, DEACT_RESULT_TYPES.ERROR, `Detailfout: ${error.message}`);
            STATE.deactCurrentIndex++;
            STATE.deactIsProcessing = false;
            STATE.deactLastProcessedClient = '';
            await returnToSearch();
        }
    }

    function parseApexDate(str) {
        if (!str) return null;
        const dm = str.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
        if (dm) return new Date(parseInt(dm[3]), parseInt(dm[2]) - 1, parseInt(dm[1]));
        const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
        if (iso) return new Date(parseInt(iso[1]), parseInt(iso[2]) - 1, parseInt(iso[3]));
        const native = new Date(str);
        return isNaN(native) ? null : native;
    }

    // ─── Navigatie ────────────────────────────────────────────────────────────
    async function navigateToClient(clientNumber) {
        const match = window.location.href.match(/f\?p=\d+:\d+:(\d+)/);
        const sessionId = match ? match[1] : null;
        if (sessionId) {
            window.location.href = `https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:${sessionId}`;
        } else {
            window.location.reload();
        }
    }

    async function returnToSearch() {
        updateControlPanel();
        await delay(CONFIG.delayBeforeReturnToSearch);
        const match = window.location.href.match(/f\?p=\d+:\d+:(\d+)/);
        const sessionId = match ? match[1] : null;
        if (sessionId) {
            window.location.href = `https://rs-intratuin.axi.nl/ordsp/f?p=108011:1:${sessionId}`;
        } else {
            window.location.reload();
        }
    }

    // ─── UI – Modusselectie ────────────────────────────────────────────────────
    function createModeSelector() {
        const existing = document.getElementById('automation-mode-selector');
        if (existing) existing.remove();

        const panel = document.createElement('div');
        panel.id = 'automation-mode-selector';
        panel.style.cssText = `
            position: fixed; top: 60px; right: 10px; background: white;
            border: 2px solid #2563eb; padding: 20px; z-index: 999999;
            border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            font-family: Arial, sans-serif; min-width: 280px;
        `;
        panel.innerHTML = `
            <div style="text-align: center; margin-bottom: 15px;">
                <strong style="font-size: 15px;">🤖 Automatisering</strong><br>
                <span style="font-size: 12px; color: #6b7280;">Kies een module</span>
            </div>
            <button id="mode-peppol" style="width: 100%; padding: 12px; margin-bottom: 10px; background: #2563eb; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold;">
                📧 Peppol Verbinding
            </button>
            <button id="mode-deactivation" style="width: 100%; padding: 12px; background: #dc2626; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 13px; font-weight: bold;">
                🚫 Klant Deactivatie
            </button>
        `;
        document.body.appendChild(panel);

        document.getElementById('mode-peppol').addEventListener('click', () => {
            setMode('peppol'); panel.remove(); createControlPanel();
        });
        document.getElementById('mode-deactivation').addEventListener('click', () => {
            setMode('deactivation'); panel.remove(); createControlPanel();
        });
    }

    // ─── UI – Controlepaneel ──────────────────────────────────────────────────
    function createControlPanel() {
        const existing = document.getElementById('peppol-automation-panel');
        if (existing) existing.remove();

        const mode = getMode();
        const isPeppol = mode === 'peppol';
        const counts = isPeppol ? getResultCounts() : getDeactResultCounts();

        const panel = document.createElement('div');
        panel.id = 'peppol-automation-panel';
        panel.style.cssText = `
            position: fixed;
            top: ${GM_getValue('peppol_panel_top', '60')}px;
            left: ${GM_getValue('peppol_panel_left', '') ? GM_getValue('peppol_panel_left', '') + 'px' : 'auto'};
            right: ${GM_getValue('peppol_panel_left', '') ? 'auto' : '10px'};
            background: white;
            border: 2px solid ${isPeppol ? '#2563eb' : '#dc2626'};
            padding: 15px; z-index: 999999; border-radius: 8px;
            box-shadow: 0 4px 15px rgba(0,0,0,0.3);
            font-family: Arial, sans-serif; min-width: 320px; max-width: 400px;
            max-height: 90vh; overflow-y: auto; cursor: move;
        `;

        if (isPeppol) {
            panel.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="font-size: 14px;">📧 Peppol Verbinding</strong>
                    <button id="btn-switch-mode" title="Wissel module" style="background: none; border: 1px solid #9ca3af; border-radius: 4px; cursor: pointer; font-size: 11px; padding: 2px 6px; color: #6b7280;">⇄ Wissel</button>
                </div>
                <div style="margin-bottom: 10px; font-size: 13px;">
                    <strong>Voortgang:</strong> <span id="peppol-progress">0/0</span><br>
                    <div style="margin-top: 5px;">
                        <progress id="peppol-progressbar" value="0" max="100" style="width: 100%; height: 20px;"></progress>
                    </div>
                </div>
                <div style="margin-bottom: 10px; font-size: 12px; line-height: 1.6;">
                    <strong style="color: #16a34a;">Verbonden:</strong> <span id="peppol-success">${counts.success}</span><br>
                    <strong style="color: #15803d;">Verbonden via CBE/VAT wissel:</strong> <span id="peppol-success-cbe">${counts.successViaCbe}</span><br>
                    <strong style="color: #9ca3af;">Geen zakelijke klant:</strong> <span id="peppol-skipped-btw">${counts.skippedNoBtw}</span><br>
                    <strong style="color: #9ca3af;">Reeds verbonden:</strong> <span id="peppol-skipped-connected">${counts.alreadyConnected}</span><br>
                    <strong style="color: #f59e0b;">Klant geen Peppol:</strong> <span id="peppol-not-registered">${counts.notRegistered}</span><br>
                    <strong style="color: #dc2626;">Fouten:</strong> <span id="peppol-errors">${counts.errors}</span><br>
                    <hr style="margin: 8px 0;">
                    <strong>Status:</strong> <span id="peppol-status">Inactief</span>
                    <hr style="margin: 8px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px;">
                        <span>⏱ <strong id="peppol-elapsed">00:00</strong></span>
                        <span style="color: #6b7280; font-size: 11px;"><strong id="peppol-rate">—</strong> klanten/min</span>
                    </div>
                </div>
                <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 5px;">
                    <button id="peppol-toggle" style="flex: 1; padding: 8px; background: #16a34a; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">▶ Start</button>
                </div>
                <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 8px;">
                    <button id="peppol-reset" style="flex: 1; padding: 6px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">🔄 Alles Resetten</button>
                    <button id="peppol-export" style="flex: 1; padding: 6px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">📥 Export geen Peppol (JSON)</button>
                </div>
                <div style="margin-bottom: 10px; padding: 8px; background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 4px; font-size: 12px;">
                    <label style="display: flex; align-items: center; gap: 6px; cursor: pointer;">
                        <input type="checkbox" id="peppol-cbe-retry" ${CONFIG.cbeRetryEnabled ? 'checked' : ''} style="cursor: pointer; width: 14px; height: 14px;">
                        <span style="font-weight: bold;">🔄 CBE/VAT herpoging bij mislukking</span>
                    </label>
                    <div style="color: #6b7280; font-size: 11px; margin-top: 3px; padding-left: 20px;">Wisselt identifier type als eerste connect mislukt (~4 extra paginalaadtijden per klant)</div>
                </div>
                <details style="margin-bottom: 10px;">
                    <summary style="cursor: pointer; font-weight: bold; font-size: 12px; margin-bottom: 5px;">📋 Laad Klantenlijst</summary>
                    <textarea id="peppol-json-input" placeholder='[12345, 67890]' style="width: 100%; height: 100px; font-size: 11px; padding: 5px; margin-top: 5px; font-family: monospace; box-sizing: border-box;"></textarea>
                    <button id="peppol-load" style="width: 100%; padding: 6px; background: #2563eb; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 5px; font-size: 11px;">📁 Laad JSON</button>
                </details>
                <details>
                    <summary style="cursor: pointer; font-weight: bold; font-size: 12px;">📊 Niet Geregistreerd Lijst</summary>
                    <div id="peppol-not-reg-list" style="margin-top: 5px; font-size: 11px; max-height: 150px; overflow-y: auto; background: #f3f4f6; padding: 8px; border-radius: 4px;">
                        <em style="color: #6b7280;">Nog geen data</em>
                    </div>
                </details>
            `;
        } else {
            panel.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                    <strong style="font-size: 14px;">🚫 Klant Deactivatie</strong>
                    <button id="btn-switch-mode" title="Wissel module" style="background: none; border: 1px solid #9ca3af; border-radius: 4px; cursor: pointer; font-size: 11px; padding: 2px 6px; color: #6b7280;">⇄ Wissel</button>
                </div>
                <div style="margin-bottom: 10px; font-size: 13px;">
                    <strong>Voortgang:</strong> <span id="deact-progress">0/0</span><br>
                    <div style="margin-top: 5px;">
                        <progress id="deact-progressbar" value="0" max="100" style="width: 100%; height: 20px;"></progress>
                    </div>
                </div>
                <div style="margin-bottom: 10px; font-size: 12px; line-height: 1.6;">
                    <strong style="color: #16a34a;">Gedeactiveerd:</strong> <span id="deact-success">${counts.deactivated}</span><br>
                    <strong style="color: #f59e0b;">Recente aankoop (overgeslagen):</strong> <span id="deact-skipped-purchase">${counts.skippedRecentPurchase}</span><br>
                    <strong style="color: #9ca3af;">Al inactief:</strong> <span id="deact-already-inactive">${counts.alreadyInactive}</span><br>
                    <strong style="color: #9ca3af;">Niet gevonden:</strong> <span id="deact-not-found">${counts.notFound}</span><br>
                    <strong style="color: #dc2626;">Fouten:</strong> <span id="deact-errors">${counts.errors}</span><br>
                    <hr style="margin: 8px 0;">
                    <strong>Status:</strong> <span id="deact-status">Inactief</span>
                    <hr style="margin: 8px 0;">
                    <div style="display: flex; justify-content: space-between; align-items: center; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 6px 8px;">
                        <span>⏱ <strong id="deact-elapsed">00:00</strong></span>
                        <span style="color: #6b7280; font-size: 11px;"><strong id="deact-rate">—</strong> klanten/min</span>
                    </div>
                </div>
                <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 5px;">
                    <button id="deact-toggle" style="flex: 1; padding: 8px; background: #16a34a; color: white; border: none; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 12px;">▶ Start</button>
                </div>
                <div style="display: flex; gap: 5px; flex-wrap: wrap; margin-bottom: 10px;">
                    <button id="deact-reset" style="flex: 1; padding: 6px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 11px;">🔄 Alles Resetten</button>
                </div>
                <details style="margin-bottom: 10px;">
                    <summary style="cursor: pointer; font-weight: bold; font-size: 12px; margin-bottom: 5px;">📋 Laad Klantenlijst</summary>
                    <textarea id="deact-json-input" placeholder='[12345, 67890]' style="width: 100%; height: 100px; font-size: 11px; padding: 5px; margin-top: 5px; font-family: monospace; box-sizing: border-box;"></textarea>
                    <button id="deact-load" style="width: 100%; padding: 6px; background: #dc2626; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 5px; font-size: 11px;">📁 Laad JSON</button>
                </details>
                <details>
                    <summary style="cursor: pointer; font-weight: bold; font-size: 12px;">📋 Verwerkte klanten</summary>
                    <div id="deact-result-list" style="margin-top: 5px; font-size: 11px; max-height: 150px; overflow-y: auto; background: #f3f4f6; padding: 8px; border-radius: 4px;">
                        <em style="color: #6b7280;">Nog geen data</em>
                    </div>
                </details>
            `;
        }

        document.body.appendChild(panel);
        makeDraggable(panel);
        attachPanelListeners(isPeppol);
        updateControlPanel();
    }

    function makeDraggable(panel) {
        let pos1 = 0, pos2 = 0, pos3 = 0, pos4 = 0;
        panel.onmousedown = dragMouseDown;

        function dragMouseDown(e) {
            if (['BUTTON','TEXTAREA','INPUT','SUMMARY','A'].includes(e.target.tagName)) return;
            e.preventDefault();
            pos3 = e.clientX; pos4 = e.clientY;
            document.onmouseup = closeDragElement;
            document.onmousemove = elementDrag;
        }
        function elementDrag(e) {
            e.preventDefault();
            pos1 = pos3 - e.clientX; pos2 = pos4 - e.clientY;
            pos3 = e.clientX; pos4 = e.clientY;
            panel.style.top = (panel.offsetTop - pos2) + 'px';
            panel.style.left = (panel.offsetLeft - pos1) + 'px';
            panel.style.right = 'auto';
        }
        function closeDragElement() {
            document.onmouseup = null; document.onmousemove = null;
            GM_setValue('peppol_panel_top', panel.offsetTop);
            GM_setValue('peppol_panel_left', panel.offsetLeft);
        }
    }

    // ─── Update controlepaneel ────────────────────────────────────────────────
    function updateControlPanel() {
        const mode = getMode();
        if (!mode) return;

        if (mode === 'peppol') {
            const clients = STATE.clientList;
            const index = STATE.currentIndex;
            const counts = getResultCounts();

            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            set('peppol-progress', `${index}/${clients.length}`);
            set('peppol-success', counts.success);
            set('peppol-success-cbe', counts.successViaCbe);
            set('peppol-skipped-btw', counts.skippedNoBtw);
            set('peppol-skipped-connected', counts.alreadyConnected);
            set('peppol-not-registered', counts.notRegistered);
            set('peppol-errors', counts.errors);
            set('peppol-status', STATE.isRunning ? '🟢 Actief' : '⚪ Gepauzeerd');

            const toggleBtn = document.getElementById('peppol-toggle');
            if (toggleBtn) {
                toggleBtn.textContent = STATE.isRunning ? '⏸ Pauzeer' : '▶ Start';
                toggleBtn.style.background = STATE.isRunning ? '#f59e0b' : '#16a34a';
            }

            const progressBar = document.getElementById('peppol-progressbar');
            if (progressBar && clients.length > 0) progressBar.value = (index / clients.length) * 100;

            // Sync CBE checkbox met CONFIG
            const cbeCheckbox = document.getElementById('peppol-cbe-retry');
            if (cbeCheckbox) cbeCheckbox.checked = CONFIG.cbeRetryEnabled;

            // Timer display
            renderTimerDisplay('peppol', getTotalElapsed(STATE.peppolStartTime, STATE.peppolElapsed));

            const notRegList = document.getElementById('peppol-not-reg-list');
            if (notRegList) {
                const notRegistered = getNotRegisteredClients();
                notRegList.innerHTML = notRegistered.length > 0
                    ? notRegistered.map(num => `<div style="padding: 2px 0;">${num}</div>`).join('')
                    : '<em style="color: #6b7280;">Nog geen niet-geregistreerde klanten</em>';
            }

        } else {
            const clients = STATE.deactClientList;
            const index = STATE.deactCurrentIndex;
            const counts = getDeactResultCounts();

            const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
            set('deact-progress', `${index}/${clients.length}`);
            set('deact-success', counts.deactivated);
            set('deact-skipped-purchase', counts.skippedRecentPurchase);
            set('deact-already-inactive', counts.alreadyInactive);
            set('deact-not-found', counts.notFound);
            set('deact-errors', counts.errors);
            set('deact-status', STATE.deactIsRunning ? '🟢 Actief' : '⚪ Gepauzeerd');

            const toggleBtn = document.getElementById('deact-toggle');
            if (toggleBtn) {
                toggleBtn.textContent = STATE.deactIsRunning ? '⏸ Pauzeer' : '▶ Start';
                toggleBtn.style.background = STATE.deactIsRunning ? '#f59e0b' : '#16a34a';
            }

            const progressBar = document.getElementById('deact-progressbar');
            if (progressBar && clients.length > 0) progressBar.value = (index / clients.length) * 100;

            // Timer display
            renderTimerDisplay('deact', getTotalElapsed(STATE.deactStartTime, STATE.deactElapsed));

            const resultList = document.getElementById('deact-result-list');
            if (resultList) {
                const results = STATE.deactResults;
                if (results.length > 0) {
                    resultList.innerHTML = results.slice(-50).reverse().map(r => {
                        const color = r.resultType === DEACT_RESULT_TYPES.DEACTIVATED ? '#16a34a'
                            : r.resultType === DEACT_RESULT_TYPES.ERROR ? '#dc2626' : '#6b7280';
                        return `<div style="padding: 2px 0; color: ${color};">${r.clientNumber}: ${r.resultType}</div>`;
                    }).join('');
                } else {
                    resultList.innerHTML = '<em style="color: #6b7280;">Nog geen data</em>';
                }
            }
        }
    }

    // ─── Event listeners ──────────────────────────────────────────────────────
    function attachPanelListeners(isPeppol) {
        const switchBtn = document.getElementById('btn-switch-mode');
        if (switchBtn) {
            switchBtn.addEventListener('click', () => {
                STATE.isRunning = false; STATE.isProcessing = false;
                STATE.deactIsRunning = false; STATE.deactIsProcessing = false;
                setMode(null);
                const panel = document.getElementById('peppol-automation-panel');
                if (panel) panel.remove();
                createModeSelector();
            });
        }

        if (isPeppol) {
            document.getElementById('peppol-toggle').addEventListener('click', async () => {
                if (STATE.isRunning) {
                    STATE.isRunning = false; STATE.isProcessing = false;
                    clearCbeState(); STATE.lastProcessedClient = '';
                    pauseTimer(true);
                    updateControlPanel();
                } else {
                    if (STATE.clientList.length === 0) { alert('Eerst een klantenlijst laden, aub :-)'); return; }
                    STATE.isRunning = true; STATE.isProcessing = false;
                    STATE.lastProcessedClient = '';
                    startTimer(true);
                    updateControlPanel();
                    const page = getCurrentPage();
                    if (page === 'search') await handleSearchPage();
                    else if (page === 'detail') await handleDetailPage();
                    else alert('Navigeer eerst naar de zoekpagina');
                }
            });

            document.getElementById('peppol-reset').addEventListener('click', () => {
                if (confirm('Alles resetten? Dit kan niet ongedaan worden gemaakt!')) {
                    STATE.currentIndex = 0; STATE.processedCount = 0;
                    STATE.results = []; STATE.clientList = [];
                    STATE.isRunning = false; STATE.isProcessing = false;
                    STATE.lastProcessedClient = '';
                    clearCbeState();
                    resetTimer(true);
                    const jsonInput = document.getElementById('peppol-json-input');
                    if (jsonInput) jsonInput.value = '';
                    updateControlPanel();
                    alert('Alles gereset.');
                }
            });

            document.getElementById('peppol-load').addEventListener('click', () => {
                const jsonText = document.getElementById('peppol-json-input').value.trim();
                if (!jsonText) { alert('Plak JSON in het tekstveld'); return; }
                try {
                    const data = JSON.parse(jsonText);
                    const clients = Array.isArray(data) ? data : [data];
                    if (clients.length === 0) { alert('JSON array is leeg'); return; }
                    STATE.clientList = clients; STATE.currentIndex = 0; STATE.results = [];
                    alert(`${clients.length} klanten geladen`);
                    updateControlPanel();
                } catch(e) { alert('Ongeldig JSON formaat: ' + e.message); }
            });

            document.getElementById('peppol-export').addEventListener('click', exportNotRegisteredToJSON);

            document.getElementById('peppol-cbe-retry').addEventListener('change', (e) => {
                CONFIG.cbeRetryEnabled = e.target.checked;
                log(`CBE herpoging ${CONFIG.cbeRetryEnabled ? 'ingeschakeld' : 'uitgeschakeld'} (opgeslagen)`);
            });

        } else {
            document.getElementById('deact-toggle').addEventListener('click', async () => {
                if (STATE.deactIsRunning) {
                    STATE.deactIsRunning = false; STATE.deactIsProcessing = false;
                    STATE.deactLastProcessedClient = '';
                    pauseTimer(false);
                    updateControlPanel();
                } else {
                    if (STATE.deactClientList.length === 0) { alert('Eerst een klantenlijst laden, aub :-)'); return; }
                    STATE.deactIsRunning = true; STATE.deactIsProcessing = false;
                    STATE.deactLastProcessedClient = '';
                    startTimer(false);
                    updateControlPanel();
                    const page = getCurrentPage();
                    if (page === 'search') await handleDeactSearchPage();
                    else if (page === 'detail') await handleDeactDetailPage();
                    else alert('Navigeer eerst naar de zoekpagina');
                }
            });

            document.getElementById('deact-reset').addEventListener('click', () => {
                if (confirm('Alle deactivatie data resetten? Dit kan niet ongedaan worden gemaakt!')) {
                    STATE.deactCurrentIndex = 0; STATE.deactResults = [];
                    STATE.deactClientList = []; STATE.deactIsRunning = false;
                    STATE.deactIsProcessing = false; STATE.deactLastProcessedClient = '';
                    resetTimer(false);
                    const jsonInput = document.getElementById('deact-json-input');
                    if (jsonInput) jsonInput.value = '';
                    updateControlPanel();
                    alert('Deactivatie data gereset.');
                }
            });

            document.getElementById('deact-load').addEventListener('click', () => {
                const jsonText = document.getElementById('deact-json-input').value.trim();
                if (!jsonText) { alert('Plak JSON in het tekstveld'); return; }
                try {
                    const data = JSON.parse(jsonText);
                    const clients = Array.isArray(data) ? data : [data];
                    if (clients.length === 0) { alert('JSON array is leeg'); return; }
                    STATE.deactClientList = clients; STATE.deactCurrentIndex = 0; STATE.deactResults = [];
                    alert(`${clients.length} klanten geladen`);
                    updateControlPanel();
                } catch(e) { alert('Ongeldig JSON formaat: ' + e.message); }
            });
        }
    }

    // ─── Initialisatie ────────────────────────────────────────────────────────
    function init() {
        log('='.repeat(50));
        log('Automatisering v4.1 Initialiseren');
        log(`Huidige URL: ${window.location.href}`);
        log(`Pagina: ${getCurrentPage()}, Modus: ${getMode()}`);

        STATE.isProcessing = false;
        STATE.deactIsProcessing = false;
        checkAndClearStaleLock();

        const mode = getMode();

        if (!mode) {
            if (!document.getElementById('automation-mode-selector')) createModeSelector();
            return;
        }

        if (!document.getElementById('peppol-automation-panel')) createControlPanel();

        const page = getCurrentPage();

        if (mode === 'peppol' && STATE.isRunning && !STATE.isProcessing) {
            log(`Peppol voortzetten op ${page} pagina`);
            if (page === 'search') setTimeout(() => handleSearchPage(), CONFIG.delayOnInit);
            else if (page === 'detail') setTimeout(() => handleDetailPage(), CONFIG.delayOnInit);
        }

        if (mode === 'deactivation' && STATE.deactIsRunning && !STATE.deactIsProcessing) {
            log(`Deactivatie voortzetten op ${page} pagina`);
            if (page === 'search') setTimeout(() => handleDeactSearchPage(), CONFIG.delayOnInit);
            else if (page === 'detail') setTimeout(() => handleDeactDetailPage(), CONFIG.delayOnInit);
        }

        resumeTimerIfRunning();
        log('='.repeat(50));
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 1500);
    }
})();