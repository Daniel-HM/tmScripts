// ==UserScript==
// @name         EZ Verwerken
// @namespace    http://tampermonkey.net/
// @version      0.2
// @description  Pakbon verwerken met 1 klik op de knop :-)
// @author       Daniël
// @downloadURL     https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/pbVerwerken.js
// @updateURL     https://raw.githubusercontent.com/Daniel-HM/tmScripts/main/pbVerwerken.js
// @match        file:///C:/Users/d/Downloads/Greasemonkey/Pakbon%20detail%20pagina/Pakbon%2000037897-32084.html
// @match        https://rs-intratuin.axi.nl/ordsp/f?p=186981:51*
// @icon         https://www.google.com/s2/favicons?sz=64&domain=undefined.
// @require      https://code.jquery.com/jquery-3.6.3.min.js
// @grant        none
// ==/UserScript==
/* global $ */

(function() {
    'use strict';
    hideButtons();
    var headerDiv = document.getElementsByClassName("t-Region-title")[1].parentNode;
    var verwerkButton = document.createElement("button");
    var verwKnop = document.getElementById("VerwKnop");

    verwerkButton.setAttribute("class", "t-Button t-Button--icon t-Button--iconLeft t-Button--hot");

    verwerkButton.innerHTML = "Alles verwerken";
    verwerkButton.onclick = () => {
        check();
        verwKnop.click();
    };

    headerDiv.append(verwerkButton);

})();

function check(){

    var get= document.getElementsByName('f10');

    for(var i= 0; i<get.length; i++){

        get[i].checked= true;}

}

function hideButtons(){
    $("#VerwKnop").hide();
    $("#VerwAllRegelsKnop").hide();
}