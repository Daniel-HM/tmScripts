// ==UserScript==
// @name         Pakbonlijst tweaks
// @namespace    http://tampermonkey.net/
// @version      0.4
// @description  Pakbonlijst tweaks :-)
// @author       Daniël
// @downloadURL  https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/pbList.js
// @updateURL    https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/pbList.js
// @match        file:///C:/Users/d/Downloads/Greasemonkey/Pakbon%20lijst/Pakbonnen.html
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=ONTVANGEN:5*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=undefined.
// @require      https://code.jquery.com/jquery-3.6.3.min.js
// @grant        none
// ==/UserScript==
/* global $ */

(function() {
    'use strict';
    // Form tijdelijk disabled - in prod verwijderen
    $("#wwvFlowForm").attr("action","#");
    // --

    var headerDiv = $(".t-Region-title")[1].parentNode;
    var zoekOpen = document.createElement("button");
    var zoekDeelsVerwerkt = document.createElement("button");
    var zoekVerwerkt = document.createElement("button");

    createButton(zoekOpen, "Opeasddsaasdadsas", "O", headerDiv);
    createButton(zoekDeelsVerwerkt, "Deels Verwerkt", "D", headerDiv);
    createButton(zoekVerwerkt, "Verwerkt", "V", headerDiv);

})();

function klikZoeken(){
    $("#P10_GO").trigger('click');
};

function changeStatus(arg){
    $("#P50_ZOEK_STATS").val(arg).change();
};

function createButton(buttonName, buttonText, status, where){

    $(buttonName).attr({
        class: "t-Button t-Button--icon t-Button--iconLeft t-Button--hot",
        type:"button",
    });
    $(buttonName).text(buttonText);
    $(buttonName).on("click", function(){
        changeStatus(status);
        klikZoeken();
    });
    where.append(buttonName);
};

