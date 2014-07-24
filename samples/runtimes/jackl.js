"use strict";
var bodec = require('bodec');
var inspect = require('util').inspect;
var ansiToHtml = require('./ansi-to-html');

var identRegex =  /^[^{}[\]();:,.'"`\s]+/;


module.exports = function (load, url, code) {
  code = bodec.toUnicode(code);
  var current = [];
  var expect = null;
  var stack = [];
  var match;
  try {
    for (var offset = 0; offset < code.length; offset += match[0].length) {
      var part = code.substring(offset);
      var token;

      // Ignore whitespace and comments
      if ((match = part.match(/^(?:\s+|--.*)/))) continue;

      // Match numbers, booleans, null, and strings.
      if ((match = part.match(/^(?:-?[0-9]+|true\b|false\b|null\b|"(?:[^\r\n"]|\\.)*")/))) {
        token = JSON.parse(match[0]);
      }

      // Parse identifiers (variables/operators)
      else if ((match = part.match(identRegex))) {
        token = {id: match[0]};
      }

      // Everything else is a char
      else {
        var char = part[0];
        match = [char];
        if (char === "(") {
          stack.push([current, expect]);
          current = [];
          expect = null;
          continue;
        }
        if (!expect && (char === ":" || char === ".")) {
          expect = char;
          continue;
        }
        // Pop stack on close parenthesis.
        if (char === ")") {
          token = current;
          var pair = stack.pop();
          current = pair[0];
          expect = pair[1];
        }
        else {
          throw new Error("Unexpected character " + JSON.stringify(char));
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
        continue;
      }

      if (expect === ".") {
        if (token && token.id) token = token.id;
        if (typeof token !== "string" && typeof token !== "number") {
          throw new SyntaxError("dot access property must be quoted string, identifier or integer offset");
        }
        last = current[current.length - 1];
        current[current.length - 1] = {lookup:token,value:last};
        expect = null;
        continue;
      }
      current.push(token);
    }
  }
  catch (err) {
    throw formatError(err, code, offset, url);
  }

  var tree = current.map(write).join("\n");
  // tree = inspect(current, {depth:null,colors:true})
  console.log(tree);
  return [200, {
    "Content-Type": "text/html"
  }, bodec.fromUnicode(ansiToHtml(tree, true))];

};


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
  var message = "(" + filename + ":" + (row + 1) + ":" + (column + 1) + ")\n" +
    above + "\n" +
    line + "\n" +
    indent + "^ " + err.message + "\n" +
    below;
  var Constructor = err.constructor;
  return new Constructor(message);
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

function htmlModule() {
  /*jshint validthis:true*/

  var elements = [
    // Root element
    "html",
    // Document metadata
    "head", "title", "base", "link", "meta", "style",
    // Scripting
    "script", "noscript", "template",
    // Sections
    "body", "section", "nav", "article", "aside", "h1", "h2", "h3", "h4", "h5", "h6", "header", "footer", "address", "main",
    // Grouping content
    "p", "hr", "pre", "blockquote", "ol", "ul", "li", "dl", "dt", "dd", "figure", "figcaption", "div",
    // Text-level semantics
    "a", "em", "strong", "small", "s", "cite", "q", "dfn", "abbr", "data", "time", "code", "var", "samp", "kbd", "sub", "sup", "i", "b", "u", "mark", "ruby", "rt", "rp", "bdi", "bdo", "span", "br", "wbr",
    // Edits
    "ins", "del",
    // Embedded content
    "img", "iframe", "embed", "object", "param", "video", "audio", "source", "track", "canvas", "map", "area", "svg", "math",
    // Tabular data
    "table", "caption", "colgroup", "col", "tbody", "thead", "tfoot", "tr", "td", "th",
    // Forms
    "form", "fieldset", "legend", "label", "input", "button", "select", "datalist", "optgroup", "option", "textarea", "keygen", "output", "progress", "meter",
    // Interactive elements
    "details", "summary", "menuitem", "menu"
  ];
  var voidElements = {
    area: true, base: true, br: true, col: true, command: true, embed: true,
    hr: true, img: true, input: true, keygen: true, link: true, meta: true,
    param: true, source: true, track: true, wbr: true,
  };

  for (var i = 0, l = elements.length; i < l; i++) {
    var tag = elements[i];
    this[tag] = makeElement(tag);
  }
  this.raw = function(html) {
    return new Html(html);
  };

  // Will act like a string for everything except bracket access.
  function Html(html) {
    this.html = html;
  }
  Html.prototype = Object.create(String.prototype, {
    constructor: { value: Html },
    toString: { value: HtmlToString },
    valueOf: { value: HtmlToString },
    length: { get: function () { return this.html.length; } },
  });
  function HtmlToString() {
    return this.html;
  }

  var escapeMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  };

  function escapeHtml(string, quotes) {
    return String(string).replace(quotes ? /[&<>"]/g : /[&<>]/g, function (char) {
      return escapeMap[char];
    });
  }

  function makeElement(tag) {
    var isVoid = voidElements[tag];
    return function() {
      var html = "<" + tag;
      var attributes = this["@"];
      var keys = Object.keys(attributes);
      var i, l;
      for (i = 0, l = keys.length; i < l; ++i) {
        var key = keys[i];
        html += " " + key + '"' + escapeHtml(attributes[key], true) + '"';
      }
      html += ">";
      if (isVoid) {
        if (arguments.length) {
          throw new Error("No content allowed inside of " + tag);
        }
        return new Html(html);
      }
      for (i = 0, l = arguments.length; i < l; i++) {
        var child = arguments[i];
        if (child instanceof Html) html += child.html;
        else {
          html += escapeHtml(child);
        }
      }
      html += "</" + tag + ">";
      return new Html(html);
    };
  }
}
