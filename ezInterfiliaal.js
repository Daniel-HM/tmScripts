// ==UserScript==
// @name         Interfiliaal tweaks
// @namespace    ITM
// @version      0.3
// @description  Interfiliaal tweaks
// @author       Daniël
// @downloadURL  https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/ezInterfiliaal.js
// @updateURL    https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/ezInterfiliaal.js
// @match        file:///C:/Users/d/Desktop/Tampermonkey/interfiliaal/Ontvangen.html
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=116011*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=undefined.
// @require      https://code.jquery.com/jquery-3.6.3.min.js
// @grant        none
// ==/UserScript==
/* global $ */

(function() {
    'use strict';

    // Verify we're on the correct page before adding buttons
    function isCorrectPage() {
        var h1 = $("h1.t-Breadcrumb-label");
        var h2Elements = $("h2.t-Region-title");

        if (h1.length === 0) {
            console.log('Interfiliaal tweaks: H1 not found');
            return false;
        }

        if (h2Elements.length < 2) {
            console.log('Interfiliaal tweaks: Less than 2 H2 elements found, found:', h2Elements.length);
            return false;
        }

        var h1Text = h1.text().trim();
        var h2Text = $(h2Elements[1]).text().trim(); // Check the second H2

        if (h1Text !== "Ontvangen") {
            console.log('Interfiliaal tweaks: H1 does not contain "Ontvangen", found:', h1Text);
            return false;
        }

        if (h2Text !== "Overzicht interfiliaal") {
            console.log('Interfiliaal tweaks: Second H2 does not contain "Overzicht interfiliaal", found:', h2Text);
            return false;
        }

        console.log('Interfiliaal tweaks: Page verification passed');
        return true;
    }

    // Only proceed if we're on the correct page
    if (!isCorrectPage()) {
        return;
    }

    var headerDiv = $(".t-Region-title")[1].parentNode;

    // Additional check to ensure headerDiv exists
    if (!headerDiv) {
        console.error('Interfiliaal tweaks: Header div not found');
        return;
    }

    var zoekAangevraagd = document.createElement("button");
    var zoekOntvangen = document.createElement("button");
    var zoekAfgewezen = document.createElement("button");

    // Remove the # prefix since getElementById doesn't need it
    var aangevraagdId = 'P1_L_OLVST_0';
    var teOntvangenId = 'P1_L_OLVST_1';
    var afgewezenId = 'P1_L_OLVST_3';
    var ontvangenId = 'P1_L_OLVST_2';

    createButton(zoekAangevraagd, "Aangevraagd + Te ontvangen", "ATO", headerDiv);
    createButton(zoekOntvangen, "Ontvangen", "O", headerDiv);
    createButton(zoekAfgewezen, "Afgewezen", "A", headerDiv);

    function klikZoeken(){
        $("#B26755220415450246944").trigger('click');
    }

    function checkBox(elementId){
        var element = document.getElementById(elementId);
        if(element) {
            element.checked = true;
        } else {
            console.error('Element not found:', elementId);
        }
    }

    function uncheckBox(elementId){
        var element = document.getElementById(elementId);
        if(element) {
            element.checked = false;
        } else {
            console.error('Element not found:', elementId);
        }
    }

    function createButton(buttonName, buttonText, status, where){
        $(buttonName).attr({
            class: "t-Button t-Button--icon t-Button--iconLeft t-Button--hot",
            type: "button",
        });
        $(buttonName).text(buttonText);
        $(buttonName).on("click", function(){
            if(status === "ATO"){
                checkBox(aangevraagdId);
                checkBox(teOntvangenId);
                uncheckBox(afgewezenId);
                uncheckBox(ontvangenId);
            }
            if(status === "O"){
                uncheckBox(aangevraagdId);
                uncheckBox(teOntvangenId);
                uncheckBox(afgewezenId);
                checkBox(ontvangenId);
            }
            if(status === "A"){
                uncheckBox(aangevraagdId);
                uncheckBox(teOntvangenId);
                checkBox(afgewezenId);
                uncheckBox(ontvangenId);
            }
            klikZoeken();
        });
        where.append(buttonName);
    }

    console.log('Interfiliaal tweaks: Buttons added successfully');
})();