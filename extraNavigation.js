// ==UserScript==
// @name         Extra links in nav bar
// @namespace    ITM
// @version      0.1
// @description  Is sneller, yay efficientie! :-)
// @author       Daniël
// @downloadURL  https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/extraNavigation.js
// @updateURL    https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/extraNavigation.js
// @match        file:///C:/Users/d/Desktop/Tampermonkey/paginas/Omzet%201%20pagina/Verkoopresultaten.html
// @match        https://rs-intratuin.axi.nl/ordsp/*
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

        // Define links
        const links = [
            {
                text: 'Artikels',
                href: '#',
                icon: '🛍️'
            },
            {
                text: 'Leveranciers',
                href: '#',
                icon: '🏭'
            },
            {
                text: 'Orders',
                href: '#',
                icon: '🛒'
            },
            {
                text: 'Pakbonnen',
                href: '#',
                icon: '\u{1F4C4}'
            },
            {
                text: 'Transacties',
                href: '#',
                icon: '💰'
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

        // Append the navigation to the header
        headerDiv.prepend(navContainer);
    }

    // Wait for the page to load
    $(document).ready(addHeaderLinks);

})(jQuery);