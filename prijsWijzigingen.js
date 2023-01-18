// ==UserScript==
// @name         Prijswijzigingen alles op 1
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  Aantal te printen etiketten in 1 klik op 1 zetten.
// @author       Daniël
// @downloadURL     https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/prijsWijzigingen.js
// @updateURL     https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/prijsWijzigingen.js
// @match        file:///C:/Users/d/Downloads/Greasemonkey/Prijswijzigingen/Prijswijziging.html
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=109971*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=undefined.
// @require      https://code.jquery.com/jquery-3.6.3.min.js
// @require      https://code.jquery.com/ui/1.13.1/jquery-ui.min.js
// @grant        none
// ==/UserScript==
/* global $ */

(function() {
    'use strict';
    var headerDiv = document.getElementsByClassName("t-Region-title")[1].parentNode;
    var vandaag = $.datepicker.formatDate('dd-mm-yy', new Date());
    var nulKnop = document.createElement("button");
    var vandaagKnop = document.createElement("button");

    nulKnop.setAttribute("class", "t-Button t-Button--icon t-Button--iconLeft t-Button--hot");
    nulKnop.innerHTML = "1 etiket per artikel";
    nulKnop.onclick = () => {
        $("input[name='f10']").val(1);
    };

    vandaagKnop.setAttribute("class", "t-Button t-Button--icon t-Button--iconLeft t-Button--hot");
    vandaagKnop.innerHTML = "Enkel Vandaag";
    vandaagKnop.onclick = () => {
        $("input[name='P10_DATE_VAN']").val(vandaag);
        $("input[name='P10_DATE_TM']").val(vandaag);
    };

    $('#P10_DATE_VAN_LABEL').text('Datum van ').append(vandaagKnop);


    headerDiv.append(nulKnop);

})();
