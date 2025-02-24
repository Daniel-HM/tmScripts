// ==UserScript==
// @name         Intratuin Pagination Extender
// @namespace    http://tampermonkey.net/
// @version      1.0
// @description  Meer dan 50 rijen? Yes, please!
// @author       You
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=186981:50:*
// @grant        none
// ==/UserScript==

(function() {
    'use strict';

    // Wait for the page to fully load
    window.addEventListener('load', function() {
        // Function to modify pagination settings
        function modifyPagination() {
            // Try to intercept and modify the pagination settings
            if (typeof apex !== 'undefined' && apex.widget && apex.widget.report) {
                // Store the original paginate function
                const originalPaginate = apex.widget.report.paginate;

                // Override the paginate function
                apex.widget.report.paginate = function(regionId, ajaxId, pagination) {
                    // Modify the pagination to show more rows
                    if (pagination && pagination.max) {
                        // Change 200 to your desired number of rows per page
                        pagination.max = 200;
                    }

                    // Call the original function with modified parameters
                    return originalPaginate.call(this, regionId, ajaxId, pagination);
                };

                // Find the report region ID
                const reportRegionId = document.querySelector('.t-Report').closest('[id^="report_"]').id.replace('report_', '');

                // Force refresh the current page with more rows
                if (reportRegionId) {
                    // Wait a moment to ensure page is ready
                    setTimeout(function() {
                        // Get current page state
                        const currentState = apex.widget.report.getState(reportRegionId);

                        // Request more rows
                        apex.widget.report.widget(reportRegionId, {
                            pageSize: 200 // Change to your desired number of rows
                        });
                    }, 1000);
                }
            }
        }

        // First attempt at modification
        modifyPagination();

        // Alternative approach: intercept the AJAX requests
        if (typeof XMLHttpRequest !== 'undefined') {
            const originalOpen = XMLHttpRequest.prototype.open;

            XMLHttpRequest.prototype.open = function() {
                this.addEventListener('readystatechange', function() {
                    if (this.readyState === 4) {
                        // After any AJAX request completes, try to modify pagination again
                        setTimeout(modifyPagination, 500);
                    }
                });

                // Call the original function
                return originalOpen.apply(this, arguments);
            };
        }

        // Add a button to manually trigger showing more rows
        const button = document.createElement('button');
        button.innerHTML = 'Show More Rows';
        button.className = 't-Button t-Button--hot';
        button.style.position = 'fixed';
        button.style.bottom = '20px';
        button.style.right = '20px';
        button.style.zIndex = '1000';

        button.addEventListener('click', function() {
            // Get the report widget and try to modify directly
            const reportElements = document.querySelectorAll('.t-Report');
            if (reportElements.length > 0) {
                const reportElement = reportElements[0];
                const regionId = reportElement.closest('[id^="report_"]').id.replace('report_', '');

                if (regionId && apex.widget.report) {
                    // Try to modify the pagination through the API
                    apex.widget.report.widget(regionId, {
                        pageSize: 200  // Change to your desired number of rows
                    });

                    // Also try refreshing with more rows
                    const ajaxIdentifier = reportElement.querySelector('a[href*="apex.widget.report.paginate"]');
                    if (ajaxIdentifier) {
                        // Extract AJAX identifier from the link
                        const href = ajaxIdentifier.getAttribute('href');
                        const match = href.match(/apex\.widget\.report\.paginate\('([^']+)',\s*'([^']+)',/);

                        if (match && match.length >= 3) {
                            const reportId = match[1];
                            const ajaxId = match[2];

                            // Request next page with more rows
                            apex.widget.report.paginate(reportId, ajaxId, {
                                min: 1,
                                max: 200  // Change to your desired number of rows
                            });
                        }
                    }
                }
            }
        });

        document.body.appendChild(button);
    });
})();