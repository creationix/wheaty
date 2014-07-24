"use strict";

var colors = {
  base03:  "#002b36",
  base02:  "#073642",
  base01:  "#586e75",
  base00:  "#657b83",
  base0:   "#839496",
  base1:   "#93a1a1",
  base2:   "#eee8d5",
  base3:   "#fdf6e3",
  yellow:  "#b58900",
  orange:  "#cb4b16",
  red:     "#dc322f",
  magenta: "#d33682",
  violet:  "#6c71c4",
  blue:    "#268bd2",
  cyan:    "#2aa198",
  green:   "#859900",
};

module.exports = ansiToHtml;
function ansiToHtml(text, dark) {
  var state = {
    color: false,
    background: false,
    bold: false,
  };

  var mapping = {
    "0": {color: false, background: false, bold: false},
    "1": {bold: true},
    "30": {color: dark ? colors.base02 : colors.base2},
    "31": {color: colors.red},
    "32": {color: colors.green},
    "33": {color: colors.yellow},
    "34": {color: colors.blue},
    "35": {color: colors.magenta},
    "36": {color: colors.cyan},
    "37": {color: dark ? colors.base2 : colors.base02},
    "39": {color: false},

    "40": {background: dark ? colors.base03 : colors.base3},
    "41": {background: colors.red},
    "42": {background: colors.green},
    "43": {background: colors.yellow},
    "44": {background: colors.blue},
    "45": {background: colors.magenta},
    "46": {background: colors.cyan},
    "47": {background: dark ? colors.base0 : colors.base00},
    "49": {background: false},
  };

  var html = '<body style="background-color: ' + (dark ? colors.base03 : colors.base3) +
    '; color: ' + (dark ? colors.base0 : colors.base00) +
    ';"><pre style="white-space: pre-wrap; font-family: menlo, monospace; ">';
  text.split("\x1B").forEach(function (part) {
    var match = part.match(/\[([0-9]+(?:;[0-9]+)*)m/);
    if (match) {
      part = part.substring(match[0].length);
      match[1].split(";").forEach(function (command) {
        var change = mapping[command];
        if (!change) {
          console.error("Unknown command: " + match[1]);
          return;
        }
        for (var key in change) {
          state[key] = change[key];
        }
      });
    }
    if (part) {
      var style = "";
      if (state.color) {
        style += "color: " + state.color + ";";
      }
      if (state.background) {
        style += "background-color: " + state.background + ";";
      }
      if (state.bold) {
        style += "font-weight: bold;";
      }
      if (style) {
        html += '<span style="' + style + '">' + part + "</span>";
      }
      else {
        html += part;
      }
    }
  });
  html += "</pre></body>";
  return html;
}
