// ==UserScript==
// @name         Weekomzet
// @namespace    ITM
// @version      0.6
// @description  Weekomzet vergelijken met vorig jaar
// @author       Daniël
// @downloadURL     https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/pbVerwerken.js
// @updateURL     https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/pbVerwerken.js
// @match        file:///C:/Users/d/Desktop/Tampermonkey/paginas/Omzet%201%20pagina/Verkoopresultaten.html
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=104011:2:9738124763909*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=undefined.
// @require      https://code.jquery.com/jquery-3.6.3.min.js
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.setValue
// @grant        GM.getValue
// ==/UserScript==
/* global $ */

(function() {
    'use strict';

    var headingElement = document.getElementById("verkoopresultaten_heading");
    var omzetContainer = document.createElement('span');
    var omzetDisplay = document.createElement('span');
    var omzetField = document.createElement('input');
    var omzetButton = document.createElement('button');
    var differenceDisplay = document.createElement('span');
    var weekNumber = getISOWeekNumber();
    var previousYear = getPreviousYear() - 1; // Last year

    // Storage key based on week and year
    var storageKey = `omzet_week_${weekNumber}_${previousYear}`;

    // Make the heading element flex to align items
    headingElement.style.display = 'flex';
    headingElement.style.alignItems = 'center';
    headingElement.style.gap = '20px';
    headingElement.style.flexWrap = 'wrap';

    // Container styling - inline span
    omzetContainer.setAttribute('style', `
        display: none;
        margin-left: auto;
        padding: 10px 15px;
        background: #f0f9ff;
        border-radius: 8px;
        border-left: 4px solid #0ea5e9;
        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        align-items: center;
        gap: 12px;
    `);
    omzetContainer.setAttribute('id', 'omzetContainer');

    // Display styling
    omzetDisplay.setAttribute('style', `
        font-weight: 600;
        color: #0369a1;
        font-size: 13px;
        white-space: nowrap;
    `);

    // Get saved value
    var savedOmzet = GM_getValue(storageKey, '');
    var displayValue = savedOmzet || 'nog niet ingesteld';

    omzetDisplay.innerHTML = `Omzet week ${weekNumber} - ${previousYear}: €${displayValue}`;

    // Input field styling
    omzetField.setAttribute('type', 'text');
    omzetField.setAttribute('placeholder', 'Voer omzet vorig jaar in');
    omzetField.setAttribute('class', 'text_field apex-item-text');
    omzetField.setAttribute('style', `
        padding: 6px 10px;
        border: 2px solid #cbd5e1;
        border-radius: 6px;
        font-size: 13px;
        width: 130px;
        transition: border-color 0.2s;
    `);
    omzetField.value = savedOmzet;

    // Button styling
    omzetButton.setAttribute("type", "button");
    omzetButton.setAttribute("class", "t-Button t-Button--icon t-Button--iconLeft t-Button--hot");
    omzetButton.setAttribute('style', `
        padding: 6px 12px;
        background: #0ea5e9;
        color: white;
        border: none;
        border-radius: 6px;
        cursor: pointer;
        font-weight: 600;
        font-size: 13px;
        transition: background 0.2s;
        white-space: nowrap;
    `);
    omzetButton.innerHTML = "💾 Opslaan";

    // Difference display styling - inline
    differenceDisplay.setAttribute('style', `
        padding: 6px 10px;
        background: white;
        border-radius: 6px;
        font-size: 13px;
        display: none;
        white-space: nowrap;
    `);
    differenceDisplay.setAttribute('id', 'differenceDisplay');

    // Button click handler
    omzetButton.addEventListener('click', function() {
        var value = omzetField.value.trim();

        if (value) {
            GM_setValue(storageKey, value);
            omzetDisplay.innerHTML = `Omzet week ${weekNumber} - ${previousYear}: €${value}`;
            calculateDifference(value);

            // Visual feedback
            omzetButton.innerHTML = "✓ Opgeslagen!";
            omzetButton.style.background = "#10b981";

            setTimeout(function() {
                omzetButton.innerHTML = "💾 Opslaan";
                omzetButton.style.background = "#0ea5e9";
            }, 2000);
        }
    });

    // Focus styling
    omzetField.addEventListener('focus', function() {
        this.style.borderColor = '#0ea5e9';
    });

    omzetField.addEventListener('blur', function() {
        this.style.borderColor = '#cbd5e1';
    });

    // Parse Euro amount (handles "€8.254,16" format)
    function parseEuroAmount(str) {
        if (!str) return 0;
        // Remove € symbol, dots (thousand separators), replace comma with dot
        var cleaned = str.replace(/€/g, '').replace(/\./g, '').replace(',', '.').trim();
        return parseFloat(cleaned) || 0;
    }

    // Format number as Euro
    function formatEuro(num) {
        return num.toLocaleString('nl-NL', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
    }

    // Calculate and display difference - inline version
    function calculateDifference(savedValue) {
        // Find current week's total
        var totalCells = document.querySelectorAll('td[headers="OMZET_EXCLUSIEF"]');
        var currentWeekTotal = 0;

        // Last cell contains the total (in <strong> tag)
        if (totalCells.length > 0) {
            var totalCell = totalCells[totalCells.length - 1];
            var strongTag = totalCell.querySelector('strong');
            if (strongTag) {
                currentWeekTotal = parseEuroAmount(strongTag.textContent);
            }
        }

        var previousYearTotal = parseEuroAmount(savedValue);
        var difference = currentWeekTotal - previousYearTotal;
        var percentageChange = previousYearTotal !== 0
            ? ((difference / previousYearTotal) * 100).toFixed(1)
            : 0;

        var arrow = difference >= 0 ? '📈' : '📉';
        var color = difference >= 0 ? '#10b981' : '#ef4444';
        var sign = difference >= 0 ? '+' : '';

        // Compact inline display
        differenceDisplay.innerHTML = `
            <strong>Deze week:</strong> €${formatEuro(currentWeekTotal)} | 
            <strong style="color: ${color};">
                ${arrow} ${sign}€${formatEuro(Math.abs(difference))} (${sign}${percentageChange}%)
            </strong>
        `;
        differenceDisplay.style.display = 'inline-block';
    }

    // Check if heading contains date range (week view)
    function isWeekView() {
        var headingText = headingElement.textContent.trim();
        // Check if heading contains a date range pattern like "18-01-2023 - 24-01-2023"
        // Pattern: DD-MM-YYYY - DD-MM-YYYY or DD-MM-YYYY-DD-MM-YYYY
        var dateRangePattern = /\d{2}-\d{2}-\d{4}\s*-\s*\d{2}-\d{2}-\d{4}/;
        return dateRangePattern.test(headingText);
    }

    // Assemble everything
    omzetContainer.appendChild(omzetDisplay);
    omzetContainer.appendChild(omzetField);
    omzetContainer.appendChild(omzetButton);
    omzetContainer.appendChild(differenceDisplay);

    headingElement.appendChild(omzetContainer);

    // Show/hide based on heading content
    function updateVisibility() {
        if (isWeekView()) {
            omzetContainer.style.display = 'inline-flex';
            // If there's a saved value, calculate difference immediately
            if (savedOmzet) {
                calculateDifference(savedOmzet);
            }
        } else {
            omzetContainer.style.display = 'none';
        }
    }

    // Check initial state
    updateVisibility();

    // Watch for changes to the heading text (when search results update)
    var headingObserver = new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === 'childList' || mutation.type === 'characterData') {
                updateVisibility();
            }
        });
    });

    // Observe the heading for text changes
    headingObserver.observe(headingElement, {
        childList: true,
        characterData: true,
        subtree: true
    });

    // Also listen for when the search button is clicked
    var searchButton = document.getElementById('B12672992078933077063');
    if (searchButton) {
        searchButton.addEventListener('click', function() {
            // Wait a bit for the page to update, then check visibility
            setTimeout(updateVisibility, 500);
        });
    }

    // Helper functions
    function getISOWeekNumber(date = new Date()) {
        const target = new Date(date.valueOf());
        const dayNumber = (date.getDay() + 6) % 7;
        target.setDate(target.getDate() - dayNumber + 3);
        const firstThursday = target.valueOf();
        target.setMonth(0, 1);
        if (target.getDay() !== 4) {
            target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
        }
        return 1 + Math.ceil((firstThursday - target) / 604800000);
    }

    function getPreviousYear(date = new Date()) {
        return date.getFullYear();
    }

})();