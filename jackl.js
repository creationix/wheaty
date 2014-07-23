"use strict";
var bodec = require('bodec');
var inspect = require('util').inspect;

var identRegex =  /^[^{}[\]();:,.'"`\s]+/;


module.exports = function* (load, url, code) {
  console.log("Simulating delay running script");
  yield function (callback) {
    setTimeout(callback, 2000);
  };
  code = bodec.toUnicode(code);
  var current = [];
  var expect = null;
  var stack = [];
  var tokens = tokenize(code);

  tokens.forEach(function (token) {
    if (token.char) {
      if (token.char === "(") {
        stack.push([current,expect]);
        current = [];
        expect = null;
        return;
      }
      if (!expect && (token.char === ":" || token.char === ".")) {
        expect = token.char;
        return;
      }
      // Pop stack on close parenthesis.
      if (token.char === ")") {
        token = current;
        var pair = stack.pop();
        current = pair[0];
        expect = pair[1];
      }
      else {
        throw new Error("Unexpected character " + JSON.stringify(token.char));
      }
    }

    var last;
    if (expect === ":") {
      last = current.pop();
      if (last && last.id) last = last.id;
      if (typeof last !== "string") {
        throw new SyntaxError("pair keys must be quoted strings or identifiers");
      }
      current[last] = token;
      expect = null;
      return;
    }

    if (expect === ".") {
      if (token && token.id) token = token.id;
      if (typeof token !== "string" && typeof token !== "number") {
        throw new SyntaxError("dot access property must be quoted string, identifier or integer offset");
      }
      last = current[current.length - 1];
      current[current.length - 1] = {lookup:token,value:last};
      expect = null;
      return;
    }

    current.push(token);
  });

  var tree = current.map(write).join("\n");
  // tree = inspect(current, {depth:null,colors:true})
  console.log(tree);
  return [200, {
    "Content-Type": "text/html"
  }, bodec.fromUnicode(ansiToHtml(tree, true))];

};

function tokenize(code) {
  var offset = 0;
  var tokens = [];
  while (offset < code.length) {
    var part = code.substring(offset);
    var match;

    // Ignore whitespace and comments
    if ((match = part.match(/^(?:\s+|--.*)/))) {
      offset += match[0].length;
      continue;
    }

    // Match numbers, booleans, null, and strings.
    if ((match = part.match(/^(?:-?[0-9]+|true\b|false\b|null\b|"(?:[^\r\n"]|\\.)*")/))) {
      tokens.push(JSON.parse(match[0]));
      offset += match[0].length;
      continue;
    }

    // Parse identifiers (variables/operators)
    if ((match = part.match(identRegex))) {
      tokens.push({id: match[0]});
      offset += match[0].length;
      continue;
    }

    tokens.push({char: code[offset++]});

  }
  return tokens;
}

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

function formatError(err, string, offset, filename) {
  var before = string.substring(0, offset).split("\n");
  var after = string.substring(offset).split("\n");
  var line = before.pop() || "";
  var column = line.length;
  line += after.shift() || "";
  var row = before.length;
  var above = before.pop() || "";
  var below = after.shift() || "";
  var indent = "";
  for (var i = 0; i < column; i++) {
    indent += "-";
  }
  var message = "at (" + filename + ":" + (row + 1) + ":" + (column + 1) + ")\n" +
    above + "\n" +
    line + "\n" +
    indent + "^ " + err.message + "\n" +
    below;
  console.error(message);
  err.message = message;
  return err;
}


function formatProperty(property) {
  return identRegex.test(property) ? property : JSON.stringify(property);
}

function raw(string) {
  if (!string) return "";
  return string.split(/\x1B\[[^m]*m/g).join("");
}


function write(value) {
  if (!Array.isArray(value)) {
    if (value.id) {
      return '\x1B[34m' + value.id + '\x1B[39m';
    }
    if (value.char) {
      return value.char;
    }
    if (value.lookup) {
      return write(value.value) + "." + formatProperty(value.lookup);
    }
    return inspect(value, {colors:true});
  }
  var body = [];
  var props = [];
  for (var key in value) {
    if (!value.hasOwnProperty(key)) continue;
    if ((key|0) != key) {
      props.push(key + ": " + write(value[key]));
    }
    else {
      body.push(write(value[key]));
    }
  }
  var first, rest;
  if (body.length) {
    first = [body[0]];
    rest = body.slice(1);
  }
  else {
    first = [];
    rest = body;
  }
  var firstLength = first.reduce(function (sum, item) {
    return sum + raw(item).length;
  }, first.length);
  var restLength = rest.reduce(function (sum, item) {
    return sum + raw(item).length;
  }, rest.length);
  var propsLength = props.reduce(function (sum, item) {
    return sum + raw(item).length;
  }, props.length);

  if (firstLength + restLength + propsLength < 80) {
    return "(" + first.concat(props).concat(rest).join(" ") + ")";
  }
  if (firstLength + propsLength < 80) {
    return "(" + first.concat(props).join(" ") + "\n  " + rest.join("\n").split("\n").join("\n  ") + ")";
  }
  return "(" + (first.length ? "" : " ") + first.concat(props).concat(rest).join("\n").split("\n").join("\n  ") + ")";
}