#!/usr/bin/env node
'use strict';

//////////
// Shims

Object.defineProperty(String.prototype, 'stripWhitespace', {
  value: function() {
    return this.replace(/\s/g, '');
  },
  enumerable: false,
  configurable: true
});

Object.resolve = function(object, path) {
  const parts = path.stripWhitespace().split(/\./);

  for (const part of parts) {
    object = object[part];
    if (!object) {
      return undefined;
    }
  }
  return object;
};

//////////
// Loader
