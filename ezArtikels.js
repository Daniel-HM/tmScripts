// ==UserScript==
// @name         Artikelen Barcode Viewer
// @namespace    ITM
// @version      0.2
// @description  Toggle visual barcodes for EAN13 codes
// @author       Daniël
// @downloadURL  https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/artikelenBarcode.js
// @updateURL    https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/artikelenBarcode.js
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=109011*
// @match        file:///C:/Users/d/Desktop/Tampermonkey/artikels%20zoeken%20pagina/Artikelen.html
// @icon         https://www.google.com/s2/favicons?sz=64&domain=undefined.
// @require      https://code.jquery.com/jquery-3.6.3.min.js
// @require      https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js
// @grant        none
// ==/UserScript==
/* global $ JsBarcode */

(function() {
    'use strict';

    // Verify we're on the correct page
    function isCorrectPage() {
        var h1 = $("h1.t-Breadcrumb-label");

        if (h1.length === 0) {
            console.log('Barcode Script: H1 not found');
            return false;
        }

        var h1Text = h1.text().trim();

        if (h1Text !== "Artikelen") {
            console.log('Barcode Script: Not on Artikelen page');
            return false;
        }

        console.log('Barcode Script: Page verification passed');
        return true;
    }

    // Only proceed if we're on the correct page
    if (!isCorrectPage()) {
        return;
    }

    // State variable
    var barcodesVisible = false;
    var originalBarcodes = {};

    // Create toggle switch in table header
    function createToggleSwitch() {
        var barcodeHeader = $('th.t-Report-colHead[id="HOOFDBARCODE"]');

        if (barcodeHeader.length === 0) {
            console.error('Barcode Script: Barcode header not found');
            return;
        }

        // Create switch HTML
        var switchHtml = `
            <label style="display: inline-flex; align-items: center; margin-left: 8px; cursor: pointer;">
                <input type="checkbox" id="barcodeToggle" style="margin-right: 5px;">
            </label>
        `;

        barcodeHeader.append(switchHtml);

        $('#barcodeToggle').on('change', function() {
            toggleBarcodes();
        });
    }

    // Toggle barcode visibility
    function toggleBarcodes() {
        barcodesVisible = !barcodesVisible;

        if (barcodesVisible) {
            showBarcodes();
        } else {
            hideBarcodes();
        }
    }

    // Show barcodes
    function showBarcodes() {
        $('td.t-Report-cell[headers="HOOFDBARCODE"]').each(function() {
            var cell = $(this);
            var eanCode = cell.text().trim();

            // Validate EAN13 (should be 13 digits)
            if (eanCode.length !== 13 || !/^\d+$/.test(eanCode)) {
                return;
            }

            // Store original content if not already stored
            if (!originalBarcodes[eanCode]) {
                originalBarcodes[eanCode] = cell.html();
            }

            // Create SVG element
            var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
            svg.setAttribute('id', 'barcode-' + eanCode);

            // Clear cell and add SVG
            cell.empty();
            cell.append(svg);

            // Generate barcode
            try {
                JsBarcode(svg, eanCode, {
                    format: "EAN13",
                    width: 2,
                    height: 20,
                    displayValue: true,
                    fontSize: 12,
                    margin: 5
                });
            } catch (e) {
                console.error('Error generating barcode for:', eanCode, e);
                cell.html(originalBarcodes[eanCode]);
            }
        });
    }

    // Hide barcodes
    function hideBarcodes() {
        $('td.t-Report-cell[headers="HOOFDBARCODE"]').each(function() {
            var cell = $(this);
            var eanCode = cell.text().trim();

            // If we don't have the EAN from text, try to get it from the SVG
            if (!eanCode || eanCode.length !== 13) {
                var svg = cell.find('svg');
                if (svg.length > 0) {
                    var svgId = svg.attr('id');
                    if (svgId && svgId.startsWith('barcode-')) {
                        eanCode = svgId.replace('barcode-', '');
                    }
                }
            }

            // Restore original content
            if (originalBarcodes[eanCode]) {
                cell.html(originalBarcodes[eanCode]);
            }
        });
    }

    // Initialize
    console.log('Barcode Script: Initializing');
    createToggleSwitch();
})();