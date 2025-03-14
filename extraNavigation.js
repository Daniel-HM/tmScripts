// ==UserScript==
// @name         Extra links in nav bar
// @namespace    ITM
// @version      1.3
// @description  Is sneller, yay efficientie! :-)
// @author       Daniël
// @downloadURL  https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/extraNavigation.js
// @updateURL    https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/extraNavigation.js
// @match        file:///C:/Users/d/Desktop/Tampermonkey/*.html
// @match        https://*.axi.nl/ordsp/*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=undefined.
// @grant        none
// ==/UserScript==
/* global $ */

(function ($) {
    'use strict';

    function addHeaderLinks() {
        // Find the header div
        const headerDiv = $('.t-Header-branding');

        // Create a navigation container
        const navContainer = $('<div>', {
            'class': 'custom-header-nav',
            'css': {
                'display': 'flex',
                'justify-content': 'flex-start',
                'align-items': 'center',
                'gap': '15px',
                'margin': '10px 0'
            }
        });
        function extractSessionId() {
            let savedSessionId = GM_getValue("savedSessionId");

            const url = window.location.href;

            // Use a more specific regex that targets the number after the third colon
            const matches = url.match(/([0-9]{11,14})::/);

            if (matches && matches[1]) {
                if(matches[1] === savedSessionId){
                    return matches[1];
                }
                GM_setValue("savedSessionId", matches[1]);
                return matches[1];
            }

            return savedSessionId;
        }

        const sessionId = extractSessionId();

        // Define links
        const links = [
            {
                text: 'Home',
                href: 'https://rs-intratuin.axi.nl/ordsp/f?p=AXI_UT_RS:HOME:'+sessionId+'::::::NO&c=1826474367392170',
                icon: '🏠'
            },
            {
                text: 'Artikelen',
                href: 'https://rs-intratuin.axi.nl/ordsp/f?p=ARTIKEL_ARTIKELEN_RS:1:'+sessionId+'::NO::::&c=ITN',
                icon: '🛍️'
            },
            {
                text: 'Interfiliaal',
                href: 'https://rs-intratuin.axi.nl/ordsp/f?p=INTERFILIAAL_RS:1:'+sessionId+'::NO::::&c=ITN',
                icon: '🚚'
            },
            {
                text: 'Orders',
                href: 'https://rs-intratuin.axi.nl/ordsp/f?p=ORDERS_WEEKORDERS:9:'+sessionId+'::NO::::&c=ITN',
                icon: '🛒'
            },
            {
                text: 'Ontvangen',
                href: 'https://rs-intratuin.axi.nl/ordsp/f?p=ONTVANGEN:1:'+sessionId+'::NO::::&c=ITN',
                icon: '📥'
            },
            {
                text: 'Klantorders',
                href: 'https://rs-intratuin.axi.nl/ordsp/f?p=KLANTORDER:4:'+sessionId+'::NO:&c=ITN',
                icon: '📝'
            },
            {
                text: 'Voorraad',
                href: 'https://rs-intratuin.axi.nl/ordsp/f?p=VOORRAADACTUEEL_RS:1:'+sessionId+'::NO::::&c=ITN',
                icon: '📊'
            }
        ];

        // Create and append links
        links.forEach(link => {
            const linkElement = $('<a>', {
                'href': link.href,
                'text': ` ${link.text}`,
                'css': {
                    'text-decoration': 'none',
                    'color': 'white',
                    'display': 'flex',
                    'align-items': 'center',
                    'gap': '3px',
                    'padding': '5px 5px',
                    'border-radius': '4px',
                    'background-color': 'rgba(255,255,255,0.1)',
                    'transition': 'background-color 0.3s ease'
                },
                'on': {
                    'mouseenter': function () {
                        $(this).css('background-color', 'rgba(255,255,255,0.2)');
                    },
                    'mouseleave': function () {
                        $(this).css('background-color', 'rgba(255,255,255,0.1)');
                    }
                }
            }).prepend($('<span>', {
                'text': link.icon
            }));

            navContainer.append(linkElement);
        });
        if ($('.t-Region-title').first().text() !== "Waar gaat u werken?") {
            // Append the navigation to the header
            headerDiv.prepend(navContainer);
            $('.t-Header-logo-link').empty();
            $('.t-Footer-apex').empty();
        }
    }

    // Wait for the page to load
    $(document).ready(addHeaderLinks);

})(jQuery);