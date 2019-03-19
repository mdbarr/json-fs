#!/usr/bin/env node
'use strict';

require('barrkeep');
const fs = require('fs');
const path = require('path');

const EventEmitter = require('events');

//////////
// Shims

Object.defineProperty(String.prototype, 'stripWhitespace', {
  value() {
    return this.replace(/\s/g, '');
  },
  enumerable: false,
  configurable: true
});

Object.resolve = function(object, propertyPath) {
  const parts = propertyPath.stripWhitespace().split(/\./);

  if (!object) {
    return undefined;
  }

  for (const part of parts) {
    object = object[part];
    if (!object) {
      return undefined;
    }
  }
  return object;
};

Object.set = function(object, propertyPath, value) {
  const parts = propertyPath.stripWhitespace().split(/\./);
  const key = parts.pop();

  for (const part of parts) {
    object = object[part];

    if (!object) {
      return undefined;
    }
  }

  object[key] = value;

  return object;
};

//////////
// Event handling and Proxy

const events = new EventEmitter();

const interceptor = function(object, eventName) {
  const intercept = {
    get(target, key) {
      if (typeof target[key] === 'object' && target[key] !== null) {
        return new Proxy(target[key], intercept);
      }
      return target[key];
    },
    set(target, key, value) {
      target[key] = value;
      events.emit(eventName, target, key, value);
    }
  };

  return new Proxy(object, intercept);
};

//////////
// Loader

const mapFile = process.argv[2];
if (!mapFile) {
  console.log('No Map File');
  process.exit(1);
}

const mapping = JSON.parse(fs.readFileSync(mapFile));
const directory = path.dirname(mapFile);

for (const mount in mapping.mounts) {
  const filename = path.join(directory, mapping.mounts[mount]);
  const json = JSON.parse(fs.readFileSync(filename));

  events.on(mount, (target, key, value) => {
    //fs.writeFile(filename, JSON.stringify(json, null, 2));
    console.log(`Change detected for ${ mount }: ${ key } = ${ value }`);
  });

  mapping.mounts[mount] = json; interceptor(json, mount);
}

//////////
// Map

function generateMapping(object) {
  const container = {};

  for (const property in object) {
    if (typeof object[property] === 'string') {
      container[property] = object[property];
    } else if (typeof object[property] === 'object') {
      container[property] = generateMapping(object[property]);
    }
  }

  return container;
}

function generateBinding(object) {
  const map = generateMapping(object);

  const intercept = {
    get(target, key) {
      //console.log('binding-get', key, target[key], typeof target[key]);
      if (typeof target[key] === 'object' && target[key] !== null) {
        return new Proxy(target[key], intercept);
      }
      return Object.resolve(mapping.mounts, target[key]);
    },
    set(target, key, value) {
      Object.set(mapping.mounts, target[key], value);
    }
  };

  return new Proxy(map, intercept);
}

//////////
// Tree creation

const tree = generateBinding(mapping.map);
console.pp(tree);
//tree.text.image = 'crap';
